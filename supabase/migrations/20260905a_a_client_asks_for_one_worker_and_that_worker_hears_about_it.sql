-- A client asks for one worker by name, and that worker actually hears about it.
--
-- Founder instruction, 5 September 2026: "when you click book a job on a
-- worker profile, it should book that job with that person that the workers
-- will have to continue."
--
-- WHAT WAS THERE BEFORE. The button existed and did almost nothing. A client
-- reading a worker profile taps "Book Ann-Marie for a job", lands on the job
-- wizard with ?worker=<slug>, and the wizard prints her name on the
-- confirmation screen and adds one line of free text to the enquiry email:
--   Client asked for: Ann-Marie Brown
-- Nothing reached the job row. The job went onto the open board like any
-- other, every worker in that trade could quote it, Ann-Marie was never told
-- she had been asked for, and the only trace of the client's choice was a
-- sentence in an email a person had to read and act on by hand. The screen
-- said "we will take this to them first" and no part of the system knew that
-- promise had been made.
--
-- WHAT THIS DOES. FIRST REFUSAL, then it opens up. Founder's choice of the
-- three options put to her, 5 Sep 2026.
--
--   1. The request lands on the job row (requested_worker_email), resolved
--      from the slug server-side in yaad-post-job so a hand-typed slug cannot
--      put a request on a worker nobody vetted.
--   2. The clock starts when the job goes LIVE, not when the draft is saved.
--      A draft nobody finished is not a job anybody should be asked about.
--   3. For 48 hours the job is off the public board and only that worker can
--      quote it. They get a message telling them they were asked for.
--   4. The hold ends the moment any one of three things happens: they quote,
--      they decline, or the 48 hours run out. Then the job joins the board
--      like any other and the client is not left waiting behind somebody who
--      went quiet.
--
-- WHAT THIS IS NOT. It is not a booking. Nothing here books anybody. A job is
-- booked when the CLIENT accepts a quote, by the same _do_choose_worker path
-- as every other job, and jobs.worker_email is still written there and only
-- there. This holds a door open for one person for two days. CLAUDE.md
-- section 2 is untouched: the consequential decision is still the client's,
-- and the worker's own answer here is the worker's, typed by them.
--
-- THE THREE STATES, and why there is no 'accepted'.
--   pending   asked, hold live while inside the window
--   quoted    they priced it; the hold has done its job
--   declined  they said no; the board opens immediately
-- An "accept" button was considered and dropped. Accepting without quoting
-- means nothing to the client, and a state that changes nothing is a state
-- somebody has to be taught. The worker's yes IS their quote.
--
-- 'expired' is not a stored state on purpose. It is the clock, and a clock is
-- computed, not written. Nothing has to run for a hold to lapse, which means
-- there is no cron job whose failure quietly holds jobs shut forever.

begin;

-- ── the columns ────────────────────────────────────────────────────────────
alter table public.jobs
  add column if not exists requested_worker_email text,
  add column if not exists requested_at           timestamptz,
  add column if not exists request_state          text;

alter table public.jobs drop constraint if exists jobs_request_state_chk;
alter table public.jobs add constraint jobs_request_state_chk
  check (request_state is null or request_state in ('pending','quoted','declined'));

create index if not exists jobs_requested_worker_idx
  on public.jobs (lower(requested_worker_email))
  where requested_worker_email is not null;

comment on column public.jobs.requested_worker_email is
  'The one worker this client asked for by name off their profile page. Resolved from the public slug server-side; never taken from the browser. Not a booking: jobs.worker_email is still the only column that says who is booked.';
comment on column public.jobs.requested_at is
  'When the first-refusal clock started, which is when the job went live, not when the draft was saved.';
comment on column public.jobs.request_state is
  'pending, quoted or declined. Never expired: a lapsed window is computed by request_is_live(), so no scheduled job has to run for a hold to end.';

-- ── the clock, in one place ────────────────────────────────────────────────
-- Every gate below reads this function rather than repeating the interval,
-- so the window is changed here and nowhere else.
create or replace function public.request_is_live(p_state text, p_at timestamptz)
returns boolean
language sql
stable
set search_path to ''
as $$
  select p_state = 'pending'
     and p_at is not null
     and p_at > (now() - interval '48 hours')
$$;

comment on function public.request_is_live(text, timestamptz) is
  'Is a named-worker request still holding this job off the open board? The 48 hour first-refusal window lives here and only here.';

grant execute on function public.request_is_live(text, timestamptz) to anon, authenticated, service_role;

-- ── the public board hides a job that is being held ────────────────────────
-- Same columns in the same order as 20260828c. The only change is the last
-- line of the WHERE: a job under a live request is not on the open board,
-- because offering everybody a job that only one person can quote is a worse
-- lie than not showing it at all.
create or replace view public.open_jobs as
 SELECT j.id, j.title, j.parish,
    regexp_replace(regexp_replace(regexp_replace(j.descr, '(^|\n)\s*(Address|Access contact)\s*:[^\n]*'::text, '\1'::text, 'gi'::text), '\+?[0-9][0-9\s().-]{7,}[0-9]'::text, '[contact removed]'::text, 'g'::text), '\n{3,}'::text, '\n\n'::text, 'g'::text) AS descr,
    j.updated_at,
    cp.user_id IS NOT NULL AS client_signed,
    COALESCE(cp.jobs_completed, 0) AS client_jobs_completed,
    j.trade, j.job_type, j.size_band, j.access_type, j.materials_by, j.urgency,
    j.materials_store_type
   FROM jobs j
     LEFT JOIN client_profiles cp ON lower(cp.email) = lower(COALESCE(j.client_email, ''::text))
  WHERE j.open = true AND COALESCE(j.worker_email, ''::text) = ''::text AND j.stage = 0
    AND NOT public.request_is_live(j.request_state, j.requested_at);

-- ── the one worker who was asked can see it ────────────────────────────────
-- A definer view, the same shape and the same masking as open_jobs, filtered
-- to the signed-in worker's own email. It exists because the requested worker
-- is not the booked worker and has no quote yet, so no policy on jobs lets
-- them read the row, and adding one would widen the base table for a case
-- that is really one screen.
--
-- Not granted to anon. There is no such thing as an anonymous requested
-- worker, and a view carrying a live job's description should not answer a
-- caller who has not signed in.
create or replace view public.my_requested_jobs as
  SELECT j.id, j.title, j.parish,
    regexp_replace(regexp_replace(regexp_replace(j.descr, '(^|\n)\s*(Address|Access contact)\s*:[^\n]*'::text, '\1'::text, 'gi'::text), '\+?[0-9][0-9\s().-]{7,}[0-9]'::text, '[contact removed]'::text, 'g'::text), '\n{3,}'::text, '\n\n'::text, 'g'::text) AS descr,
    j.updated_at,
    j.trade, j.job_type, j.size_band, j.access_type, j.materials_by, j.urgency,
    j.materials_store_type,
    j.requested_at,
    j.requested_at + interval '48 hours' AS holds_until
  FROM jobs j
  WHERE j.open = true
    AND COALESCE(j.worker_email, ''::text) = ''::text
    AND j.stage = 0
    AND public.request_is_live(j.request_state, j.requested_at)
    AND lower(COALESCE(j.requested_worker_email, '')) = lower(COALESCE(auth.jwt() ->> 'email', ''));

revoke all on public.my_requested_jobs from public, anon, authenticated;
grant select on public.my_requested_jobs to authenticated;

comment on view public.my_requested_jobs is
  'Jobs a client asked this signed-in worker for by name, still inside the 48 hour first-refusal window. Same masking as open_jobs: no address, no phone number. Read only.';

-- ── nobody else can quote while the hold is live ───────────────────────────
-- Its own trigger rather than a branch inside enforce_vetted_worker_on_quote,
-- which is about vetting and probation and has no business also knowing about
-- requests. Two rules, two functions, either one readable on its own.
create or replace function public.enforce_first_refusal_on_quote()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  j record;
begin
  select requested_worker_email, request_state, requested_at
    into j
    from public.jobs
   where id = new.job_id;

  if j.request_state is null then
    return new;
  end if;

  if not public.request_is_live(j.request_state, j.requested_at) then
    return new;
  end if;

  if lower(coalesce(j.requested_worker_email, '')) = lower(coalesce(new.worker_email, '')) then
    return new;
  end if;

  raise exception
    'This client asked for one worker by name and that worker has first refusal on it until %. It comes onto the open board after that, or sooner if they pass on it.',
    to_char(j.requested_at + interval '48 hours', 'DD Mon HH24:MI')
    using errcode = 'check_violation';
end;
$$;

revoke all on function public.enforce_first_refusal_on_quote() from public, anon, authenticated;

drop trigger if exists trg_first_refusal_on_quote on public.job_quotes;
create trigger trg_first_refusal_on_quote
  before insert on public.job_quotes
  for each row execute function public.enforce_first_refusal_on_quote();

-- ── quoting ends the hold ──────────────────────────────────────────────────
-- The requested worker's yes is their quote, so the moment it lands the job
-- joins the board. The client keeps the quote they wanted and also gets the
-- comparison they would have had anyway. It is their choice which one to
-- take, exactly as before.
create or replace function public.mark_request_quoted()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  update public.jobs
     set request_state = 'quoted', updated_at = now()
   where id = new.job_id
     and request_state = 'pending'
     and lower(coalesce(requested_worker_email, '')) = lower(coalesce(new.worker_email, ''));
  return new;
end;
$$;

revoke all on function public.mark_request_quoted() from public, anon, authenticated;

drop trigger if exists trg_mark_request_quoted on public.job_quotes;
create trigger trg_mark_request_quoted
  after insert on public.job_quotes
  for each row execute function public.mark_request_quoted();

-- ── the worker's own answer ────────────────────────────────────────────────
-- One button, one direction: pass on it. There is no matching accept, for the
-- reason in the header. Scoped to the caller's own email rather than taking a
-- worker identity as an argument, so possession of a job id is not enough to
-- decline somebody else's request.
create or replace function public.worker_decline_job_request(p_job text, p_reason text default null)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  j  record;
begin
  if me = '' then
    raise exception 'Sign in first.' using errcode = 'insufficient_privilege';
  end if;

  select id, requested_worker_email, request_state, requested_at
    into j
    from public.jobs
   where id = p_job;

  if j.id is null then
    raise exception 'No such job.' using errcode = 'no_data_found';
  end if;

  if lower(coalesce(j.requested_worker_email, '')) <> me then
    raise exception 'That request was not made to you.' using errcode = 'insufficient_privilege';
  end if;

  if j.request_state <> 'pending' then
    return j.request_state;
  end if;

  update public.jobs
     set request_state = 'declined',
         descr = coalesce(descr, '') ||
           case when coalesce(btrim(p_reason), '') = '' then ''
                else E'\n\nThe worker asked for passed on it: ' || left(btrim(p_reason), 200)
           end,
         updated_at = now()
   where id = p_job;

  return 'declined';
end;
$$;

revoke all on function public.worker_decline_job_request(text, text) from public, anon;
grant execute on function public.worker_decline_job_request(text, text) to authenticated, service_role;

comment on function public.worker_decline_job_request(text, text) is
  'The requested worker passes on a job. Opens it to the board immediately. Scoped to the caller''s own email, so a job id on its own decides nothing.';

-- ── telling the worker they were asked for ─────────────────────────────────
-- Fires on the transition into open, not on the draft write, so nobody is
-- messaged about a job that was never finished. Same http_post shape and the
-- same vault-held secret as every other notify trigger; see 20260903a.
-- The clock starts when the job goes live. A draft can sit for a week; the 48
-- hours the worker is promised begin the moment the job is real. Stamped in a
-- BEFORE trigger rather than by an UPDATE inside the AFTER trigger below,
-- which would re-enter this same trigger on the same row.
create or replace function public.stamp_request_clock()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if new.open = true
     and coalesce(old.open, false) = false
     and coalesce(new.requested_worker_email, '') <> ''
     and coalesce(new.request_state, '') = 'pending'
     and new.requested_at is null then
    new.requested_at := now();
  end if;
  return new;
end;
$$;

revoke all on function public.stamp_request_clock() from public, anon, authenticated;

drop trigger if exists trg_stamp_request_clock on public.jobs;
create trigger trg_stamp_request_clock
  before update on public.jobs
  for each row execute function public.stamp_request_clock();

create or replace function public.notify_worker_requested()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.open = true
     and coalesce(old.open, false) = false
     and coalesce(new.requested_worker_email, '') <> ''
     and coalesce(new.request_state, '') = 'pending' then

    perform net.http_post(
      url := 'https://leffyisvfvjwzilydlwf.supabase.co/functions/v1/yaad-notify-client',
      body := jsonb_build_object('secret', public.notify_trigger_secret(), 'jobId', new.id, 'kind', 'worker_requested'),
      headers := jsonb_build_object('Content-Type','application/json','apikey','sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz','Authorization','Bearer '||'sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz'),
      timeout_milliseconds := 15000
    );
  end if;
  return new;
end;
$$;

revoke all on function public.notify_worker_requested() from public, anon, authenticated;

drop trigger if exists trg_notify_worker_requested on public.jobs;
create trigger trg_notify_worker_requested
  after update on public.jobs
  for each row execute function public.notify_worker_requested();

-- ── telling the client their worker passed ─────────────────────────────────
-- The confirmation screen tells the client they will hear either way. This is
-- the "either way" half. It fires only on a DECLINE, not on the window
-- lapsing: a lapse is silence, and turning silence into "your worker did not
-- answer" would be Yaadly reporting on somebody's reliability off a two day
-- clock, which is close to a reputation judgement and is not this trigger's
-- to make. The copy the client is shown says a decline is what they hear
-- about, so the promise and the code agree.
create or replace function public.notify_client_request_declined()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.request_state = 'declined' and coalesce(old.request_state, '') = 'pending' then
    perform net.http_post(
      url := 'https://leffyisvfvjwzilydlwf.supabase.co/functions/v1/yaad-notify-client',
      body := jsonb_build_object('secret', public.notify_trigger_secret(), 'jobId', new.id, 'kind', 'request_declined'),
      headers := jsonb_build_object('Content-Type','application/json','apikey','sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz','Authorization','Bearer '||'sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz'),
      timeout_milliseconds := 15000
    );
  end if;
  return new;
end;
$$;

revoke all on function public.notify_client_request_declined() from public, anon, authenticated;

drop trigger if exists trg_notify_client_request_declined on public.jobs;
create trigger trg_notify_client_request_declined
  after update on public.jobs
  for each row execute function public.notify_client_request_declined();

commit;
