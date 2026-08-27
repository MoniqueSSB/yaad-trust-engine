-- Evidence and document storage, per [C] Evidence & Document Storage Design v1.
-- Applied 27 Aug 2026 as supabase migration 20260827110257.
--
-- Four private buckets. None are public. A scan of somebody's passport must
-- never be reachable by guessing a URL, so nothing here is served directly:
-- files are read through short-lived signed URLs minted by the server AFTER
-- Postgres has confirmed the viewer is entitled to that specific file.
--
-- Entitlement is decided by the database, not by possession of a link. A
-- forwarded link expires; a screenshot of a URL is useless.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('evidence',   'evidence',   false, 524288000, null),
  ('vetting',    'vetting',    false,  26214400,
     array['image/jpeg','image/png','image/heic','image/webp','application/pdf']),
  ('intake',     'intake',     false,  26214400,
     array['image/jpeg','image/png','image/heic','image/webp']),
  ('signatures', 'signatures', false,   2097152,
     array['image/png','image/jpeg'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Direct access is closed to everybody holding a browser token. Uploads arrive
-- on a signed upload URL the server mints for one path; reads happen on a
-- signed download URL minted per request. Neither needs anon or authenticated
-- to be granted anything, so neither gets it. Server Actions use the service
-- role, which bypasses RLS. Admins are granted read so the desk can work.

drop policy if exists "admins read every bucket"  on storage.objects;
drop policy if exists "admins write every bucket" on storage.objects;

create policy "admins read every bucket"
  on storage.objects for select to authenticated
  using (bucket_id in ('evidence','vetting','intake','signatures') and public.is_admin());

create policy "admins write every bucket"
  on storage.objects for all to authenticated
  using (bucket_id in ('evidence','vetting','intake','signatures') and public.is_admin())
  with check (bucket_id in ('evidence','vetting','intake','signatures') and public.is_admin());

-- Paths carry no personal data, so worker_profiles needs a stable key that is
-- not an email the worker controls. Paths turn up in logs and support tickets.
alter table public.worker_profiles
  add column if not exists worker_user uuid references auth.users(id);

create unique index if not exists worker_profiles_worker_user_key
  on public.worker_profiles (worker_user) where worker_user is not null;

-- Evidence integrity. A file in a bucket can be replaced silently, a hash
-- cannot. Approval binds to the hashes present when the client approved.
alter table public.evidence
  add column if not exists storage_path text,
  add column if not exists sha256       text,
  add column if not exists bytes        bigint,
  add column if not exists mime         text,
  add column if not exists captured_at  timestamptz;

comment on column public.evidence.sha256 is
  'Computed at upload, never changes. Approval binds to this, not to the file.';
comment on column public.evidence.captured_at is
  'When the photograph was taken, as opposed to created_at, when it reached us.';

-- Vetting documents get a deletion clock. Holding a government ID forever is a
-- liability under UK GDPR and the Jamaican Data Protection Act. The useful
-- artefact is the decision, not the document.
create table if not exists public.vetting_documents (
  id            uuid primary key default gen_random_uuid(),
  worker_user   uuid not null references auth.users(id),
  doc_type      text not null check (doc_type in
                  ('photo_id','selfie_with_id','police_check','proof_of_address','trn')),
  storage_path  text,
  sha256        text,
  bytes         bigint,
  mime          text,
  verified_by   text,
  verified_at   timestamptz,
  outcome       text check (outcome in ('passed','failed')),
  purge_after   timestamptz,
  purged_at     timestamptz,
  created_at    timestamptz not null default now()
);

comment on table public.vetting_documents is
  'The row survives forever and proves the check happened, who did it and what they decided. The file is destroyed on schedule.';

create index if not exists vetting_documents_worker_idx
  on public.vetting_documents (worker_user);
create index if not exists vetting_documents_purge_idx
  on public.vetting_documents (purge_after)
  where purged_at is null and storage_path is not null;

alter table public.vetting_documents enable row level security;

-- Admins only. Never the client, never another worker. A worker cannot read
-- even their own row: the decision is Yaadly's record, and exposing outcome
-- would leak how vetting is judged.
drop policy if exists "vetting documents are admin only" on public.vetting_documents;
create policy "vetting documents are admin only"
  on public.vetting_documents for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
