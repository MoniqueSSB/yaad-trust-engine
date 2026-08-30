-- Applied to production 30 Aug 2026 via MCP as
-- the_evidence_bucket_had_no_door_for_the_worker.
--
-- The private evidence bucket was created on 27 Aug and had been empty ever
-- since. Photographs went into evidence.img as a base64 data URL instead,
-- which capped a photograph at what a Server Action body would carry, put
-- megabytes of base64 in a table row, and shipped every image on a job to the
-- browser on page load. storage_path, bytes and mime were added for the real
-- thing and nothing ever wrote them.
--
-- The reason it stayed empty is here: storage.objects granted the evidence
-- bucket to is_admin() and nobody else, so a worker holding their own session
-- could not put a file in the bucket built for their files.
--
-- These policies open exactly the door public.evidence already opens and no
-- wider. The predicate is the same EXISTS that "job party can insert evidence"
-- uses, matched against the first folder of the object path, which is the job
-- id. A worker who may file an evidence ROW for a job may now file the FILE
-- for that same job, and for no other.
--
-- Proven on 30 Aug inside a rolled back transaction, by setting role and
-- request.jwt.claims and attempting the insert:
--   worker on the job, own folder ....... ALLOWED
--   client on the job, same folder ...... ALLOWED
--   a signed in stranger ................ REFUSED
--   anon, holding the publishable key ... REFUSED
--   objects a stranger can see in it .... 0
--
-- There is deliberately no UPDATE policy. "Nothing here can be edited after"
-- is the promise the ledger makes, and an object that can be overwritten in
-- place would make the sha256 on the row a fingerprint of something that is
-- no longer there.

create policy "job party can upload evidence files"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'evidence'
    and exists (
      select 1 from public.jobs j
      where j.id = (storage.foldername(name))[1]
        and (lower(j.worker_email) = lower(auth.jwt() ->> 'email')
          or lower(j.client_email) = lower(auth.jwt() ->> 'email'))
    )
  );

create policy "job party can read evidence files"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'evidence'
    and exists (
      select 1 from public.jobs j
      where j.id = (storage.foldername(name))[1]
        and (lower(j.worker_email) = lower(auth.jwt() ->> 'email')
          or lower(j.client_email) = lower(auth.jwt() ->> 'email'))
    )
  );

-- Cleanup, and only cleanup. An upload that succeeded and whose row was then
-- refused (the materials gate does refuse rows) would otherwise leave an
-- object nothing points at. This lets the uploader remove that object and
-- nothing else: the moment an evidence row references the path, the NOT EXISTS
-- fails and the file is immutable for everyone except an admin.
--
-- Not provable the way the others were. Postgres refuses a raw DELETE on
-- storage tables outright ("Direct deletion from storage tables is not
-- allowed. Use the Storage API instead."), so the rolled back probe could not
-- reach this predicate. It is exercised only through the Storage API, which is
-- how evidence-actions.ts calls it.
create policy "job party can remove an unreferenced upload"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'evidence'
    and not exists (select 1 from public.evidence e where e.storage_path = storage.objects.name)
    and exists (
      select 1 from public.jobs j
      where j.id = (storage.foldername(name))[1]
        and (lower(j.worker_email) = lower(auth.jwt() ->> 'email')
          or lower(j.client_email) = lower(auth.jwt() ->> 'email'))
    )
  );
