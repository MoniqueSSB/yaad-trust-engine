-- A sketch pack knows where it is.
-- 6 September 2026
--
-- Founder instruction, on the day: type the address, and the document shows a
-- map of the property. Until now the pack deliberately carried no address at
-- all, the desk field was labelled "no address", and the model was told never
-- to state one. That was a good default and Monique overrode it for the
-- document she actually wants to hand a client, which is a site inspection
-- report with the place on the front.
--
-- Two columns, both plain text with an empty default so nothing existing
-- changes: the address as typed, and the map as a data URI, fetched once by
-- yaad-sketch from Google's Static Maps and stored here rather than in a
-- bucket, because a 640 by 400 image is a few hundred kilobytes, it is read
-- by one desk and one client, and a column is covered by the row policies
-- that already exist while a bucket would need its own.
--
-- The address goes to Google in the United States to make the map. That is a
-- new destination for a piece of personal data and docs/privacy.html names it.

alter table public.sketch_packs
  add column if not exists address   text not null default '',
  add column if not exists map_image text not null default '';

comment on column public.sketch_packs.address is
  'The property address as typed at the desk. Printed on the report. Founder decision 6 Sep 2026; the pack carried none before.';
comment on column public.sketch_packs.map_image is
  'A data URI of the map image for the address, from Google Static Maps, fetched once by yaad-sketch. Empty until a map is requested.';
