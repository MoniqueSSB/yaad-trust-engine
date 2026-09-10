-- A job carries its own files, from either side.
--
-- Founder instruction, 10 Sep 2026: "worker and client should be able to
-- upload documents and pictures to their portal job." Pictures already had
-- two routes (evidence, and the client's photos of the job). Documents had
-- none: a supplier receipt, a quote on letterhead, a permit, a plan, a
-- warranty, a certificate. Both existing routes refuse anything that is not
-- an image, and the intake bucket refuses non-images at the storage layer.
--
-- WHY NOT THE EVIDENCE TABLE. Any evidence row flips the job to 'evidence'
-- (sync_job_status), is snapshotted into the stage approval
-- (_do_approve_stage), and locks the independent-check picker
-- (job_check_locked). A PDF permit is not evidence of work. It gets its own
-- table and its own bucket so none of those three ever read it.
--
-- THE SHAPE. Same as job_photos and evidence: the browser posts to a Server
-- Action, the action writes into a PRIVATE bucket through the person's own
-- session, and Postgres decides. The path prefix is the side that sent it,
-- 'client/<job>/' or 'worker/<job>/', and job_party_side() is the one
-- function both the table policy and the storage policy ask, so the two can
-- never disagree about who is who on a job.
--
-- MUTABILITY. The uploader can take their own file back until the job is
-- complete; after that everything on the job freezes. Nothing is ever
-- updated in place: a changed document is a new row. The sha256 is computed
-- on the server from the exact bytes stored, the same rule as evidence.
--
-- NO MODEL READS THESE. There is no consent gate here because there is no
-- destination: a job file goes to storage and to the two people on the job
-- and the desk, and nowhere else.

-- ---------------------------------------------------------------- bucket

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('job-files', 'job-files', false, 26214400,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ------------------------------------------------------------ who is who

-- 'client', 'worker', or null: which side of this job the caller is. One
-- answer for the table policy and the storage policy alike.
create or replace function public.job_party_side(p_job text)
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  select case
    when lower(coalesce(j.client_email, '')) = lower(coalesce(auth.jwt() ->> 'email', '')) and coalesce(j.client_email, '') <> '' then 'client'
    when lower(coalesce(j.worker_email, '')) = lower(coalesce(auth.jwt() ->> 'email', '')) and coalesce(j.worker_email, '') <> '' then 'worker'
    else null
  end
  from public.jobs j
  where j.id = p_job;
$$;

revoke all on function public.job_party_side(text) from public, anon;
grant execute on function public.job_party_side(text) to authenticated;

-- ----------------------------------------------------------------- table

create table if not exists public.job_files (
  id            uuid primary key default gen_random_uuid(),
  job_id        text not null references public.jobs(id) on delete cascade,
  side          text not null check (side in ('client', 'worker')),
  uploaded_by   text not null,
  kind          text not null default 'other'
                  check (kind in ('receipt', 'quote', 'permit', 'plan', 'certificate', 'other')),
  label         text not null default '',
  storage_path  text not null unique,
  mime          text not null,
  bytes         bigint not null check (bytes > 0),
  sha256        text not null,
  created_at    timestamptz not null default now()
);

comment on table public.job_files is
  'Documents and pictures either party attaches to a job: receipts, quotes, permits, plans, certificates. Not evidence: nothing in the approval or status path reads this table. Files live in the private job-files bucket under <side>/<job>/.';
comment on column public.job_files.sha256 is
  'Computed on the server from the exact bytes stored, written once. Never recomputed on read.';

create index if not exists job_files_job_idx on public.job_files (job_id, created_at);

alter table public.job_files enable row level security;

drop policy if exists "admin full job_files" on public.job_files;
create policy "admin full job_files"
  on public.job_files for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "job party reads the job's files" on public.job_files;
create policy "job party reads the job's files"
  on public.job_files for select to authenticated
  using (public.job_party_side(job_id) is not null);

-- The side on the row is the side the caller actually is, the name on the
-- row is the caller's own, the path is inside that side's folder for that
-- job, and the job is still open. All four, or nothing.
drop policy if exists "job party adds a file on their own side" on public.job_files;
create policy "job party adds a file on their own side"
  on public.job_files for insert to authenticated
  with check (
    side = public.job_party_side(job_id)
    and lower(uploaded_by) = lower(coalesce(auth.jwt() ->> 'email', ''))
    and storage_path like side || '/' || job_id || '/%'
    and exists (
      select 1 from public.jobs j
       where j.id = job_id and j.status not in ('complete', 'cancelled')
    )
  );

drop policy if exists "uploader removes their own file while the job is open" on public.job_files;
create policy "uploader removes their own file while the job is open"
  on public.job_files for delete to authenticated
  using (
    lower(uploaded_by) = lower(coalesce(auth.jwt() ->> 'email', ''))
    and public.job_party_side(job_id) is not null
    and exists (
      select 1 from public.jobs j
       where j.id = job_id and j.status <> 'complete'
    )
  );

-- No update policy on purpose. A changed document is a new row.

-- --------------------------------------------------------------- storage

drop policy if exists "admins read job files" on storage.objects;
create policy "admins read job files"
  on storage.objects for select to authenticated
  using (bucket_id = 'job-files' and public.is_admin());

drop policy if exists "admins write job files" on storage.objects;
create policy "admins write job files"
  on storage.objects for all to authenticated
  using (bucket_id = 'job-files' and public.is_admin())
  with check (bucket_id = 'job-files' and public.is_admin());

-- The folder is the caller's own side on that job, and nothing else.
drop policy if exists "job party uploads a file on their own side" on storage.objects;
create policy "job party uploads a file on their own side"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'job-files'
    and (storage.foldername(name))[1] = public.job_party_side((storage.foldername(name))[2])
  );

drop policy if exists "job party reads the job's files" on storage.objects;
create policy "job party reads the job's files"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'job-files'
    and public.job_party_side((storage.foldername(name))[2]) is not null
  );

-- Cleanup only, same shape and same reason as the intake and evidence
-- buckets: an upload whose row was then refused would leave a file nothing
-- points at, and taking a file back removes the row first and the file
-- second. The moment a row points at the path, only an admin can remove it.
drop policy if exists "job party removes an unreferenced upload of their own" on storage.objects;
create policy "job party removes an unreferenced upload of their own"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'job-files'
    and (storage.foldername(name))[1] = public.job_party_side((storage.foldername(name))[2])
    and not exists (
      select 1 from public.job_files f where f.storage_path = storage.objects.name
    )
  );

-- ------------------------------------------------------------------ desk

create or replace view public.v_job_files
with (security_invoker = true) as
  select f.id, f.job_id, f.side, f.uploaded_by, f.kind, f.label,
         f.storage_path, f.mime, f.bytes, f.created_at,
         j.title, j.parish, j.status as job_status,
         j.client_name, j.worker_name
    from public.job_files f
    join public.jobs j on j.id = f.job_id;

grant select on public.v_job_files to authenticated;
