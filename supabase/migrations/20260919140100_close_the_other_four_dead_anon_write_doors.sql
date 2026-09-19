-- Close the four remaining anon write doors on tables no form writes to.
--
-- Found by the same check that found the one on public.intakes, 19 September
-- 2026, and they are the same leftover: an INSERT policy granted to the anon
-- role WITH CHECK (true), created when a form on the marketing site wrote
-- straight to its table from the browser with the publishable key. There was
-- no session, so there was nothing for the check to check.
--
-- Nothing writes any of them from a browser today. Every live form on
-- yaadly.co.uk posts to an edge function instead: the contact form to
-- yaad-enquiry, the service booking to yaad-book-service, the chat widget to
-- yaad-inbound. Those functions hold the service role key, which bypasses row
-- level security entirely, so none of them needs an anon policy and none of
-- them is affected by this.
--
-- Checked on 19 September 2026, across docs/, preview/, web/ and
-- supabase/functions/, before writing this:
--
--   applications  LIVE FLOW, UNAFFECTED. app.yaadly.co.uk/apply posts to
--                 yaad-vetting-upload, which inserts with the service role
--                 client. No browser code anywhere calls .from("applications").
--                 Worker signup does not touch this policy and does not break.
--   calls         No writer. The booking form that fed it is gone from the
--                 site. The desk's Calls view still reads it, under admin.
--   feedback      No writer. Same story. The desk's Feedback view still reads
--                 it, under admin.
--   waitlist      No writer. The homepage popup that fed it is gone. The
--                 desk's Waiting list view still reads it, under admin.
--
-- The three dormant ones keep their tables, their rows and their admin read,
-- so the views above are unchanged and nothing is lost. What goes is the
-- ability for anybody holding the publishable key, which is in the page source
-- of a public website by design, to push rows into a table nobody is watching.
--
-- IF A FORM COMES BACK, do not put one of these policies back. Post to an edge
-- function like every other live form on the site already does: it gets a
-- throttle, an origin check and a place to put validation, and none of that
-- exists in a policy whose check is the word true.
--
-- The anon GRANTs stay, as on intakes and for the same reason: every table in
-- this database leans on RLS rather than on grants, and making four tables
-- work differently from the other forty is how a rule stops being understood.
-- With no permitting policy, anon can do nothing to them.

drop policy if exists "public submits applications" on public.applications;
drop policy if exists "public books calls"          on public.calls;
drop policy if exists "public leaves feedback"      on public.feedback;
drop policy if exists "public joins waitlist"       on public.waitlist;
