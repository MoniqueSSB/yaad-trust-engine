-- A photograph of the tradesperson, and the introduction video that has never
-- been able to save.
--
-- Two doc_type values go into the check constraint on public.vetting_documents.
--
-- 1. profile_photo. Founder instruction, 3 Sep 2026: /apply should let a
--    tradesperson upload a picture of themselves, so the person reading the
--    application can put a face to the name instead of a form.
--
-- 2. intro_video. This one is a BUG FIX, not a feature. The thirty second
--    introduction was added to the join flow on 31 Aug 2026 and wired all the
--    way through: the browser records it, yaad-vetting-upload lists it in
--    DOC_TYPES, the file uploads into the bucket, and yaad-vetting-review has
--    withheld it from the model since the day it was written. The one place it
--    was never added is here. So every introduction video ever recorded has
--    uploaded successfully and then failed on this constraint at the insert,
--    and the row said "Could not record that document" while the file sat
--    orphaned in the bucket until the ninety day purge collected it.
--
--    Nobody reported it because the row is optional and the failure looks like
--    a bad connection. Found on 3 Sep 2026 by reading the live constraint
--    rather than the migration history.
--
-- Additive only. No column changes, no data is touched, and every value that
-- was allowed before is still allowed, including police_check, which no longer
-- has a step in the flow but may have rows behind it. To undo, drop and re-add
-- the constraint without the two new values.
--
-- BOTH new values are faces, and both are on IDENTITY_DOCS in
-- yaad-vetting-review, which is checked before the download so neither file is
-- fetched out of the bucket on that path at all. Widening this constraint does
-- not widen what a model sees. Do not add a face here without adding it there
-- in the same change.

alter table public.vetting_documents
  drop constraint if exists vetting_documents_doc_type_check;

alter table public.vetting_documents
  add constraint vetting_documents_doc_type_check
  check (doc_type in (
    'photo_id','selfie_with_id','face_video','police_check','proof_of_address','trn',
    'cv','portfolio','certificate',
    'intro_video','profile_photo'
  ));

comment on column public.vetting_documents.doc_type is
  'Identity papers, the work evidence, and the two pieces of the person themselves (intro_video, profile_photo). All of it lands in the same private bucket, on the same ninety day purge clock. The face rows are withheld from any model by IDENTITY_DOCS in yaad-vetting-review.';
