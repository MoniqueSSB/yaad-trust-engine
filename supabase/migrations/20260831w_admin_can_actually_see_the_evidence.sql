-- Founder asked to see a photo just filed against a test job and could not:
-- the desk that is supposed to look before the client does had no way to.
-- public.evidence's own SELECT policy already lets an admin read the row
-- (label, sha256, uploaded_by, all of it); the file itself lives in
-- storage.objects, gated by its own separate policy, "job party can read
-- evidence files", which only ever checked the job's client or worker.
-- is_admin() was never in it. /portal/jobs/[id] mints a signed URL through
-- the SIGNED-IN USER's own session (lib/supabase/server.ts), not the
-- service role, so this is exactly the check that decided whether that
-- signed URL comes back with something or comes back null and the photo
-- silently shows as "Filed without an image."

drop policy if exists "job party can read evidence files" on storage.objects;
create policy "job party can read evidence files"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'evidence'
    and (
      public.is_admin()
      or exists (
        select 1 from public.jobs j
        where j.id = (storage.foldername(name))[1]
          and (lower(j.worker_email) = lower(auth.jwt() ->> 'email')
            or lower(j.client_email) = lower(auth.jwt() ->> 'email'))
      )
    )
  );

comment on policy "job party can read evidence files" on storage.objects is
  'This job''s client or worker, or any admin. Upload and delete stay narrower on purpose: an admin looking is oversight, an admin writing into somebody else''s evidence trail is a different thing entirely and was never asked for.';
