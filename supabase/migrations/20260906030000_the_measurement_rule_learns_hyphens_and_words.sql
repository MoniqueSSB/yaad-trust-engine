-- The measurement rule learns hyphens, number words, and the units it never had.
-- 5 September 2026
--
-- The rule itself does not change: a sketch pack and a drafted report may
-- describe size in words, and may never state a dimension. What changes is how
-- much of that sentence the pattern actually recognised.
--
-- It was tested by hand for the first time since it was written, against
-- twenty-nine sentences of the kind a real condition note contains. Twelve of
-- them went through untouched. Every layer agreed with every other layer,
-- which is the good news and also the reason nobody noticed: three copies of
-- one rule, all consistent, all narrower than the sentence everybody believed
-- they enforced.
--
-- What got through, in the order it matters:
--
--   a hyphen   "a 2-metre crack", "9-foot ceiling", "a 10-ft run of skirting".
--              This is the one. It is one character away from wording that was
--              always caught, and it is how a fluent model writes the sentence.
--
--   a word     "twelve feet by ten feet", "half a metre", "one metre".
--
--   a unit     acres, yards written yds, square yards, ft2, km.
--
-- The pattern now comes from one place, supabase/functions/_shared/
-- measurements.ts, and sits inside a dollar quoted literal so it is character
-- for character the string in that file. measurements_test.ts reads this migration
-- on every push and fails if the two differ. Three hand-kept copies of one
-- rule became two copies with a test standing between them.
--
-- Also here: sketch_offending_text() now reads property_label. It is the title
-- printed at the top of the client's document, and it was the one client-facing
-- field the scan never looked at.
--
-- Nothing is loosened. Every pack refused before is refused now.
--
-- Tests: supabase/functions/_shared/measurements_test.ts (pattern, and drift
--        between the two copies)
--        supabase/tests/sketch_guards.sql (the approval itself)

create or replace function public.has_measurement(p text)
returns boolean language sql immutable set search_path = public as $fn$
  select p ~* $re$(^|[^a-z0-9])[0-9]+([.,][0-9]+)?\s*[-]?\s*(mm|cm|m|m2|m²|km|metre|metres|meter|meters|ft|ft2|foot|feet|yd|yds|yard|yards|inch|inches|acre|acres|sq\.?\s*(m|ft|yd|metre|metres|meter|meters|foot|feet|yard|yards)|square\s+(metre|metres|meter|meters|foot|feet|yard|yards))([^a-z0-9]|$)|(^|[^a-z0-9])(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|half|quarter)(\s+and)?(\s+a)?(\s+(half|quarter))?[\s-]+(metre|metres|foot|feet|inch|inches|yard|yards)([^a-z0-9]|$)$re$
      or p ~* $re$[0-9]+\s*(['"])(\s*[0-9]+([.,][0-9]+)?\s*")?(\s|$|[.,;)])$re$;
$fn$;

comment on function public.has_measurement is
  'True if the text states a dimension: a number, in digits or in words, carrying a unit of length or area, or a feet and inches mark. Deliberately does not treat a bare "in" as a unit ("1 in 5 tiles is cracked"), nor the word meter after a number word ("two meters on the outside wall" is the electricity meter). Same pattern as _shared/measurements.ts, held identical by measurements_test.ts.';

-- The pack scan, now including the document's own title. The three argument
-- form stays, because the original tests call it and the shape of a pack is
-- not what changed here.
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
    select coalesce(p_svg, '')
  ) s
  where t is not null and t <> '' and public.has_measurement(t)
  limit 1;
$$;

comment on function public.sketch_offending_text(jsonb, jsonb, text, text) is
  'The first piece of text in a sketch pack that states a measurement, or null if the pack is clean. Reads the property label, every room name, every observation, every photo caption, and the drawing itself.';

create or replace function public.sketch_offending_text(p_rooms jsonb, p_frames jsonb, p_svg text)
returns text language sql stable set search_path = public as $$
  select public.sketch_offending_text(p_rooms, p_frames, p_svg, '');
$$;

comment on function public.sketch_offending_text(jsonb, jsonb, text) is
  'The pack scan without a property label. Kept so the original tests and any existing caller still work. The four argument form is the one the approval trigger uses.';

-- The trigger, unchanged except that it now hands the label to the scan.
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

revoke execute on function public.sketch_guard_approval() from anon, authenticated;
