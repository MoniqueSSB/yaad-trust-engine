-- Direct consequence of 20260901f. Booking used to happen before or
-- exactly alongside a Kickoff Pack; every downstream check that answers
-- "who is the worker on this job" by reading jobs.worker_email was written
-- against that assumption. Now a pack is drafted and confirmed BEFORE
-- booking, against a specific quote, so jobs.worker_email is still blank
-- while it exists. Four places read that assumption and would have quietly
-- locked a worker out of their own pack.
--
-- 1. agree_kickoff_pack(): matched the "worker" side of a confirmation
--    against jobs.worker_email. Pre-booking that is blank, so the worker's
--    own confirmation would have hit "Only the client or worker on this
--    job may confirm it." every time. Now checks the pack's own quote_id
--    first, falling back to jobs.worker_email for the post-booking case.
--
-- 2. RLS on jobs ("workers can read their own jobs"): a worker with a live
--    quote but no booking could not read the job row at all, which is what
--    every portal page's own role detection (client_email / worker_email
--    match) depends on. Now also true for a worker with any job_quotes row
--    on that job.
--
-- 3. RLS on kickoff_packs ("parties read approved packs") and
--    kickoff_pack_agreements ("parties read kickoff pack agreements"):
--    same shape of fix, via the pack's own quote_id this time rather than
--    the job's.
--
-- 4. job_quotes RLS ("jq_select_client"): a client's own quote list only
--    ever showed 'submitted' or 'accepted'. The moment request_kickoff_as_me
--    moves a quote to 'kickoff_requested' it would vanish from the
--    client's own portal view of their own job. 'kickoff_requested' added.
--
-- Not fixed here, flagged instead: notify_worker_kickoff_pack_ready() and
-- yaad-notify-client's kickoff_pack_ready handling still resolve the
-- worker and the pack by job_id alone. That is a live bug under this
-- migration (the WhatsApp nudge can find the wrong worker or the wrong
-- pack once two are in flight on the same job) and needs an edge function
-- change, done in the same commit as this migration, not inside it.

create or replace function public.agree_kickoff_pack(p_pack_id text, p_code text)
returns table(agreed_side text, both_confirmed boolean)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_pack  kickoff_packs%rowtype;
  v_job   jobs%rowtype;
  v_quote job_quotes%rowtype;
  v_email text := lower(nullif(btrim(auth.jwt()->>'email'), ''));
  v_side  text;
  v_both  boolean;
begin
  if v_email is null then
    raise exception 'Sign in to confirm this pack.' using errcode = '28000';
  end if;

  select * into v_pack from kickoff_packs where id = p_pack_id;
  if not found then raise exception 'No such Kickoff Pack.' using errcode = 'check_violation'; end if;
  if v_pack.status <> 'approved' then
    raise exception 'This pack has not been issued yet.' using errcode = 'check_violation';
  end if;
  if v_pack.confirm_code is null or upper(btrim(p_code)) <> v_pack.confirm_code then
    raise exception 'That confirmation code does not match the current version of this pack. Open it again for the latest link.'
      using errcode = 'check_violation';
  end if;

  select * into v_job from jobs where id = v_pack.job_id;

  if v_pack.quote_id is not null then
    select * into v_quote from job_quotes where id = v_pack.quote_id;
  end if;

  if lower(coalesce(v_job.client_email,'')) = v_email then
    v_side := 'client';
  elsif v_quote.id is not null and lower(coalesce(v_quote.worker_email,'')) = v_email then
    v_side := 'worker';
  elsif lower(coalesce(v_job.worker_email,'')) = v_email then
    v_side := 'worker';
  else
    raise exception 'Only the client or worker on this job may confirm it.' using errcode = '28000';
  end if;

  insert into public.kickoff_pack_agreements (pack_id, rev, side, email, agreed_at)
  values (p_pack_id, v_pack.rev, v_side, v_email, now())
  on conflict (pack_id, rev, side) do nothing;

  v_both :=
    exists (select 1 from public.kickoff_pack_agreements
             where pack_id = p_pack_id and rev = v_pack.rev and side = 'client')
    and exists (select 1 from public.kickoff_pack_agreements
             where pack_id = p_pack_id and rev = v_pack.rev and side = 'worker');

  if v_both and v_pack.both_confirmed_at is null then
    update public.kickoff_packs set both_confirmed_at = now() where id = p_pack_id;
  end if;

  return query select v_side, v_both;
end $function$;

create or replace function public.notify_worker_kickoff_pack_ready()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
    begin
      if coalesce(old.status,'') is distinct from 'approved' and new.status = 'approved' then
        perform net.http_post(
          url := 'https://leffyisvfvjwzilydlwf.supabase.co/functions/v1/yaad-notify-client',
          body := jsonb_build_object(
            'secret', '4cfc0fc962b534f961e3d2dbdc30b1996c273340c361b3dd9992742718d65613',
            'jobId', new.job_id,
            'kind', 'kickoff_pack_ready',
            'meta', jsonb_build_object('quoteId', new.quote_id)
          ),
          headers := jsonb_build_object('Content-Type','application/json','apikey','sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz','Authorization','Bearer '||'sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz'),
          timeout_milliseconds := 15000
        );
      end if;
      return new;
    end;
    $function$;

drop policy "workers can read their own jobs" on public.jobs;
create policy "workers can read their own jobs" on public.jobs
  for select
  to authenticated
  using (
    (worker_email is not null and lower(worker_email) = lower(auth.jwt() ->> 'email'))
    or exists (
      select 1 from public.job_quotes q
       where q.job_id = jobs.id and q.worker_user = auth.uid()
    )
  );

drop policy "parties read approved packs" on public.kickoff_packs;
create policy "parties read approved packs" on public.kickoff_packs
  for select
  to authenticated
  using (
    status = 'approved'
    and (
      exists (
        select 1 from jobs j
         where j.id = kickoff_packs.job_id
           and (
             lower(coalesce(j.client_email, '')) = lower(auth.jwt() ->> 'email')
             or lower(coalesce(j.worker_email, '')) = lower(auth.jwt() ->> 'email')
           )
      )
      or exists (
        select 1 from job_quotes q
         where q.id = kickoff_packs.quote_id and q.worker_user = auth.uid()
      )
    )
  );

drop policy "parties read kickoff pack agreements" on public.kickoff_pack_agreements;
create policy "parties read kickoff pack agreements" on public.kickoff_pack_agreements
  for select
  to authenticated
  using (
    exists (
      select 1 from kickoff_packs p
      join jobs j on j.id = p.job_id
       where p.id = kickoff_pack_agreements.pack_id
         and (
           lower(coalesce(j.client_email, '')) = lower(auth.jwt() ->> 'email')
           or lower(coalesce(j.worker_email, '')) = lower(auth.jwt() ->> 'email')
         )
    )
    or exists (
      select 1 from kickoff_packs p
      join job_quotes q on q.id = p.quote_id
       where p.id = kickoff_pack_agreements.pack_id and q.worker_user = auth.uid()
    )
  );

drop policy jq_select_client on public.job_quotes;
create policy jq_select_client on public.job_quotes
  for select
  to authenticated
  using (
    status = any (array['submitted','kickoff_requested','accepted'])
    and exists (
      select 1 from jobs j
       where j.id = job_quotes.job_id
         and lower(coalesce(j.client_email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
    )
  );
