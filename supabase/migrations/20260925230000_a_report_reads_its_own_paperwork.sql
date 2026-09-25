-- A report keeps what it was drafted from, and the deposit check gets its
-- other sections.
--
-- 25 September 2026, the same evening as 20260925220000. Monique's words:
-- "I need the AI agent to be able to read a PDF and photo copies to then make
-- the deposit check document." Two columns follow from that.
--
-- ── source_text ──
--
-- yaad-report-read transcribes the quote and captions the photographs, and the
-- desk drops that into the notes box for her to read and correct before the
-- draft is made. What the reader produced is kept here, verbatim, on the
-- report it fed. A report whose findings say "the quote names no insurer"
-- should be able to show the quote it read, and until this column that
-- transcript lived in a textarea.
--
-- Deliberately NOT screened. It is the record of what the document said,
-- figures, dimensions and all. The screens run on what the agent writes, not
-- on what the contractor wrote, and a scrubbed transcript would be a false
-- record of the source. Nothing here is ever shown to a client automatically.
--
-- ── sections ──
--
-- The service is sold as the red flags, the payment schedule to ask for
-- instead, and the questions to send the builder. The findings table holds
-- the first. The other parts of the document (scope in and out, the payment
-- stages with the shares left blank, the message to the builder, and the
-- checklist states) had nowhere to live, so on 25 September they were typed
-- into a JSON file by hand. Now the drafter returns them and they are kept
-- here, one jsonb, screened like a finding before they are saved: measurements
-- and figures scrubbed, ratings removed, banned language refused.
--
-- The checklist ITEMS are fixed in yaad-report, not chosen by the model. The
-- model supplies a state and a note against each; the wording of the line is
-- the house standard and cannot drift per report.

alter table public.reports
  add column if not exists source_text text,
  add column if not exists sections    jsonb not null default '{}'::jsonb;

comment on column public.reports.source_text is
  'What yaad-report-read transcribed from the quote and captioned from the photographs, as it went into the notes. Unscreened on purpose: it is the record of the source, not the agent''s words. Never shown to a client automatically.';

comment on column public.reports.sections is
  'The deposit check''s other drafted parts: scope_included, scope_not_stated, payment_stages (shares never present), ask_the_builder, checklist states against the fixed house list. Screened like a finding before saving. Empty object on the other three services.';
