-- Close the anon write door on public.intakes.
--
-- WHAT THIS DROPS. One policy, "public submits requests", INSERT to the anon
-- role WITH CHECK (true). It was created for the old public "Tell us what
-- needs doing" form on yaadly.co.uk, which wrote straight to this table from
-- the browser with the publishable key. That is why the check is true: there
-- was no session to check anything against.
--
-- WHY IT IS SAFE TO CLOSE. That form was deleted on 31 August 2026, when the
-- marketing site became short marketing and the app became the only place a
-- job is created. Its edge function, yaad-website-intake, was retired to a 410
-- on the same day. On 19 September 2026 a check of the whole repository found
-- nothing that reads or writes this table: not a function, not the app, not
-- the marketing site, not the admin desk, not a trigger. The desk's Intake
-- queue read it until earlier today and now reads jobs, enquiries and
-- intake_threads instead. The table's newest row is a hand-made test from
-- 12 August 2026, and there is one row in it.
--
-- WHY IT IS WORTH CLOSING. An INSERT policy with a true check, granted to
-- anon, is a door anybody holding the publishable key can push on, and the
-- publishable key is in the page source of a public website by design. Nobody
-- would find rows through it (SELECT is admin only) but they could fill the
-- table, and a table nobody watches is exactly where that would sit unnoticed.
-- It is a leftover, not a feature.
--
-- WHAT IS DELIBERATELY NOT DONE HERE.
--   * The table stays. It holds a record, and dropping a table is not
--     something to fold into a policy change.
--   * The anon GRANTs stay. Supabase grants anon table privileges across the
--     public schema by default and every table in this database relies on RLS
--     rather than on grants to decide who may do what. Revoking them here
--     alone would make this one table work differently from the other forty,
--     which is how a rule stops being understood. With this policy gone, anon
--     has no permitting policy on intakes and can do nothing to it.
--   * "admin all intakes" stays, so the desk can still read the row if the
--     table is ever put back on a screen.
--
-- After this, public.intakes has exactly one policy: admin, for everything.

drop policy if exists "public submits requests" on public.intakes;

comment on table public.intakes is
  'RETIRED. The old public website request form wrote here until 31 August 2026. Nothing reads or writes it now: a job arrives through yaad-post-job into jobs, a WhatsApp message through yaad-inbound into intake_threads, a contact form through yaad-enquiry into enquiries. Kept for the record it holds. Its anon INSERT policy was dropped on 19 September 2026; admin is the only policy left.';
