-- Applied to production 3 Sep 2026 via MCP as
-- a_visitor_can_actually_ask_a_question.
--
-- Ask a Yaad could not be asked. The page has existed since 26 Aug and the
-- table has had row level security since the day it was created, but the
-- only write policy on it was "admin full questions". A visitor posts with
-- the publishable key as the anon role, so every question anybody has ever
-- typed on app.yaadly.co.uk/ask was refused by Postgres with 42501. The
-- server action ignored the error and redirected to ?sent=1 regardless, so
-- the visitor was told "Received" every time. The table has nil rows and
-- that is why.
--
-- Proven before writing this, in a transaction that was rolled back: set
-- role anon, insert one row, 42501 new row violates row-level security
-- policy for table "questions".
--
-- This is the missing policy. It is deliberately narrow, because it is the
-- one place on this project where an unauthenticated stranger writes a row.
-- What the CHECK enforces, and why each part is there:
--
--   published = false     The moderation gate. A question reaches the public
--                         board only when a person at the desk publishes it.
--                         Without this line an anon insert could arrive with
--                         published = true and publish itself, which is the
--                         whole gate gone. There is no update policy for
--                         anon, so nobody can flip their own row afterwards
--                         either.
--   length 10 to 500      Matches the form and the column's own intent. It
--                         stops both an empty row and somebody pasting a
--                         novel into a public page.
--   area <= 60            Matches the form. A parish, not an address.
--
-- What this does NOT do, stated plainly rather than left to be discovered:
-- there is no rate limit here. An anon role with the publishable key can
-- insert repeatedly, and nothing in Postgres counts how often. That is
-- survivable today because nothing publishes without a human, so the cost of
-- a flood is desk noise rather than a defaced public page, and because the
-- board carries no contact details worth harvesting. If it is ever abused,
-- the fix is a throttle in front of the insert (an Edge Function on the
-- yaad-enquiry pattern, which already has a per-recipient throttle), not a
-- looser policy here. See DECISIONS.md.

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
