-- Applied to production 2 Sep 2026 via MCP, in four parts because the sandbox
-- takes drops and data writes one at a time: board_photos_need_a_publish_gate,
-- the_old_photo_policy_ignored_the_publish_gate,
-- the_demonstration_photo_stays_on_the_board,
-- a_photo_row_cannot_point_at_another_jobs_file. This file is the whole of it.
--
-- Client photographs reach the board for the first time.
--
-- Until now job_photos.img was the only thing anything rendered, and it has
-- been null on every row a real person ever caused. WhatsApp intake has been
-- writing the actual photographs into the private 'intake' bucket since 27
-- Aug and recording storage_path against the row; nothing ever read them
-- back, so the board drew an empty gradient tile and the client's portal drew
-- nothing at all. The only photograph that has ever appeared on the board is
-- a demonstration image baked into the app's own assets.
--
-- Decision, 2 Sep 2026: signed URLs from the private bucket. Not a public
-- job-photos bucket.
--
--   * The photographs are already in the private bucket. A public bucket
--     means either a second home and a copy step, or moving WhatsApp intake
--     into the open, which yaad-inbound refuses in writing: a photograph of
--     the inside of an often-empty house, next to a parish, is a catalogue.
--   * Signing is not a new mechanism here. It is what the evidence bucket
--     has done since 30 Aug, in the portal and in the desk.
--   * A public URL cannot be withdrawn. A signed one is dead in five minutes
--     and a forwarded one is dead on arrival.
--
-- And the part that had to be settled before any of it could be switched on.
-- app.yaadly.co.uk/jobs is a PUBLIC page, and the policy this migration
-- replaces made every photograph on an open job world-readable. Nothing
-- leaked only because img was null. Turning the pictures on, unchanged,
-- would have published every photograph a client sent into a private
-- WhatsApp conversation, to anyone on the internet, in the same deploy.
--
-- So board_ok. Default false, including for every row that already exists.
-- A photograph reaches the public board when a named human at the desk puts
-- it there and not before. The client and the booked worker see their own
-- job's photographs either way, which is the second thing this fixes.

alter table public.job_photos
  add column if not exists board_ok boolean not null default false;

comment on column public.job_photos.board_ok is
  'Published to the public marketplace board. False until a named human at the desk says otherwise: a photograph sent into a private WhatsApp conversation is not consent to publish it.';

-- The one row that already renders is the demonstration image served from the
-- app's own public assets. It is Yaadly's own picture, published by
-- construction, and no client consent question sits behind it. Every other
-- row is a client photograph and stays private.
update public.job_photos set board_ok = true where img is not null;

create index if not exists job_photos_storage_path_idx
  on public.job_photos (storage_path) where storage_path is not null;

-- ---------------------------------------------------------------- the rows

drop policy if exists "photos of open jobs are public" on public.job_photos;

create policy "board photos of open jobs are public" on public.job_photos
  for select to anon, authenticated
  using (board_ok and exists (
    select 1 from public.open_jobs oj where oj.id = job_photos.job_id
  ));

-- The client who sent the photograph, and the worker booked on the job, can
-- always see it, published or not, open or closed. The portal has been
-- querying this table since it was built and getting nothing back the moment
-- a job left the board.
create policy "job party reads their own job photos" on public.job_photos
  for select to authenticated
  using (exists (
    select 1 from public.jobs j
    where j.id = job_photos.job_id
      and (lower(coalesce(j.client_email, '')) = lower(auth.jwt() ->> 'email')
        or lower(coalesce(j.worker_email, '')) = lower(auth.jwt() ->> 'email'))
  ));

-- A client may still add a row against their own job. They may not decide it
-- is published, and they may not name a file: files are written by
-- yaad-inbound on the service role, and publishing is a decision at the desk.
-- Without this, a client could insert a row on their own open job carrying
-- ANOTHER job's storage path, set board_ok, and have the policy below sign
-- somebody else's private photograph for them.
drop policy if exists "client adds photos to own job" on public.job_photos;

create policy "client adds photos to own job" on public.job_photos
  for insert to authenticated
  with check (
    board_ok = false
    and storage_path is null
    and exists (
      select 1 from public.jobs j
      where j.id = job_photos.job_id
        and lower(j.client_email) = lower(auth.jwt() ->> 'email')
    )
  );

-- ---------------------------------------------------------------- the files
--
-- Same shape as "job party can read evidence files" (20260830b): entitlement
-- is decided by Postgres, and a signed URL is only mintable by somebody the
-- database would have shown the row to anyway. Matched on the job_photos row
-- AND on the folder the object sits in, which yaad-inbound has always named
-- after the job ('whatsapp/<job id>/<file>'), so a row that names a path
-- belonging to a different job matches nothing.

drop policy if exists "board photo files are readable"   on storage.objects;
drop policy if exists "job party can read intake files"  on storage.objects;

create policy "board photo files are readable"
  on storage.objects for select to anon, authenticated
  using (
    bucket_id = 'intake'
    and exists (
      select 1
        from public.job_photos p
        join public.open_jobs oj on oj.id = p.job_id
       where p.storage_path = storage.objects.name
         and p.board_ok
         and (storage.foldername(storage.objects.name))[2] = p.job_id
    )
  );

create policy "job party can read intake files"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'intake'
    and (public.is_admin() or exists (
      select 1
        from public.job_photos p
        join public.jobs j on j.id = p.job_id
       where p.storage_path = storage.objects.name
         and (storage.foldername(storage.objects.name))[2] = p.job_id
         and (lower(coalesce(j.client_email, '')) = lower(auth.jwt() ->> 'email')
           or lower(coalesce(j.worker_email, '')) = lower(auth.jwt() ->> 'email'))
    ))
  );

-- Deliberately no INSERT, UPDATE or DELETE policy on the intake bucket. The
-- only thing that writes it is yaad-inbound on the service role, and a
-- photograph a client sent as their account of the job is not something the
-- other side of that job should be able to replace.
--
-- Proven live on 2 Sep, with nothing but the publishable key:
--   anon reads job_photos ............... 1 row, the demonstration listing
--   anon reads a client's WhatsApp row ... refused, 0 rows
--   anon signs an unpublished photo ...... refused, "Object not found"
