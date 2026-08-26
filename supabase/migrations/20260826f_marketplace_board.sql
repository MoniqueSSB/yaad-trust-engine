-- Applied to production 26 Aug 2026 via MCP (marketplace_board).
-- MARKETPLACE-BUILD-SPEC section 9. Structured-row columns on jobs plus
-- budget_band, which is created and then deliberately NEVER exposed:
-- open_jobs is the leak surface and the band is the one column a worker
-- must never see. job_photos with public read scoped to jobs currently on
-- the open board. client_summary for the trust row; client_score stays
-- null until reviews land, and the UI shows first-timer copy, never 0.0.

alter table public.jobs
  add column if not exists job_type text,
  add column if not exists size_band text,
  add column if not exists access_type text,
  add column if not exists materials_by text,
  add column if not exists urgency text,
  add column if not exists budget_band text;

create table if not exists public.job_photos (
  id uuid primary key default gen_random_uuid(),
  job_id text not null,
  caption text not null,
  img text,
  position int not null default 0,
  created_at timestamptz not null default now()
);
alter table public.job_photos enable row level security;

create policy "photos of open jobs are public" on public.job_photos
  for select to anon, authenticated
  using (exists (select 1 from public.open_jobs oj where oj.id = job_photos.job_id));

create policy "admin full job_photos" on public.job_photos
  for all to authenticated using (is_admin());

create policy "client adds photos to own job" on public.job_photos
  for insert to authenticated
  with check (exists (
    select 1 from public.jobs j
    where j.id = job_photos.job_id
      and lower(j.client_email) = lower(auth.jwt()->>'email')
  ));

create or replace view public.open_jobs as
 SELECT j.id, j.title, j.parish,
    regexp_replace(regexp_replace(regexp_replace(j.descr, '(^|\n)\s*(Address|Access contact)\s*:[^\n]*'::text, '\1'::text, 'gi'::text), '\+?[0-9][0-9\s().-]{7,}[0-9]'::text, '[contact removed]'::text, 'g'::text), '\n{3,}'::text, '\n\n'::text, 'g'::text) AS descr,
    j.updated_at,
    cp.user_id IS NOT NULL AS client_signed,
    COALESCE(cp.jobs_completed, 0) AS client_jobs_completed,
    j.trade, j.job_type, j.size_band, j.access_type, j.materials_by, j.urgency
   FROM jobs j
     LEFT JOIN client_profiles cp ON lower(cp.email) = lower(COALESCE(j.client_email, ''::text))
  WHERE j.open = true AND COALESCE(j.worker_email, ''::text) = ''::text AND j.stage = 0;

create or replace view public.client_summary as
 select id as job_id, client_signed, client_jobs_completed,
        null::numeric as client_score
 from public.open_jobs;
