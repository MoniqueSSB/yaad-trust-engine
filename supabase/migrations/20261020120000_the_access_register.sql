-- The access register: who holds which access level.
--
-- Founder, 20 October 2026: "create access level", Super Admin, Project
-- Manager, Member, Client, Worker, plus Checker, Material Supplier and Viewer.
-- Decided the same day and logged in the ideas ledger:
--   1. A Project Manager can release money, up to GBP 500 per payment.
--      Anything above comes to the Super Admin.
--   2. Only the Super Admin sees identity documents. Nobody else, PM included.
--   3. A Checker sees the client's name and number, only on visits assigned
--      to them and only while the visit is open.
--
-- THIS FILE CHANGES NOBODY'S PERMISSIONS. It is the register, like the
-- permit-to-work board on site: it records who holds what, and later files
-- give each level its buttons one at a time. Until they land, a Project
-- Manager on this register can do exactly what any signed-in stranger can,
-- which is nothing on the desk.
--
-- WHERE EACH LEVEL COMES FROM. Only four levels are stored here, because
-- only four have no other home:
--   project_manager, member, checker, viewer   a row in staff_access
--   super_admin        the admins table, unchanged. is_admin() still means
--                      Super Admin and still gates every money, ID and
--                      access function. Nothing here can make anybody a
--                      Super Admin; that stays a row added by hand.
--   client             their email is client_email on a job
--   worker             they have a worker profile, or are worker_email on a job
--   material_supplier  their email or sign-in is on a suppliers row
-- Storing client, worker and supplier again would give the database two
-- answers to the same question, and the day they disagree is the day
-- somebody sees the wrong thing.
--
-- THE CHECKER IS INDEPENDENT OF THE TRADESPERSON. grant_access() refuses the
-- checker level to anybody who is a worker. A checker who also does the work
-- is checking themselves.
--
-- WHO MAY GRANT. The Super Admin only, through grant_access() and
-- revoke_access(). There is no insert or update policy on the table, so the
-- functions are the only door. Every grant and revoke keeps the name of who
-- did it. That is an internal record, never shown to clients or workers.

begin;

create table if not exists public.staff_access (
  id          uuid primary key default gen_random_uuid(),
  email       text not null check (email = btrim(lower(email)) and email like '%@%'),
  level       text not null check (level in ('project_manager', 'member', 'checker', 'viewer')),
  note        text not null default '',
  granted_by  text not null,
  granted_at  timestamptz not null default now(),
  revoked_by  text,
  revoked_at  timestamptz
);

comment on table public.staff_access is
  'The access register for the four staff levels: project_manager, member, checker, viewer. One active row per person. Super Admin is the admins table; client, worker and material_supplier are worked out from jobs, worker_profiles and suppliers. Written only by grant_access() and revoke_access(). 20261020120000.';

-- One active level per person. A change of level revokes the old row and
-- adds a new one, so the history stays readable.
create unique index if not exists staff_access_one_active
  on public.staff_access (email) where revoked_at is null;

alter table public.staff_access enable row level security;
revoke all on public.staff_access from anon;

drop policy if exists staff_access_admin_read on public.staff_access;
create policy staff_access_admin_read on public.staff_access
  for select to authenticated
  using (public.is_admin());

drop policy if exists staff_access_own_read on public.staff_access;
create policy staff_access_own_read on public.staff_access
  for select to authenticated
  using (email = nullif(btrim(lower(coalesce(auth.jwt() ->> 'email', ''))), ''));

-- The PM release limit, recorded now and enforced by the file that gives
-- the PM the release button. Pence, GBP.
insert into public.app_settings (key, value)
values ('pm_release_limit_pence', '50000')
on conflict (key) do nothing;

-- Every level one email holds. Internal: callers use my_access_levels().
create or replace function public.access_levels_for(p_email text)
returns text[]
language sql
stable
security definer
set search_path to 'public'
as $$
  with e as (select nullif(btrim(lower(coalesce(p_email, ''))), '') as email)
  select coalesce(array_agg(level order by ord), '{}')
  from (
    select 'super_admin' as level, 1 as ord from e
     where exists (select 1 from admins a where lower(a.email) = e.email)
    union all
    select s.level, 2 from e join staff_access s on s.email = e.email and s.revoked_at is null
    union all
    select 'client', 3 from e
     where exists (select 1 from jobs j where lower(j.client_email) = e.email)
    union all
    select 'worker', 4 from e
     where exists (select 1 from worker_profiles w where lower(w.worker_email) = e.email)
        or exists (select 1 from jobs j where lower(j.worker_email) = e.email)
    union all
    select 'material_supplier', 5 from e
     where exists (select 1 from suppliers s where lower(s.contact_email) = e.email and s.is_active)
  ) l;
$$;
revoke all on function public.access_levels_for(text) from public, anon, authenticated;
grant execute on function public.access_levels_for(text) to service_role;

-- The signed-in person's own levels. Answers for nobody else.
create or replace function public.my_access_levels()
returns text[]
language sql
stable
security definer
set search_path to 'public'
as $$
  select public.access_levels_for(auth.jwt() ->> 'email');
$$;
revoke all on function public.my_access_levels() from public, anon;
grant execute on function public.my_access_levels() to authenticated, service_role;

-- Does the signed-in person hold this level. Used by later files to gate
-- each button. Strict: a Super Admin is not automatically a checker; a
-- later gate that wants both says so.
create or replace function public.has_access(p_level text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select p_level = any(public.my_access_levels());
$$;
revoke all on function public.has_access(text) from public, anon;
grant execute on function public.has_access(text) to authenticated, service_role;

create or replace function public.grant_access(p_email text, p_level text, p_note text default '')
returns public.staff_access
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_by    text := nullif(btrim(lower(coalesce(auth.jwt() ->> 'email', ''))), '');
  v_email text := nullif(btrim(lower(coalesce(p_email, ''))), '');
  v_row   public.staff_access;
begin
  if not public.is_admin() then
    raise exception 'Super Admin only: access is granted by the Super Admin.';
  end if;
  if v_email is null or v_email not like '%@%' then
    raise exception 'That is not an email address.';
  end if;
  if p_level not in ('project_manager', 'member', 'checker', 'viewer') then
    raise exception 'Unknown access level %. Use project_manager, member, checker or viewer.', p_level;
  end if;
  if exists (select 1 from admins a where lower(a.email) = v_email) then
    raise exception '% is already a Super Admin.', v_email;
  end if;
  if p_level = 'checker' and (
       exists (select 1 from worker_profiles w where lower(w.worker_email) = v_email)
    or exists (select 1 from jobs j where lower(j.worker_email) = v_email)) then
    raise exception '% is a worker. A checker must be independent of the tradesperson.', v_email;
  end if;

  update public.staff_access
     set revoked_at = now(), revoked_by = v_by
   where email = v_email and revoked_at is null;

  insert into public.staff_access (email, level, note, granted_by)
  values (v_email, p_level, coalesce(p_note, ''), v_by)
  returning * into v_row;
  return v_row;
end;
$$;
revoke all on function public.grant_access(text, text, text) from public, anon;
grant execute on function public.grant_access(text, text, text) to authenticated, service_role;

create or replace function public.revoke_access(p_email text)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_by text := nullif(btrim(lower(coalesce(auth.jwt() ->> 'email', ''))), '');
  v_n  integer;
begin
  if not public.is_admin() then
    raise exception 'Super Admin only: access is revoked by the Super Admin.';
  end if;
  update public.staff_access
     set revoked_at = now(), revoked_by = v_by
   where email = nullif(btrim(lower(coalesce(p_email, ''))), '') and revoked_at is null;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.revoke_access(text) from public, anon;
grant execute on function public.revoke_access(text) to authenticated, service_role;

commit;
