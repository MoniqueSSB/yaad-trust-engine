-- Quote Pack dual agreement, ahead of the Kickoff Pack (2 Sep 2026).
--
-- Founder's own correction, live in this session: a submitted quote used to
-- go straight from 'submitted' to 'kickoff_requested' the moment the client
-- clicked once, and the client's WhatsApp reply to quote_arrived tried to
-- book the worker directly. Neither step ever asked the worker to agree to
-- anything, and nothing stood between "a price arrived" and "somebody is
-- booked." The founder's actual design: client and worker each confirm the
-- quote itself first (what's already on the /quotes page: scope, included,
-- excluded, timeline, payment stage note, the price split), the same way
-- both sides already confirm a Kickoff Pack. Only once THAT is mutual does
-- booking unlock. The Kickoff Pack becomes optional from there: a client
-- happy with the Quote Pack alone can book straight away; one who wants the
-- fuller document can still ask for it, but it never gates booking, reading
-- it is confirmable at leisure.
--
-- New status on job_quotes: 'quote_confirmed', reached only once both sides
-- have agreed (never set directly by any RPC's own choice). 'kickoff_requested'
-- is now reachable only from 'quote_confirmed', not from 'submitted' directly.

alter table public.job_quotes drop constraint if exists job_quotes_status_check;
alter table public.job_quotes add constraint job_quotes_status_check
  check (status = any (array['submitted','quote_confirmed','kickoff_requested','withdrawn','accepted','declined']));

-- Mirrors kickoff_pack_agreements exactly (20260831zzzz10), minus the
-- revision column: a quote's own terms do not get edited in place once
-- submitted, there is no "new revision of a quote" concept anywhere in this
-- codebase, so there is nothing here for a stale confirmation to drift
-- against the way an issued Kickoff Pack's docs can.
create table if not exists public.quote_agreements (
  quote_id  uuid not null references public.job_quotes(id),
  side      text not null check (side in ('client','worker')),
  email     text not null,
  agreed_at timestamptz not null default now(),
  primary key (quote_id, side)
);

alter table public.quote_agreements enable row level security;

create policy "admin full quote_agreements" on public.quote_agreements
  for all using (public.is_admin()) with check (public.is_admin());

create policy "parties read quote agreements" on public.quote_agreements
  for select using (
    exists (
      select 1 from public.job_quotes q
      join public.jobs j on j.id = q.job_id
      where q.id = quote_agreements.quote_id
        and (lower(coalesce(j.client_email,'')) = lower(auth.jwt()->>'email')
             or lower(coalesce(q.worker_email,'')) = lower(auth.jwt()->>'email'))
    )
  );
-- No insert/update/delete policy for parties: every write goes through
-- agree_quote_via_whatsapp() below, security definer, same shape as
-- agree_kickoff_pack_via_whatsapp - a side can never be recorded as agreed
-- except by that side's own phone replying.

-- Phone-based, same shape as agree_kickoff_pack_via_whatsapp(p_job, p_phone)
-- (20260901k): takes the job and the phone that replied, works out which
-- side that is FOR THIS JOB, records it, and flips the quote forward the
-- moment both sides are in. Only one quote may be 'submitted' on a job at
-- once for the client side to be unambiguous; more than one refuses rather
-- than guessing, matching this repository's own rule that a bare job-code
-- reply is never enough to resolve real ambiguity.
create or replace function public.agree_quote_via_whatsapp(p_job text, p_phone text)
returns table(agreed_side text, both_confirmed boolean, job_id text, quote_id uuid)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tail text := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 9);
  v_job public.jobs%rowtype;
  v_quote public.job_quotes%rowtype;
  v_side text;
  v_email text;
  v_open_count integer;
  v_both boolean;
begin
  if length(v_tail) < 7 then
    raise exception 'No usable phone number.';
  end if;

  select * into v_job from public.jobs where id = p_job;
  if v_job.id is null then
    raise exception 'No such job.';
  end if;

  if right(regexp_replace(coalesce(v_job.client_phone, ''), '\D', '', 'g'), 9) = v_tail then
    select count(*) into v_open_count from public.job_quotes where job_id = p_job and status = 'submitted';
    if coalesce(v_open_count, 0) = 0 then
      raise exception 'No open price on this job to confirm.';
    end if;
    if v_open_count > 1 then
      raise exception 'More than one price is open on this job. Say which worker you mean.';
    end if;
    select * into v_quote from public.job_quotes where job_id = p_job and status = 'submitted';
    v_side := 'client';
    v_email := lower(coalesce(v_job.client_email, ''));
  else
    select q.* into v_quote
      from public.job_quotes q
      join public.worker_profiles wp on lower(wp.worker_email) = lower(q.worker_email)
     where q.job_id = p_job and q.status = 'submitted'
       and right(regexp_replace(coalesce(wp.phone,''), '\D', '', 'g'), 9) = v_tail;
    if v_quote.id is null then
      raise exception 'No open price on this job is waiting on your confirmation.';
    end if;
    v_side := 'worker';
    v_email := lower(v_quote.worker_email);
  end if;

  insert into public.quote_agreements (quote_id, side, email)
  values (v_quote.id, v_side, v_email)
  on conflict (quote_id, side) do nothing;

  select (count(*) filter (where side = 'client') > 0) and (count(*) filter (where side = 'worker') > 0)
    into v_both
    from public.quote_agreements where quote_id = v_quote.id;

  if v_both then
    perform set_config('yaadly.choosing', '1', true);
    update public.job_quotes set status = 'quote_confirmed', updated_at = now() where id = v_quote.id;
    perform set_config('yaadly.choosing', '', true);
  end if;

  return query select v_side, coalesce(v_both, false), p_job, v_quote.id;
end;
$function$;

revoke all on function public.agree_quote_via_whatsapp(text, text) from public;
grant execute on function public.agree_quote_via_whatsapp(text, text) to service_role, authenticated;

-- The Kickoff Pack is now optional and asked for only once the Quote Pack
-- itself is mutually agreed, never before. The old guard let anyone move a
-- bare 'submitted' quote straight to 'kickoff_requested' with no agreement
-- on either side; the client's own portal button is exactly how that
-- founder-corrected gap was found live, 2 Sep 2026.
create or replace function public.request_kickoff_as_me(p_quote uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare q record; j record; me text;
begin
  me := lower(coalesce(auth.jwt() ->> 'email', ''));
  if me = '' then raise exception 'You need to be signed in to do that.'; end if;

  select * into q from job_quotes where id = p_quote;
  if q is null then raise exception 'That quote no longer exists.'; end if;

  select * into j from jobs where id = q.job_id;
  if j is null then raise exception 'That job no longer exists.'; end if;

  if lower(coalesce(j.client_email,'')) <> me then
    raise exception 'That is not your job.';
  end if;

  if coalesce(j.worker_email,'') <> '' then
    raise exception 'This job already has a worker on it. Talk to Yaadly before changing that.';
  end if;

  if q.status <> 'quote_confirmed' then
    raise exception 'Both sides need to agree the quote first. Reply on WhatsApp with the job code to confirm it, then a Kickoff Pack can be requested.';
  end if;

  perform set_config('yaadly.choosing', '1', true);
  update job_quotes set status = 'kickoff_requested', updated_at = now() where id = p_quote;
  perform set_config('yaadly.choosing', '', true);

  return q.job_id;
end;
$function$;

-- Booking candidates now require the quote itself to already be mutually
-- confirmed. A quote sitting at 'submitted' is not bookable no matter what
-- the client replies with; that reply is read as a Quote Pack confirmation
-- instead (see the new block in yaad-inbound).
create or replace function public.choose_worker_via_whatsapp(p_job text, p_phone text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  j record;
  v_tail text := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 9);
  v_count integer;
  v_quote uuid;
begin
  if length(v_tail) < 7 then
    raise exception 'No usable phone number.';
  end if;

  select * into j from public.jobs where id = p_job;
  if j.id is null then
    raise exception 'No such job.';
  end if;

  if right(regexp_replace(coalesce(j.client_phone, ''), '\D', '', 'g'), 9) <> v_tail then
    raise exception 'That number is not on record for this job.';
  end if;

  select count(*), (array_agg(id))[1]
    into v_count, v_quote
    from public.job_quotes
   where job_id = p_job and status in ('quote_confirmed', 'kickoff_requested');

  if coalesce(v_count, 0) = 0 then
    raise exception 'No price is open on this job to accept.';
  end if;

  if v_count > 1 then
    raise exception 'More than one price is open on this job. Use the link to choose.';
  end if;

  return public._do_choose_worker(p_job, v_quote);
end;
$function$;

-- The Kickoff Pack no longer gates booking at all, requested or not: the
-- founder's own correction is that it is pure extra reading, confirmable at
-- leisure, never a second lock in front of the same door the Quote Pack
-- already opens. The gate is now the quote's own status, the same fact
-- choose_worker_via_whatsapp already filtered candidates on above; checked
-- again here, defensively, since this function is the one real booking path
-- underneath both the WhatsApp door and any future portal one.
create or replace function public._do_choose_worker(p_job text, p_quote uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_job    jobs%rowtype;
  v_quote  job_quotes%rowtype;
begin
  select * into v_job from jobs where id = p_job for update;
  if not found then raise exception 'no such job'; end if;

  if coalesce(v_job.worker_email, '') <> '' then
    raise exception 'a worker is already chosen on this job';
  end if;

  select * into v_quote from job_quotes where id = p_quote and job_id = p_job;
  if not found then raise exception 'that quote is not on this job'; end if;

  if v_quote.status not in ('quote_confirmed', 'kickoff_requested') then
    raise exception 'choose unlocks once both sides confirm the quote';
  end if;

  perform set_config('yaadly.choosing', '1', true);
  update jobs set worker_email = v_quote.worker_email,
                  worker_name  = v_quote.worker_name,
                  worker_user  = v_quote.worker_user,
                  status = 'in_progress', stage = 1,
                  updated_at = now()
   where id = p_job;
  update job_quotes set status = 'accepted' where id = p_quote;
  update job_quotes set status = 'declined'
   where job_id = p_job and id <> p_quote and status in ('submitted', 'quote_confirmed', 'kickoff_requested');
  perform set_config('yaadly.choosing', '', true);

  return p_job;
end;
$function$;

-- sync_job_status()'s has_quotes check needs to know 'quote_confirmed' still
-- counts as "a live price is open," or a job sitting there between agreement
-- and booking would wrongly fall back to 'open_for_quotes'.
create or replace function public.sync_job_status()
returns trigger
language plpgsql
as $function$
declare
  has_quotes boolean;
  working_stage integer;
  has_unapproved_evidence boolean;
  final_stage_count integer;
  is_complete boolean;
begin
  if new.status in ('disputed','cancelled') then
    return new;
  end if;

  select jsonb_array_length(p.docs->'payment_schedule'->'stages')
    into final_stage_count
    from public.kickoff_packs p
   where p.job_id = new.id and p.status = 'approved'
   order by p.updated_at desc
   limit 1;

  is_complete := coalesce(new.stage, 0) >
    coalesce(final_stage_count, 5 - 1);

  if is_complete then
    new.status := 'complete';
  elsif coalesce(new.worker_email,'') <> '' then
    working_stage := greatest(coalesce(new.stage, 0), 1);
    select exists (
      select 1 from public.evidence e
       where e.job_id = new.id and coalesce(e.stage, 1) = working_stage
    ) and not exists (
      select 1 from public.stage_approvals a
       where a.job_id = new.id and a.stage = working_stage
    ) into has_unapproved_evidence;

    new.status := case when has_unapproved_evidence then 'evidence' else 'in_progress' end;
  elsif new.open then
    select exists (select 1 from public.job_quotes q
                    where q.job_id = new.id and q.status in ('submitted', 'quote_confirmed', 'kickoff_requested'))
      into has_quotes;
    new.status := case when has_quotes then 'quoted' else 'open_for_quotes' end;
  elsif public.client_cleared_for_golive(new.client_email) then
    new.status := 'draft';
  else
    new.status := 'awaiting_client_setup';
  end if;

  return new;
end;
$function$;

-- jq_select_client (20260901g) needs the same status added, or a client
-- cannot see their own quote on the no-account /quotes page while it sits
-- between the two agreements.
drop policy if exists jq_select_client on public.job_quotes;
create policy jq_select_client on public.job_quotes
  for select using (
    status = any (array['submitted','quote_confirmed','kickoff_requested','accepted'])
    and job_client_email_matches(job_id, (auth.jwt() ->> 'email'))
  );

-- The worker wrote the quote, but "wrote it" is not "confirmed it" any more
-- than the client clicking once used to be. They need telling to reply, the
-- same way notify_worker_kickoff_pack_ready (20260831zzzz12) tells them a
-- pack is ready: same shared-secret-baked-into-the-trigger pattern as every
-- other trigger here, reusing the existing plaintext rather than minting a
-- new one, per this repository's own standing rule after the secret-drift
-- incident (RUNBOOK.md, "A client says they were never told").
create or replace function public.notify_worker_quote_awaits_confirm()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.status = 'submitted' then
    perform net.http_post(
      url := 'https://leffyisvfvjwzilydlwf.supabase.co/functions/v1/yaad-notify-client',
      body := jsonb_build_object(
        'secret', '4cfc0fc962b534f961e3d2dbdc30b1996c273340c361b3dd9992742718d65613',
        'jobId', new.job_id,
        'kind', 'quote_awaiting_worker_confirm',
        'meta', jsonb_build_object('quoteId', new.id)
      ),
      headers := jsonb_build_object('Content-Type','application/json','apikey','sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz','Authorization','Bearer '||'sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz'),
      timeout_milliseconds := 15000
    );
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_notify_worker_quote_confirm on public.job_quotes;
create trigger trg_notify_worker_quote_confirm
  after insert on public.job_quotes
  for each row execute function public.notify_worker_quote_awaits_confirm();
