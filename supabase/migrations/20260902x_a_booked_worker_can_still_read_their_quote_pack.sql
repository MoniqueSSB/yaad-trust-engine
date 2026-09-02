-- Founder's decision, 2 Sep 2026, on a gap found while building the portal's
-- per-stage ledger: "yes they need to still read the quote pack".
--
-- quote_pack_drafts had two reader policies. The client's covers their own
-- job at any point in its life. The worker's does not:
--
--   status = 'approved'
--   AND j.open = true AND j.worker_email = '' AND j.stage = 0
--
-- Those three job conditions are the open_jobs test, written for a worker
-- BROWSING the board deciding whether to quote. The moment one of them is
-- actually chosen, all three go false at once, and the worker loses read on
-- the very document that governs how and when they are paid: its stage
-- names, its proportions, and the evidence each stage releases against.
--
-- That was invisible until the portal started reading payment stages from a
-- Quote Pack as well as a Kickoff Pack (20260902d/g). A booked worker on the
-- Quote Pack path would open their job room and find the stage ledger empty,
-- while the client looking at the same job saw it in full.
--
-- Additive, and deliberately so. This grants one new thing, read on an
-- APPROVED pack for a job the reader is the booked worker on. It does not
-- touch either existing policy: PERMISSIVE policies are OR'd, so the
-- browsing rule keeps its own shape and nothing that could not be read
-- before this migration becomes readable except to that one worker on that
-- one job. Drafts stay unreadable to workers entirely, as before.

create policy "booked worker can read approved quote_pack_drafts for their job"
  on public.quote_pack_drafts
  for select
  using (
    status = 'approved'
    and exists (
      select 1
      from public.jobs j
      where j.id = quote_pack_drafts.job_id
        and lower(coalesce(j.worker_email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
        and coalesce(j.worker_email, '') <> ''
    )
  );
