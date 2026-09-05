-- A worker gets a face, a voice, and work to show.
--
-- Founder instruction, 5 September 2026: "a worker should have a profile video
-- and portfolio to showcase works." Asked which files those should be, she
-- chose the ones already collected at /apply rather than a second upload.
--
-- WHAT WAS ALREADY TRUE, and why this is a publishing change rather than a
-- collection one. /apply has taken a photograph of the tradesperson, a thirty
-- second introduction video and a portfolio file since 3 Sep 2026. All three
-- land in the PRIVATE vetting bucket, on the ninety day purge clock, and the
-- two faces are on IDENTITY_DOCS so no model ever sees them. None of it has
-- ever been shown to anybody but the desk. The public profile's Portfolio
-- section is a different thing entirely: it is built from completed Yaadly
-- jobs, and at launch every worker's is empty.
--
-- TWO THINGS STOOD IN THE WAY, and neither is solved by pointing the page at
-- the private bucket.
--
--   1. CONSENT. The apply screen says, in as many words, "This page does not
--      publish it anywhere." A worker read that sentence and then handed over
--      a picture of their face. Publishing it on the strength of that consent
--      would be reinterpreting an answer the person gave to the opposite
--      question. So there is a NEW consent, with its own version, and a
--      profile shows nothing until it is granted.
--
--   2. THE PURGE. yaad-vetting-purge destroys the file ninety days after it
--      arrives. A profile video published out of that bucket would work for
--      three months and then quietly go missing.
--
-- SO: THE FILE IS COPIED, NOT SHARED. A consented file is copied into a
-- separate PUBLIC bucket and the row here points at the copy. The vetting
-- original keeps its purge clock and is destroyed on time, exactly as the
-- applicant was told. Nothing about the private bucket, its policies or its
-- purge changes in this migration, which is deliberate: the ID rules in
-- CLAUDE.md section 6 are the last thing that should move to make a profile
-- page prettier.
--
-- WITHDRAWING CONSENT HIDES EVERYTHING AT ONCE. The public view tests
-- showcase_consent = 'granted' on every read, so setting it to 'declined'
-- empties the profile immediately, before anybody has to go and delete files.
-- Deleting the files is then a separate, deliberate act at the desk.
--
-- WHAT THIS DOES NOT DO. It does not touch the evidence-backed Portfolio
-- section, and it must never be merged into it. That section's whole claim is
-- "pulled from the evidence record, so nothing here can be borrowed from
-- somebody else's work". What this migration publishes is the worker's own
-- account of themselves. Two different kinds of true, labelled separately on
-- the page, and mixing them would spend the credibility of the first on the
-- second.

begin;

-- ── the public bucket ──────────────────────────────────────────────────────
-- The first public bucket in the project. Everything in it is there because a
-- named human at the desk put it there, on a granted consent, knowing it is
-- world readable. No path in it is secret and none is meant to be.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('showcase', 'showcase', true, 26214400,
  array['image/jpeg','image/png','image/heic','image/webp','application/pdf',
        'video/mp4','video/webm','video/quicktime'])
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Reads are open, because the bucket is public: that is the point. Writes are
-- the desk's alone. A worker cannot publish their own face, and neither can a
-- client, so nothing reaches a public URL without somebody deciding.
drop policy if exists "admins write the showcase bucket" on storage.objects;
create policy "admins write the showcase bucket"
  on storage.objects for all to authenticated
  using (bucket_id = 'showcase' and public.is_admin())
  with check (bucket_id = 'showcase' and public.is_admin());

-- ── the consent ────────────────────────────────────────────────────────────
-- Same three-column shape as ai_review_consent (20260827g): the answer, when,
-- and WHICH WORDS earned it. The version is the load-bearing one. A consent is
-- only worth the sentence that was on screen when it was given, so changing
-- the wording without changing the version silently reinterprets everybody's
-- existing answer. Same rule as AI_CONSENT_VERSION in CLAUDE.md section 6.
alter table public.applications
  add column if not exists showcase_consent         text,
  add column if not exists showcase_consent_at      timestamptz,
  add column if not exists showcase_consent_version text;

alter table public.applications drop constraint if exists applications_showcase_consent_check;
alter table public.applications add constraint applications_showcase_consent_check
  check (showcase_consent is null or showcase_consent in ('granted','declined'));

alter table public.worker_profiles
  add column if not exists showcase_consent         text,
  add column if not exists showcase_consent_at      timestamptz,
  add column if not exists showcase_consent_version text;

alter table public.worker_profiles drop constraint if exists worker_profiles_showcase_consent_check;
alter table public.worker_profiles add constraint worker_profiles_showcase_consent_check
  check (showcase_consent is null or showcase_consent in ('granted','declined'));

comment on column public.worker_profiles.showcase_consent is
  'Whether this worker agreed that their photograph, introduction video and work photos may appear on their public profile. NULL counts as declined everywhere, same rule as ai_review_consent. Set it to declined and the public view empties immediately.';
comment on column public.worker_profiles.showcase_consent_version is
  'The wording that earned the consent. Change the sentence on the apply screen and change this in the same commit, or every existing answer quietly starts meaning something it never said.';

-- ── what is published ──────────────────────────────────────────────────────
create table if not exists public.worker_showcase (
  id              uuid primary key default gen_random_uuid(),
  worker_email    text not null,
  kind            text not null check (kind in ('profile_photo','intro_video','work_file')),
  storage_path    text not null,
  mime            text,
  bytes           bigint,
  caption         text,
  position        int not null default 0,
  -- Provenance. Which vetting row this copy came out of, so a question about
  -- a published file has an answer after the original has been purged.
  source_document uuid references public.vetting_documents(id),
  published_by    text not null,
  published_at    timestamptz not null default now()
);

comment on table public.worker_showcase is
  'Files copied out of the private vetting bucket onto a worker''s public profile, on a granted showcase consent, by a named human at the desk. The copy lives here; the vetting original keeps its own purge clock and dies on time.';
comment on column public.worker_showcase.published_by is
  'The person who decided this file should be public. Never "system", never "auto".';

create unique index if not exists worker_showcase_one_face_idx
  on public.worker_showcase (lower(worker_email), kind)
  where kind in ('profile_photo','intro_video');

create index if not exists worker_showcase_worker_idx
  on public.worker_showcase (lower(worker_email));

alter table public.worker_showcase enable row level security;

-- Admin only on the table itself, the same as vetting_documents. Everybody
-- else reads the view below, which carries no email.
drop policy if exists "worker showcase is admin only" on public.worker_showcase;
create policy "worker showcase is admin only"
  on public.worker_showcase for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

revoke select on public.worker_showcase from anon, public;

-- ── the public-safe view ───────────────────────────────────────────────────
-- Same pattern as public_worker_profiles and public_portfolio (20260903f):
-- joins to the slug so the page never needs a worker's email, and drops
-- everything the page has no business with. Consent is tested here rather
-- than at the call site so no future reader can forget it.
create or replace view public.public_worker_showcase as
select
  ws.kind,
  ws.storage_path,
  ws.mime,
  ws.caption,
  ws.position,
  wp.slug as subject_slug
from public.worker_showcase ws
join public.worker_profiles wp on lower(wp.worker_email) = lower(ws.worker_email)
where wp.active
  and wp.showcase_consent = 'granted';

revoke all on public.public_worker_showcase from public, anon, authenticated;
grant select on public.public_worker_showcase to anon, authenticated;

comment on view public.public_worker_showcase is
  'What a visitor may see of a worker''s own photograph, introduction video and work photos. Empty the moment showcase_consent stops saying granted, whether or not the files have been deleted yet.';

commit;
