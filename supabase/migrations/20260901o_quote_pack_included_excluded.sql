-- Quote Kickoff Pack, follow-on: founder's own correction after seeing the
-- first live draft, 1 Sep 2026: "high level of what is included and
-- excluded needs to be added to this, so each is stating exactly what they
-- are doing and not doing." yaad-quote-pack's SYSTEM prompt gained
-- "included" and "excluded" (short bullet lists, high level, see 20260901l
-- comment) alongside scope_summary; this is the storage side, same
-- treatment as payment_stage_note (20260901l): flattened to plain text at
-- the door, one bullet per line, because the founder's own description of
-- every one of these fields is "editable text", not a structured form.
alter table public.job_quotes
  add column if not exists included_note text,
  add column if not exists excluded_note text;
