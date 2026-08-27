-- The join flow was a walkthrough. Nine screens that explained the check and
-- captured none of it: step 2 had no way to attach a CV, step 3 no way to send
-- an ID, step 5's reference boxes were unbound, and nothing ever submitted.
-- The backend for all of it already existed. This is the schema those screens
-- need in order to write down what a tradesperson actually types.
--
-- Applied 27 Aug 2026.

-- 1. A CV, a portfolio and a certificate are documents too. doc_type only
--    allowed identity papers, so step 2 had nowhere to put a file at all.
--    The face turn is a video, and 'selfie_with_id' was carrying two ideas.
alter table public.vetting_documents drop constraint if exists vetting_documents_doc_type_check;
alter table public.vetting_documents
  add constraint vetting_documents_doc_type_check
  check (doc_type in (
    'photo_id','selfie_with_id','face_video','police_check','proof_of_address','trn',
    'cv','portfolio','certificate'
  ));

comment on column public.vetting_documents.doc_type is
  'Identity papers, plus the work evidence from step 2. All of it lands in the same private bucket, on the same purge clock.';

-- 2. What steps 1, 2, 5 and 7 collect and previously threw on the floor.
--    parishes and trades stay comma separated text rather than arrays, because
--    the desk reads these columns as prose and there is no query that filters
--    on them yet. When matching needs them indexed they become arrays.
alter table public.applications
  add column if not exists parishes       text,
  add column if not exists trade_other    text,
  add column if not exists links          text,
  add column if not exists ref3           text,
  add column if not exists refs_told      boolean not null default false,
  add column if not exists police_status  text,
  add column if not exists signed_name    text,
  add column if not exists signed_at      timestamptz,
  add column if not exists signed_version text,
  add column if not exists submitted_at   timestamptz;

comment on column public.applications.parishes is
  'Every parish ticked, comma separated. A job posted in a parish not listed here never reaches them.';
comment on column public.applications.refs_told is
  'The applicant confirmed all three referees were told Yaadly would call. A name nobody warned is not a reference, and this records that they were asked.';
comment on column public.applications.signed_at is
  'When the Worker Guidelines were signed, with the typed name in signed_name. Set once, at submit, never edited.';
comment on column public.applications.police_status is
  'uploaded, or not_yet. not_yet still publishes a profile but locks them out of every job over the threshold and every occupied-home job.';

-- 3. The bucket took images and PDFs only. Step 3 asks for a video of the face
--    turning left to right, which is the whole point of step 3, and a CV is
--    very often a Word file.
update storage.buckets
   set file_size_limit = 52428800,
       allowed_mime_types = array[
         'image/jpeg','image/png','image/heic','image/webp','application/pdf',
         'video/mp4','video/webm','video/quicktime',
         'application/msword',
         'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
       ]
 where id = 'vetting';
