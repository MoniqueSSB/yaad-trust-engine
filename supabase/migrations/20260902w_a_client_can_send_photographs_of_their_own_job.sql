-- Applied to production 2 Sep 2026 via MCP as
-- a_client_can_send_photographs_of_their_own_job.
--
-- The client gets a way to send photographs that is not WhatsApp.
--
-- Until now the only path a photograph could take into this system was a
-- WhatsApp message, written by yaad-inbound on the service role. The job
-- wizard said so out loud: "the quickest way to send them is on WhatsApp
-- once we reply". A client who posted on the web and never wrote to the
-- number had no way at all, and photographs are the single thing that turns
-- a guess into a quote.
--
-- The mechanism is the one already used for evidence (20260830b) and for the
-- worker's own documents in /apply: the browser uploads into a private bucket
-- through the client's own session, and a Postgres policy, not the page,
-- decides whether that is allowed. Nothing new is invented here.
--
-- Two folders in one bucket, and the prefix is load bearing. yaad-inbound
-- writes 'whatsapp/<job id>/<file>' on the service role. A client writes
-- 'client/<job id>/<file>' and cannot write anywhere else, so a client can
-- never place a file into, or shadow a file in, the folder the assistant
-- fills. board_ok stays out of their hands either way: putting a photograph
-- on the public board is still a decision at the desk.
--
-- Supersedes the insert policy in 20260902v, which forbade a client-set
-- storage_path outright because at that point nothing legitimate set one.

-- ---------------------------------------------------------------- the rows

drop policy if exists "client adds photos to own job" on public.job_photos;

create policy "client adds photos to own job" on public.job_photos
  for insert to authenticated
  with check (
    board_ok = false
    and source = 'client'
    and storage_path is not null
    and storage_path like 'client/' || job_id || '/%'
    and exists (
      select 1 from public.jobs j
      where j.id = job_photos.job_id
        and lower(j.client_email) = lower(auth.jwt() ->> 'email')
    )
  );

-- A client who sends the wrong picture must be able to take it back. This is
-- not evidence: evidence is immutable on purpose because a fingerprint has to
-- mean something, but a photograph of the job is the client's own account of
-- it and theirs to withdraw. Only their own row, only their own upload, never
-- one the assistant saved from WhatsApp and never once it is on the board,
-- because at that point a human published it and a human takes it down.
create policy "client removes a photo they sent" on public.job_photos
  for delete to authenticated
  using (
    source = 'client'
    and board_ok = false
    and exists (
      select 1 from public.jobs j
      where j.id = job_photos.job_id
        and lower(j.client_email) = lower(auth.jwt() ->> 'email')
    )
  );

-- ---------------------------------------------------------------- the files

create policy "client uploads photos of their own job"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'intake'
    and (storage.foldername(name))[1] = 'client'
    and exists (
      select 1 from public.jobs j
      where j.id = (storage.foldername(name))[2]
        and lower(j.client_email) = lower(auth.jwt() ->> 'email')
    )
  );

-- Cleanup only, same shape and same reason as the evidence bucket's version.
-- An upload that succeeded and whose row was then refused would otherwise
-- leave a file nothing points at, and the client deleting a photograph
-- removes the row first and the file second. The moment a row does point at
-- the path, the NOT EXISTS fails and only an admin can remove it.
create policy "client removes an unreferenced upload of their own"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'intake'
    and (storage.foldername(name))[1] = 'client'
    and not exists (
      select 1 from public.job_photos p where p.storage_path = storage.objects.name
    )
    and exists (
      select 1 from public.jobs j
      where j.id = (storage.foldername(name))[2]
        and lower(j.client_email) = lower(auth.jwt() ->> 'email')
    )
  );

-- Proven 2 Sep 2026 inside rolled back transactions, as role authenticated
-- with request.jwt.claims set to a real client who is NOT an admin. That last
-- part matters and cost a confusing ten minutes: probed as Monique, every
-- refusal came back ALLOWED, because "admin full job_photos" covers her and
-- an INSERT policy with no WITH CHECK falls back to its USING expression.
--
--   their own job, client prefix, private ... ALLOWED
--   publishing it themselves ................ REFUSED
--   naming another job's folder ............. REFUSED
--   somebody else's job ..................... REFUSED
--   writing into the whatsapp/ prefix ....... REFUSED
--   taking their own private photo back ..... ALLOWED
--   deleting the published demo row ......... REFUSED (0 rows, row survives)
--
-- The storage policy could not be probed the same way: Postgres refuses a
-- direct write to storage tables ("Use the Storage API instead"), the same
-- limitation recorded in 20260830b. Its predicate was evaluated directly
-- instead, as that same non-admin client:
--
--   client/JOB-DEMO-PHOTOS/p.jpg ................ true
--   client/<another job>/p.jpg .................. false
--   whatsapp/JOB-DEMO-PHOTOS/p.jpg .............. false
--   client/../whatsapp/JOB-DEMO-PHOTOS/p.jpg .... false
