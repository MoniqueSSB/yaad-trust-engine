-- Caught live, setting up a real test: manually triggering
-- yaad-kickoff-check while pg_cron's own minute-tick was about to fire
-- produced two kickoff_packs rows for the same quote_id. Phase 2 reads
-- every 'ready', not-yet-linked draft once per invocation and links each
-- to a new pack; two invocations close enough together both read before
-- either writes, and both pass the "does this quote already have a pack"
-- check. Real risk in production too, not just from a manual trigger
-- racing the cron: the concierge desk can also invoke this check by hand.
--
-- One quote should only ever have one kickoff_packs row - revisions
-- update rev in place on that same row (agree_kickoff_pack() keys
-- confirmations on (pack_id, rev)), never insert a second row. A unique
-- constraint makes the race a clean, already-handled insert failure
-- (the code already logs and skips on insErr) instead of a silent
-- duplicate with two different confirm codes for the same quote.

alter table public.kickoff_packs
  add constraint kickoff_packs_quote_id_unique unique (quote_id);
