-- Site Sketch Pack
-- 26 Aug 2026
--
-- A walkthrough video and a set of photos become an indicative record of a
-- property: key frames, a room by room condition schedule, and a schematic
-- sketch showing rooms, doors and where each photo was taken.
--
-- What this is NOT, and the reason the guard exists: it is not a measured
-- survey. A phone video carries no scale, so any dimension derived from it
-- would be invented. Producing measured drawings for reward is also regulated
-- work in Jamaica. So the rule is absolute and it is enforced here rather than
-- asked for in a prompt: no pack containing a measurement may be approved.
--
-- Tests: supabase/tests/sketch_guards.sql

create table if not exists public.sketch_packs (
  id                text primary key,
  job_id            text references public.jobs(id) on delete set null,
  property_label    text not null,
  client_name       text not null default '',
  parish            text not null default '',
  visit_date        date,
  captured_by       text not null default '',
  rooms             jsonb not null default '[]'::jsonb,
  frames            jsonb not null default '[]'::jsonb,
  sketch_svg        text not null default '',
  status            text not null default 'draft'
                      check (status in ('draft','approved','issued','void')),
  approved_by       text,
  approved_at       timestamptz,
  issued_at         timestamptz,
  model             text not null default '',
  model_note        text not null default '',
  rev               integer not null default 1,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.sketch_packs is
  'Indicative site records. Never a survey. sketch_guard_approval refuses to approve a pack containing a measurement.';
comment on column public.sketch_packs.rooms is
  '[{key,name,level,walk_order,connects:[key],observations:[{note,category,severity,recommend_professional}]}]';
comment on column public.sketch_packs.frames is
  '[{n,room_key,caption,t_seconds,source}] . The image bytes live in storage or the client, never in this row.';

create index if not exists sketch_packs_job_idx    on public.sketch_packs (job_id);
create index if not exists sketch_packs_status_idx on public.sketch_packs (status);

create sequence if not exists public.sketch_seq start 1;

create or replace function public.new_sketch_number()
returns text language sql volatile set search_path = public as $$
  select 'SKP-' || to_char(now() at time zone 'Europe/London', 'YYYY')
      || '-' || lpad(nextval('public.sketch_seq')::text, 4, '0');
$$;

-- A number on its own is fine: "two hairline cracks", "3 sockets". A number
-- with a unit of length or area is a measurement, and this pack may not carry
-- one.
--
-- Deliberately NOT in the list: bare "in", because "1 in 5 tiles" is ordinary
-- English. "inch" and "inches" are caught instead.
--
-- If this changes, change MEASUREMENT_RE in supabase/functions/yaad-sketch to
-- match. The function scrubs, this refuses. Two layers, same rule.
create or replace function public.has_measurement(p text)
returns boolean language sql immutable set search_path = public as $$
  select p ~* '(^|[^a-z0-9])[0-9]+([.,][0-9]+)?\s*(mm|cm|m|m2|m²|metre|meter|metres|meters|ft|foot|feet|yard|yards|inch|inches|sq\.?\s*(m|ft|metre|metres|foot|feet)|square\s+(metre|metres|meter|meters|foot|feet))([^a-z0-9]|$)'
      or p ~ '[0-9]\s*(''|")(\s|$|[.,;)])';
$$;

comment on function public.has_measurement is
  'True if the text contains a number carrying a unit of length or area. Used to keep measurements out of an indicative sketch pack.';

-- Pulled out of the trigger so it can be tested on its own, without an admin
-- session standing in the way.
create or replace function public.sketch_offending_text(p_rooms jsonb, p_frames jsonb, p_svg text)
returns text language sql stable set search_path = public as $$
  select t from (
    select jsonb_array_elements(coalesce(p_rooms, '[]'::jsonb)) ->> 'name' as t
    union all
    select jsonb_array_elements(jsonb_path_query_array(coalesce(p_rooms, '[]'::jsonb), '$[*].observations[*]')) ->> 'note'
    union all
    select jsonb_array_elements(coalesce(p_frames, '[]'::jsonb)) ->> 'caption'
    union all
    select coalesce(p_svg, '')
  ) s
  where t is not null and t <> '' and public.has_measurement(t)
  limit 1;
$$;

comment on function public.sketch_offending_text is
  'The first piece of text in a sketch pack that states a measurement, or null if the pack is clean.';

create or replace function public.sketch_guard_approval()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_offender text;
  v_rooms    integer;
begin
  if new.status = old.status then
    new.updated_at := now();
    return new;
  end if;

  if new.status = 'approved' then
    if not public.is_admin() then
      raise exception 'only a signed-in Yaadly admin may approve a sketch pack';
    end if;

    select count(*) into v_rooms from jsonb_array_elements(new.rooms);
    if v_rooms = 0 then
      raise exception 'pack % has no rooms and cannot be approved', new.id;
    end if;

    v_offender := public.sketch_offending_text(new.rooms, new.frames, new.sketch_svg);
    if v_offender is not null then
      raise exception 'This pack states a measurement, and an indicative sketch may not: "%". A phone video carries no scale, so that number was invented. Remove it, or commission a surveyor.', left(v_offender, 120);
    end if;

    new.approved_by := coalesce(new.approved_by, auth.jwt() ->> 'email');
    new.approved_at := now();

  elsif new.status = 'issued' then
    if old.status <> 'approved' then
      raise exception 'pack % must be approved before it is issued', new.id;
    end if;
    new.issued_at := now();

  elsif new.status = 'void' then
    if not public.is_admin() then
      raise exception 'only a signed-in Yaadly admin may void a sketch pack';
    end if;

  elsif new.status = 'draft' and old.status = 'approved' then
    -- Reopening for edits clears the approval. An approval belongs to the
    -- version it was given to, not to the row.
    new.approved_by := null;
    new.approved_at := null;
    new.rev := old.rev + 1;

  else
    raise exception 'pack % cannot go from % to %', new.id, old.status, new.status;
  end if;

  new.updated_at := now();
  return new;
end $$;

drop trigger if exists sketch_packs_guard on public.sketch_packs;
create trigger sketch_packs_guard
  before update on public.sketch_packs
  for each row execute function public.sketch_guard_approval();

-- Content of an approved pack is frozen. Edit it and the approval goes with it.
create or replace function public.sketch_freeze_approved()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.status in ('approved','issued')
     and new.status = old.status
     and (new.rooms is distinct from old.rooms
       or new.frames is distinct from old.frames
       or new.sketch_svg is distinct from old.sketch_svg) then
    raise exception 'pack % is % and its content is frozen. Set it back to draft first, which clears the approval.', old.id, old.status;
  end if;
  return new;
end $$;

drop trigger if exists sketch_packs_freeze on public.sketch_packs;
create trigger sketch_packs_freeze
  before update on public.sketch_packs
  for each row execute function public.sketch_freeze_approved();

alter table public.sketch_packs enable row level security;

drop policy if exists sketch_admin       on public.sketch_packs;
drop policy if exists sketch_client_read on public.sketch_packs;
create policy sketch_admin on public.sketch_packs for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
-- A client sees a pack for their own job, and only once it has been issued.
create policy sketch_client_read on public.sketch_packs for select to authenticated
  using (status = 'issued' and exists (
    select 1 from public.jobs j
     where j.id = sketch_packs.job_id
       and lower(j.client_email) = lower(auth.jwt() ->> 'email')
  ));

revoke execute on function public.sketch_guard_approval() from anon, authenticated;
revoke execute on function public.sketch_freeze_approved() from anon, authenticated;

insert into public.app_settings (key, value) values
  ('sketch_stamp', 'Indicative sketch. Not a survey, not a measured drawing, not a valuation. Rooms and connections are schematic and not to scale. No dimension in this document has been measured.')
on conflict (key) do nothing;
