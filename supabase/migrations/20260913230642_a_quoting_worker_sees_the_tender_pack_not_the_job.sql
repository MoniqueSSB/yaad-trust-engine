-- A worker who has quoted on a job, and is not booked on it, gets the tender
-- pack and not the site file. Founder's decision, 13 September 2026, recorded
-- in DECISIONS.md under the same date.
--
-- WHAT WAS WRONG. "workers can read their own jobs" (20260901g) returned the
-- whole jobs row to any worker with a job_quotes row on the job, whatever the
-- quote's status, declined included. Any active vetted worker can quote any
-- open job, so the whole vetted bench could read, straight from the API, the
-- client's name, email and phone, the street address, the access contact, the
-- unscrubbed description, the walkthrough notes and link, the payment fields
-- and portal_code. portal_code is the bearer code for /jobs/<id>/quotes, and
-- quotes_for_code() hands whoever holds it every rival quote on the job:
-- names, labour, materials, notes. Proved on production before this change,
-- acting as a real quoted-only worker in a transaction that was rolled back.
-- The portal pages hid most of it. The page is not the control; this is.
--
-- WHAT A QUOTING WORKER SEES NOW. What the public board shows: title, parish,
-- trade, job type, status, the description as board_descr() scrubs it, and
-- the photographs the client put on the board. Plus their own quote and their
-- own Kickoff Pack, which have always had their own read rules. It stays that
-- way after the client picks somebody else: the job remains theirs to look at
-- as a closed quote, board level only.
--
-- 1. jobs: the row goes to the client and the booked worker only.
-- 2. my_quoted_jobs(): the tender pack, safe columns only, one row per job.
-- 3. job_photos and the intake bucket: the board's own photos, for a worker
--    who quoted, after the job has left the board as well as before.
-- 4. quote_agreements and quote_pack_drafts: the two read rules that reached a
--    quoting worker only by joining a jobs row they can no longer see get a
--    route of their own through job_quotes.
-- 5. job_open_for_quotes() refuses a job with no client email, and the public
--    board stops listing one. A code presented against a job with no client
--    email makes the presenter its client (claim_code_as_me, pend_portal_code),
--    so a quoting worker who could read the code could have made themselves
--    the client. No such job was open on 13 Sep 2026; this keeps it that way.
-- 6. job_client_email_matches() stops treating "no email" as a match for a job
--    whose client email is blank. jq_select_client uses it with the caller's
--    JWT email, which is null for anybody not signed in, so a visitor could
--    read the quotes on such a job. None existed on 13 Sep 2026.
--
-- Nothing here removes a human decision or touches money. Every change only
-- narrows who can read what, except 3 and 4, which give a quoting worker back
-- exactly the board level material 1 takes away from them.

-- 1. ------------------------------------------------------------------------
drop policy if exists "workers can read their own jobs" on public.jobs;
create policy "workers can read their own jobs" on public.jobs
  for select
  to authenticated
  using (
    worker_email is not null
    and lower(worker_email) = lower(auth.jwt() ->> 'email')
  );

-- 2. ------------------------------------------------------------------------
-- Security definer so it can read the jobs row the caller no longer can, which
-- is exactly why its column list is the whole of the control: nothing it does
-- not return can leak through it. Adding a column here is a data protection
-- decision, not a convenience. The scrubbed description is computed in here,
-- because scrubbing a name out of a description means reading the name.
-- One row per job: the newest live quote if there is one, else the newest.
create or replace function public.my_quoted_jobs()
returns table(
  id text,
  title text,
  parish text,
  trade text,
  job_type text,
  stage integer,
  status text,
  updated_at timestamptz,
  descr text,
  quote_id uuid,
  quote_status text
)
language sql
stable
security definer
set search_path = 'public'
as $function$
  select distinct on (j.id)
         j.id, j.title, j.parish, j.trade, j.job_type, j.stage, j.status, j.updated_at,
         public.board_descr(j.descr, j.client_name, j.client_email, j.client_phone),
         q.id, q.status
    from public.job_quotes q
    join public.jobs j on j.id = q.job_id
   where auth.uid() is not null
     and q.worker_user = auth.uid()
   order by j.id,
            (q.status in ('submitted', 'quote_confirmed', 'kickoff_requested', 'accepted')) desc,
            q.created_at desc;
$function$;

revoke all on function public.my_quoted_jobs() from public, anon;
grant execute on function public.my_quoted_jobs() to authenticated;

-- 3. ------------------------------------------------------------------------
-- The same test the board applies (board_ok), keyed to "you quoted on this
-- job" instead of "the job is still on the board".
drop policy if exists "quoting worker sees the board photos of a job they quoted" on public.job_photos;
create policy "quoting worker sees the board photos of a job they quoted" on public.job_photos
  for select
  to authenticated
  using (
    board_ok
    and exists (
      select 1 from public.job_quotes q
       where q.job_id = job_photos.job_id
         and q.worker_user = auth.uid()
    )
  );

drop policy if exists "quoting worker reads board photo files of a job they quoted" on storage.objects;
create policy "quoting worker reads board photo files of a job they quoted" on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'intake'
    and exists (
      select 1
        from public.job_photos p
        join public.job_quotes q on q.job_id = p.job_id
       where p.storage_path = objects.name
         and p.board_ok
         and (storage.foldername(objects.name))[2] = p.job_id
         and q.worker_user = auth.uid()
    )
  );

-- 4. ------------------------------------------------------------------------
-- Was: join job_quotes to jobs, then match the client's email or the quote's
-- worker email. The worker half only worked while the jobs row was visible.
-- Same two people decide it now, without the join.
drop policy if exists "parties read quote agreements" on public.quote_agreements;
create policy "parties read quote agreements" on public.quote_agreements
  for select
  using (
    exists (
      select 1 from public.job_quotes q
       where q.id = quote_agreements.quote_id
         and (
           public.job_client_email_matches(q.job_id, auth.jwt() ->> 'email')
           or (
             coalesce(q.worker_email, '') <> ''
             and lower(q.worker_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
           )
         )
    )
  );

-- The approved quote pack a worker priced against. "workers can read drafts
-- for open jobs" is left as it is; in practice it only ever reached a worker
-- who could see the jobs row, which after 1 is nobody it did not already cover.
drop policy if exists "quoting worker reads the approved draft of a job they quoted" on public.quote_pack_drafts;
create policy "quoting worker reads the approved draft of a job they quoted" on public.quote_pack_drafts
  for select
  to authenticated
  using (
    status = 'approved'
    and exists (
      select 1 from public.job_quotes q
       where q.job_id = quote_pack_drafts.job_id
         and q.worker_user = auth.uid()
    )
  );

-- 5. ------------------------------------------------------------------------
create or replace function public.job_open_for_quotes(jid text)
returns boolean
language sql
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1 from jobs j
    where j.id = jid
      and j.open
      and coalesce(j.worker_email, '') = ''
      and j.stage = 0
      and coalesce(btrim(j.client_email), '') <> ''
  );
$function$;

-- The board view as production runs it (20260909150000), plus the same test,
-- so a worker never finds a job on the board that refuses their price.
create or replace view public.open_jobs as
 SELECT j.id,
    j.title,
    j.parish,
    board_descr(j.descr, j.client_name, j.client_email, j.client_phone) AS descr,
    j.updated_at,
    cp.user_id IS NOT NULL AS client_signed,
    COALESCE(cp.jobs_completed, 0) AS client_jobs_completed,
    j.trade,
    j.job_type,
    j.size_band,
    j.access_type,
    j.materials_by,
    j.urgency,
    j.materials_store_type
   FROM jobs j
     LEFT JOIN client_profiles cp ON lower(cp.email) = lower(COALESCE(j.client_email, ''::text))
  WHERE j.open = true
    AND COALESCE(j.worker_email, ''::text) = ''::text
    AND j.stage = 0
    AND j.is_test = false
    AND COALESCE(btrim(j.client_email), ''::text) <> ''::text;

-- 6. ------------------------------------------------------------------------
create or replace function public.job_client_email_matches(p_job_id text, p_email text)
returns boolean
language sql
security definer
set search_path = 'public'
stable
as $function$
  select coalesce(btrim(p_email), '') <> ''
     and exists (
       select 1 from jobs j
       where j.id = p_job_id
         and lower(coalesce(j.client_email, '')) = lower(btrim(p_email))
     );
$function$;
