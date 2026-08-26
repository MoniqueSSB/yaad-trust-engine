-- Applied to production 26 Aug 2026 via MCP as 20260826220410_portal_calendar.
-- PORTAL-SPEC.md section 5.1: the calendar band.
-- Key invariant: the partial unique index makes "a confirmed slot closes the
-- day for everybody else" a database fact rather than an application hope.
-- provider_email() lets a service client resolve the diary owner without
-- read access to admins.

create table if not exists public.worker_availability (
  owner_email text not null,
  day date not null,
  open boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (owner_email, day)
);

create table if not exists public.visits (
  id uuid primary key default gen_random_uuid(),
  owner_email text not null,
  kind text not null default 'job' check (kind in ('job','service')),
  job_id text not null,
  day date not null,
  slot text not null,
  what text,
  state text not null default 'pending'
    check (state in ('pending','confirmed','done','cancelled')),
  requested_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists visits_one_confirmed_per_owner_day
  on public.visits (owner_email, day) where state = 'confirmed';

create or replace function public.provider_email()
returns text language sql stable security definer set search_path = public
as $$ select email from public.admins limit 1 $$;
revoke all on function public.provider_email() from public;
grant execute on function public.provider_email() to authenticated;

alter table public.worker_availability enable row level security;
alter table public.visits enable row level security;

create policy "owner manages own availability" on public.worker_availability
  for all to authenticated
  using (lower(owner_email) = lower(auth.jwt()->>'email'))
  with check (lower(owner_email) = lower(auth.jwt()->>'email'));

create policy "admin full availability" on public.worker_availability
  for all to authenticated using (is_admin());

create policy "client reads their worker's open days" on public.worker_availability
  for select to authenticated
  using (exists (
    select 1 from public.jobs j
    where lower(j.client_email) = lower(auth.jwt()->>'email')
      and lower(j.worker_email) = lower(worker_availability.owner_email)
  ));

create policy "service client reads provider days" on public.worker_availability
  for select to authenticated
  using (
    lower(owner_email) = lower(public.provider_email())
    and exists (
      select 1 from public.services s
      where lower(s.client_email) = lower(auth.jwt()->>'email')
    )
  );

create policy "admin full visits" on public.visits
  for all to authenticated using (is_admin());

create policy "owner reads own diary visits" on public.visits
  for select to authenticated
  using (lower(owner_email) = lower(auth.jwt()->>'email'));

create policy "owner updates own diary visits" on public.visits
  for update to authenticated
  using (lower(owner_email) = lower(auth.jwt()->>'email'))
  with check (lower(owner_email) = lower(auth.jwt()->>'email'));

create policy "job parties read visits" on public.visits
  for select to authenticated
  using (
    kind = 'job' and exists (
      select 1 from public.jobs j
      where j.id = visits.job_id
        and (lower(j.client_email) = lower(auth.jwt()->>'email')
          or lower(j.worker_email) = lower(auth.jwt()->>'email'))
    )
  );

create policy "service client reads service visits" on public.visits
  for select to authenticated
  using (
    kind = 'service' and exists (
      select 1 from public.services s
      where s.id = visits.job_id
        and lower(s.client_email) = lower(auth.jwt()->>'email')
    )
  );

create policy "party requests a visit" on public.visits
  for insert to authenticated
  with check (
    lower(requested_by) = lower(auth.jwt()->>'email')
    and (state = 'pending' or lower(owner_email) = lower(auth.jwt()->>'email'))
    and (
      (kind = 'job' and exists (
        select 1 from public.jobs j
        where j.id = visits.job_id
          and (lower(j.client_email) = lower(auth.jwt()->>'email')
            or lower(j.worker_email) = lower(auth.jwt()->>'email'))
      ))
      or
      (kind = 'service' and exists (
        select 1 from public.services s
        where s.id = visits.job_id
          and lower(s.client_email) = lower(auth.jwt()->>'email')
      ))
    )
  );
