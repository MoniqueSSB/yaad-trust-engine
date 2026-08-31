-- Stage 6, continued. A client can already approve a stage by replying on
-- WhatsApp with no account at all. Booking a worker could not do the same.
--
-- First attempt at this migration built on accept_quote_as_me(), the
-- function AcceptPanel.tsx calls from the no-account /jobs/[id]/quotes
-- page. Live testing found that function is not actually the current
-- mechanism: choose_worker() is, called from the signed-in portal
-- (job-actions.ts's chooseQuote), and it enforces a rule
-- accept_quote_as_me() knows nothing about: a quote may only be accepted
-- once BOTH the client and the worker have separately agreed the job's
-- scope (scope_agreements, one row per side, added 27-28 Aug after a
-- worker could otherwise assign themselves to a client's own job with
-- nobody choosing anybody). accept_quote_as_me() also turned out to already
-- be broken on its own terms: it tries to mark a losing quote 'not_chosen',
-- a value job_quotes' own status check constraint has never allowed. Left
-- exactly as found; not this migration's job to fix, and flagged
-- separately rather than touched, since AcceptPanel.tsx is a live, real
-- user-facing path and changing it was not asked for.
--
-- This version is built on choose_worker() instead. Same split as
-- approve_stage(): the decision logic moves into _do_choose_worker(p_job,
-- p_quote), which choose_worker() and choose_worker_via_whatsapp() both
-- call. Ownership is established by whichever wrapper is calling, not
-- threaded through as an email the way approve_stage_via_whatsapp() does:
-- a WhatsApp-only job carries no client_email until its portal code is
-- claimed (yaad-whatsapp-webhook's finalizeIntake writes it blank on
-- purpose), and Stage 6 exists so a client never has to claim one.
--
-- The scope-agreement question was the founder's own to answer, asked
-- plainly: does replying to book count as agreeing the scope, or does
-- something separate need to happen first. Decided 31 Aug 2026: send the
-- scope first, in words, then ask for a reply to confirm it. So
-- quote_arrived's WhatsApp message now carries what the worker actually
-- proposed, not only the price, and the one reply that follows both
-- records the client's scope_agreements row and calls choose_worker_via_
-- whatsapp() in the same step. One reply, honestly earned: the client saw
-- the proposal in words before the reply that binds it, the same standard
-- the portal's own tick-box holds itself to, not a lower one because the
-- channel is a text message instead of a form.

-- ── The shared core ──────────────────────────────────────────────────────
-- Not exposed to PostgREST, not granted to anyone. Mirrors choose_worker()
-- exactly: same lock, same checks, same yaadly.choosing handshake that
-- job_quotes_touch's trigger requires before it will let a quote's status
-- move at all, same 'declined' status on the losing quotes (job_quotes'
-- own check constraint has never allowed 'not_chosen', the mistake the
-- first attempt at this migration copied from accept_quote_as_me without
-- noticing). Returns the job id rather than void, for a caller to compose
-- a WhatsApp reply from.
create or replace function public._do_choose_worker(p_job text, p_quote uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_job   jobs%rowtype;
  v_quote job_quotes%rowtype;
begin
  select * into v_job from jobs where id = p_job for update;
  if not found then raise exception 'no such job'; end if;

  if coalesce(v_job.worker_email, '') <> '' then
    raise exception 'a worker is already chosen on this job';
  end if;

  select * into v_quote from job_quotes where id = p_quote and job_id = p_job;
  if not found then raise exception 'that quote is not on this job'; end if;

  if not exists (select 1 from scope_agreements where job_id = p_job and side = 'client') then
    raise exception 'choose unlocks when both have agreed the scope';
  end if;
  if not exists (select 1 from scope_agreements sa where sa.job_id = p_job and sa.side = 'worker'
                 and lower(sa.email) = lower(v_quote.worker_email)) then
    raise exception 'choose unlocks when both have agreed the scope';
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
   where job_id = p_job and id <> p_quote and status = 'submitted';
  perform set_config('yaadly.choosing', '', true);

  return p_job;
end;
$$;

revoke all on function public._do_choose_worker(text, uuid) from public, anon, authenticated;

-- choose_worker() itself is unchanged in every way that matters: same
-- name, same two arguments, same auth.jwt() gate, same ownership check.
-- Everything past establishing "this is genuinely the job's client" now
-- lives in _do_choose_worker, same split approve_stage() went through.
create or replace function public.choose_worker(p_job text, p_quote uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_email text := lower(nullif(btrim(auth.jwt()->>'email'), ''));
  v_client_email text;
begin
  if v_email is null then
    raise exception 'Sign in as the client of this job to choose a worker.'
      using errcode = '28000';
  end if;

  select lower(coalesce(client_email, '')) into v_client_email from jobs where id = p_job;
  if v_client_email is null then raise exception 'no such job'; end if;
  if v_client_email is distinct from v_email then
    raise exception 'only the client of this job may choose';
  end if;

  perform public._do_choose_worker(p_job, p_quote);
end;
$$;

-- ── The WhatsApp path ────────────────────────────────────────────────────
-- p_phone is whatever the Edge Function read off the inbound message,
-- matched on the same last-nine-digit tail every phone comparison in this
-- repository uses, against THIS job's own client_phone, not a global
-- lookup. Records the client's own scope_agreements row first, honestly:
-- this is what the reply IS, per the founder's decision, not a side
-- effect of it. If the worker's own side is not yet agreed,
-- _do_choose_worker refuses in exactly the same words the portal would,
-- and nothing about that check is loosened for this door.
-- A trap worth writing down: the first version of this function inserted
-- the client's scope_agreements row and then called _do_choose_worker in
-- the same breath. If the worker had not agreed their own side yet,
-- _do_choose_worker's refusal aborted the whole call, one Postgres
-- transaction, and the client's own agreement, recorded a moment earlier
-- in the SAME call, was rolled back along with it. Caught live, not read
-- off the code: the insert and the refusal both looked right in isolation.
-- Fixed by never letting a "not both agreed yet" outcome raise from this
-- function at all: it checks readiness itself before calling the core, and
-- returns a distinct marker instead of an error when the worker's side is
-- still missing, so the client's own confirmation survives on its own.
-- Nothing then auto-completes the booking the moment the worker's side
-- lands, on purpose: the signed-in portal does not do that either
-- (agreeScope() is a bare insert, nothing re-attempts choose_worker()
-- afterwards), so this matches the product's existing behaviour rather
-- than inventing a livelier one only for this door.
create or replace function public.choose_worker_via_whatsapp(p_job text, p_phone text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  j record;
  v_tail text := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 9);
  v_count integer;
  v_quote uuid;
  v_worker_email text;
  v_worker_ready boolean;
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

  select count(*), (array_agg(id))[1], (array_agg(worker_email))[1]
    into v_count, v_quote, v_worker_email
    from public.job_quotes
   where job_id = p_job and status = 'submitted';

  if coalesce(v_count, 0) = 0 then
    raise exception 'No price is open on this job to accept.';
  end if;

  if v_count > 1 then
    raise exception 'More than one price is open on this job. Use the link to choose.';
  end if;

  insert into public.scope_agreements (job_id, side, email)
  values (p_job, 'client', 'whatsapp:+' || v_tail)
  on conflict (job_id, side) do nothing;

  select exists (
    select 1 from public.scope_agreements
     where job_id = p_job and side = 'worker' and lower(email) = lower(v_worker_email)
  ) into v_worker_ready;

  if not v_worker_ready then
    return 'PENDING_WORKER_SCOPE';
  end if;

  return public._do_choose_worker(p_job, v_quote);
end;
$$;

-- No grant to authenticated, and none to anon or public either: this is
-- reached only from yaad-inbound, on the service role, after it has
-- already matched the sender's number to this exact job and asked for the
-- job's own code back.
revoke all on function public.choose_worker_via_whatsapp(text, text) from public, anon, authenticated;

-- ── One more thing to tell the client, and only once ────────────────────
-- notify_client_on_job_change() already fires on the jobs UPDATE that
-- booking a worker produces (choose_worker and choose_worker_via_whatsapp
-- both write worker_email the same way, so one condition covers a portal
-- tap and a WhatsApp reply alike, the same reasoning 20260831i used to
-- move quote_arrived off the UI call site in the first place). The secret
-- is not regenerated: recovered from the already-deployed
-- notify_client_quote_arrived()'s own prosrc, the same way every change to
-- this function has done it since the mismatch this repository hit twice
-- already the same afternoon. The evidence_landed and stage_released
-- branches are carried forward unchanged; only a third branch is added.
do $do$
declare
  s      text;
  fn_url text := 'https://leffyisvfvjwzilydlwf.supabase.co/functions/v1/yaad-notify-client';
  pubkey text := 'sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz';
begin
  select substring(prosrc from '''secret'', ''([0-9a-f]+)''')
    into s
    from pg_proc
   where proname = 'notify_client_quote_arrived';

  if s is null then
    raise exception 'Could not recover the existing notify trigger secret from notify_client_quote_arrived().';
  end if;

  execute format($f$
    create or replace function public.notify_client_on_job_change()
    returns trigger
    language plpgsql
    security definer
    set search_path to 'public'
    as $fn$
    begin
      if coalesce(old.status,'') is distinct from 'evidence' and new.status = 'evidence' then
        perform net.http_post(
          url := %L,
          body := jsonb_build_object('secret', %L, 'jobId', new.id, 'kind', 'evidence_landed'),
          headers := jsonb_build_object('Content-Type','application/json','apikey',%L,'Authorization','Bearer '||%L),
          timeout_milliseconds := 45000
        );
      end if;

      if coalesce(new.stage,0) > coalesce(old.stage,0)
         and exists (select 1 from public.stage_approvals a where a.job_id = new.id and a.stage = old.stage)
      then
        perform net.http_post(
          url := %L,
          body := jsonb_build_object('secret', %L, 'jobId', new.id, 'kind', 'stage_released'),
          headers := jsonb_build_object('Content-Type','application/json','apikey',%L,'Authorization','Bearer '||%L),
          timeout_milliseconds := 15000
        );
      end if;

      if coalesce(old.worker_email,'') = '' and coalesce(new.worker_email,'') <> '' then
        perform net.http_post(
          url := %L,
          body := jsonb_build_object('secret', %L, 'jobId', new.id, 'kind', 'quote_accepted'),
          headers := jsonb_build_object('Content-Type','application/json','apikey',%L,'Authorization','Bearer '||%L),
          timeout_milliseconds := 15000
        );
      end if;

      return new;
    end;
    $fn$;
  $f$, fn_url, s, pubkey, pubkey, fn_url, s, pubkey, pubkey, fn_url, s, pubkey, pubkey);
end
$do$;
