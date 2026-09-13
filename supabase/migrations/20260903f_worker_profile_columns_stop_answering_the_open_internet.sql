-- Worker profile columns stop answering the open internet.
--
-- Found 3 September 2026 during the worker directory/profile UX pass, the
-- same class of gap as 20260903c but in RLS rather than function grants.
--
-- wp_select_public ("active = true") and wp_select_signed_in ("active = true
-- or is_admin()") are ROW policies. Postgres RLS gates which rows a role may
-- see; it says nothing about which columns. worker_profiles.worker_email and
-- .phone sat on the same row as name and trade, so anybody holding the
-- publishable key could already call
--   GET /rest/v1/worker_profiles?select=name,worker_email,phone
-- and read every active worker's phone number and email straight off the
-- open internet, no login needed. Same shape of leak on worker_checks and
-- portfolio, both of which carry worker_email on every row purely as a join
-- key nobody meant to publish. Confirmed live: 6 active profiles, 4 with a
-- phone on file, 6 with an email, none of it ever rendered by the app, all
-- of it selectable directly against the table.
--
-- The fix is the same shape as published_reviews: a view holding only the
-- columns a stranger should see, the base table locked down behind it. Three
-- views, not one, because worker_checks and portfolio are separate tables
-- with the same worker_email leak; each gets a subject_slug column so the
-- app can join on the public slug instead of the private email, exactly the
-- translation published_reviews already made for reviews.subject_email.
--
-- WHAT STAYS REACHABLE ON THE BASE TABLE.
-- A worker still needs to read their OWN row (own phone in the portal, own
-- name when submitting a quote) and the desk still needs every row. Both
-- existing call sites are kept working: web/app/portal/(gated)/worker/page.tsx
-- matches on worker_user, web/app/jobs/actions.ts matches on worker_email.
-- wp_select_own_or_admin below allows either, plus is_admin() for the desk.
--
-- WHAT THIS DOES NOT TOUCH. No worker row changes. worker_checks and
-- portfolio keep their existing "admin full ..." ALL-command policies
-- untouched, so the desk's write path is unaffected.

begin;

-- ── worker_profiles: replace the two broad row policies ─────────────────────
drop policy if exists wp_select_public on public.worker_profiles;
drop policy if exists wp_select_signed_in on public.worker_profiles;

create policy wp_select_own_or_admin on public.worker_profiles
  for select to authenticated
  using (
    (worker_user = auth.uid())
    or (worker_email is not null and lower(worker_email) = lower(coalesce(auth.jwt() ->> 'email', '')))
    or public.is_admin()
  );

-- Defense in depth: even if a future policy is added carelessly, anon has no
-- grant to fall back on. authenticated keeps its table grant, narrowed by
-- the policy above.
revoke select on public.worker_profiles from anon, public;

-- ── worker_checks / portfolio: drop the "active workers are public" row policy ──
-- The remaining "admin full ..." ALL policy already covers admin SELECT.
drop policy if exists "checks of active workers are public" on public.worker_checks;
drop policy if exists "portfolio of active workers is public" on public.portfolio;
revoke select on public.worker_checks from anon, public;
revoke select on public.portfolio from anon, public;

-- ── The three public-safe views, same pattern as published_reviews ──────────
create or replace view public.public_worker_profiles as
select
  wp.name,
  wp.trade,
  wp.parish,
  wp.areas,
  wp.lane,
  wp.jobs_completed,
  wp.about,
  wp.years,
  wp.vetting_state,
  wp.slug
from public.worker_profiles wp
where wp.active;

create or replace view public.public_worker_checks as
select
  wc.label,
  wc.passed,
  wc.note,
  wc.position,
  wp.slug as subject_slug
from public.worker_checks wc
join public.worker_profiles wp on lower(wp.worker_email) = lower(wc.worker_email)
where wp.active;

create or replace view public.public_portfolio as
select
  p.title,
  p.month,
  p.stages,
  p.evidence_items,
  p.position,
  wp.slug as subject_slug
from public.portfolio p
join public.worker_profiles wp on lower(wp.worker_email) = lower(p.worker_email)
where wp.active;

grant select on public.public_worker_profiles to anon, authenticated;
grant select on public.public_worker_checks to anon, authenticated;
grant select on public.public_portfolio to anon, authenticated;

commit;
