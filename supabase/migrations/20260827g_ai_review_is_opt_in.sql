-- Reading a tradesperson's passport with an AI model becomes something they
-- agree to, or do not.
--
-- Step 3 of the join page told applicants their documents went "straight into
-- a private store that only Yaadly admins can read", at the exact moment it
-- asked for a passport. Building yaad-vetting-review made that false: the
-- images go to NVIDIA's hosted model. The sentence has been rewritten, and the
-- choice it describes is now real rather than decorative.
--
-- Applied 27 Aug 2026.
--
-- Opt in, not opt out. Neither option is pre-selected on the page, and NULL is
-- read as declined everywhere, so an application that predates the question, or
-- one where the field never arrived, is never machine read. Silence is not
-- consent.
--
-- Enforced in two places, deliberately:
--   yaad-vetting-upload   does not trigger the reviewer on submit unless the
--                         answer was "granted"
--   yaad-vetting-review   refuses outright for anything but "granted", because
--                         the desk carries a "Run the check again" button and a
--                         button must not be able to override a promise made to
--                         somebody handing over their ID
--
-- Declining is not a penalty and the page says so. It costs the applicant time,
-- not standing: a person reads every page and answers within 48 hours.

alter table public.applications
  add column if not exists ai_review_consent         text,
  add column if not exists ai_review_consent_at      timestamptz,
  add column if not exists ai_review_consent_version text;

alter table public.applications drop constraint if exists applications_ai_review_consent_check;
alter table public.applications
  add constraint applications_ai_review_consent_check
  check (ai_review_consent is null or ai_review_consent in ('granted','declined'));

comment on column public.applications.ai_review_consent is
  'granted or declined. NULL means never answered, which is treated exactly like declined: consent is opt in, and silence is not consent.';
comment on column public.applications.ai_review_consent_at is
  'When they chose. Set once, at submit, from the server clock.';
comment on column public.applications.ai_review_consent_version is
  'Which wording they were shown. If the sentence changes, old consents stay tied to the sentence that earned them, and are not read as agreement to a newer, broader one.';

-- Who has been machine read, and who asked not to be:
--   select ai_review_consent, count(*) from public.applications group by 1;
