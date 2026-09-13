-- The report keeps its photographs.
-- 6 September 2026
--
-- The sketch pack stored captions and never the stills, so the document said
-- "the images accompany this pack" and no image ever did. Monique's reference
-- for what the report should look like is a photographic condition schedule:
-- numbered photographs down the page with the description beside each. That
-- needs the pictures in the record. From now each entry in frames carries the
-- still itself as a data URI (960px wide JPEG, roughly 150 KB each, at most
-- sixteen of them) and its own observations, alongside the caption.
--
-- Stored in the row rather than a bucket for the same reason the map is: the
-- row policies already exist and a bucket would need its own. If packs grow
-- past a few megabytes this is the first thing to move.
--
-- Also here: the conditions on the day (weather), printed on the cover the way
-- a surveyor's schedule prints it, and the approval scan widened to read each
-- photograph's own observations, since those are now client-facing text.

alter table public.sketch_packs
  add column if not exists conditions text not null default '';

comment on column public.sketch_packs.conditions is
  'Weather and conditions on the day of the visit, as typed at the desk. Printed on the cover.';

comment on column public.sketch_packs.frames is
  '[{n,room_key,room,caption,t_seconds,source,image,observations:[{note,category,severity,recommend_professional}]}]. image is a data URI of the still, since 6 Sep 2026; before that the bytes were never stored.';

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

comment on function public.sketch_offending_text(jsonb, jsonb, text, text) is
  'The first piece of text in a sketch pack that states a measurement, or null if the pack is clean. Reads the property label, every room name, every room observation, every photo caption, every photo observation, and the drawing itself.';
