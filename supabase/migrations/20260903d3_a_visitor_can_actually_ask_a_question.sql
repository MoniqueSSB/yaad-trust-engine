-- RECONSTRUCTED 3 Sep 2026 by the post-optimisation regression audit, same as
-- 20260903d2 and for the same reason: it ran against production and was never
-- committed.
--
-- This is the revert of 20260903d2, and its name is the whole story. Phase two
-- was applied while the deployed web app was still inserting into `questions`
-- directly, so dropping the policy stopped real visitors asking questions. Put
-- back immediately, which was the right call.
--
-- It is superseded by 20260903j, which drops the policy again now that the
-- deployed app calls ask_question() and after checking that the function
-- bypasses RLS anyway. Kept here rather than deleted so the sequence reads
-- honestly: this is what a same-day revert looks like, and the lesson is in
-- the ordering, not in the SQL.
drop policy if exists "anyone may ask" on public.questions;

create policy "anyone may ask" on public.questions
  for insert to anon, authenticated
  with check (
    published = false
    and length(btrim(body)) between 10 and 500
    and (area is null or length(btrim(area)) <= 60)
  );

comment on table public.questions is
  'Ask a Yaad. Anyone may insert, unpublished only ("anyone may ask"). A person at the desk publishes, in the Questions view of the concierge. Answers are vetted workers only.';
