-- Photos sent together are one update.
--
-- Founder, 17 Sep 2026, reading a test job's evidence page: an update is meant
-- to carry everything the worker sent together. A WhatsApp batch of three
-- photographs with one caption, confirmed with one job code and one answer to
-- the section question, was stored as three unrelated rows and drawn as three
-- unrelated cards.
--
-- evidence.batch_id is the one fact that ties them: set once per confirmed
-- batch by yaad-inbound, the same value on every row it files. Null means the
-- item was filed on its own, which is every portal upload (one file per
-- submit) and everything filed before this column existed. Nothing is
-- backfilled: rows that were never recorded as filed together are not
-- inferred to have been from their labels or their times.
--
-- Display only. No gate reads it, no RLS policy changes, and approve_stage()
-- does not look at it. The table's existing grants and policies cover a new
-- nullable column.

alter table public.evidence add column if not exists batch_id uuid;

comment on column public.evidence.batch_id is
  'Items filed together in one confirmed WhatsApp batch share this. Null = filed on its own. Display grouping only, never a gate. 20260917190100.';

create index if not exists evidence_batch_id_idx on public.evidence (batch_id) where batch_id is not null;
