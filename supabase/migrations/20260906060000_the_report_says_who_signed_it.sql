-- The report says who signed it.
-- 6 September 2026
--
-- Second reference from Monique, a site visit report: a detail block down the
-- left with labels and values, a section for what the visitor saw in their own
-- words, and a signature line at the end. Three columns for the first two, and
-- the signature is the one that matters.
--
-- THE SIGNATURE IS NOT A DRAWING. The reference prints a scribble. This prints
-- the named human who approved the pack and when, out of approved_by and
-- approved_at, which are already written by sketch_guard_approval and cannot
-- be set by hand. A drawn signature would be decoration over the top of a real
-- record; the record itself is the stronger thing, and it is the governing
-- rule made visible: a named human confirmed this, here is who and when.
--
-- visit_notes is the inspector's own words, typed at the desk, not drafted by
-- a model. It is client-facing text, so the measurement scan reads it too:
-- a person typing "the crack is about 2 metres" is the same problem as a model
-- writing it, and the approval refuses both.

alter table public.sketch_packs
  add column if not exists job_ref     text not null default '',
  add column if not exists contractor  text not null default '',
  add column if not exists visit_notes text not null default '';

comment on column public.sketch_packs.job_ref is
  'The client''s or the job''s own reference, printed in the detail block. Free text.';
comment on column public.sketch_packs.contractor is
  'Who is doing the work, if anyone is yet. Printed in the detail block.';
comment on column public.sketch_packs.visit_notes is
  'What the inspector saw, in their own words, typed at the desk. One line per point, printed as a list. Never drafted by a model, and read by the measurement scan because the client sees it.';

create or replace function public.sketch_offending_text(
  p_rooms jsonb, p_frames jsonb, p_svg text, p_label text
)
returns text language sql stable set search_path = public as $$
  select t from (
    select coalesce(p_label, '') as t
    union all
    select jsonb_array_elements(coalesce(p_rooms, '[]'::jsonb)) ->> 'name'
    union all
    select jsonb_array_elements(jsonb_path_query_array(coalesce(p_rooms, '[]'::jsonb), '$[*].observations[*]')) ->> 'note'
    union all
    select jsonb_array_elements(coalesce(p_frames, '[]'::jsonb)) ->> 'caption'
    union all
    select jsonb_array_elements(jsonb_path_query_array(coalesce(p_frames, '[]'::jsonb), '$[*].observations[*]')) ->> 'note'
    union all
    select coalesce(p_svg, '')
  ) s
  where t is not null and t <> '' and public.has_measurement(t)
  limit 1;
$$;

-- The trigger hands it the visit notes as well, by passing them in the label
-- slot's company: a second call rather than a fifth argument, so the existing
-- signatures stay put.
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

    v_offender := public.sketch_offending_text(new.rooms, new.frames, new.sketch_svg, new.property_label);
    if v_offender is null and public.has_measurement(coalesce(new.visit_notes, '')) then
      v_offender := new.visit_notes;
    end if;
    if v_offender is null and public.has_measurement(coalesce(new.address, '')) then
      v_offender := new.address;
    end if;
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
    new.approved_by := null;
    new.approved_at := null;
    new.rev := old.rev + 1;

  else
    raise exception 'pack % cannot go from % to %', new.id, old.status, new.status;
  end if;

  new.updated_at := now();
  return new;
end $$;

revoke execute on function public.sketch_guard_approval() from anon, authenticated;
