-- Seven views in this schema are SECURITY DEFINER, which means they run as
-- their owner and row level security never gets a look at them. anon held
-- SELECT on all seven and INSERT, UPDATE and DELETE on six.
--
-- That is not theoretical. released_reviews is an auto updatable view over
-- job_reviews, so an anonymous caller holding nothing but the publishable key
-- printed in the page source could insert straight through it into the base
-- table. Proven on 29 Aug 2026 inside a rolled back transaction: a five star
-- review against a real job id, written by anon, RLS never consulted. Job ids
-- are readable from open_jobs, so the one input the attack needed was already
-- public. Fake reviews are the single worst thing that can be written to a
-- business whose product is trust.
--
-- Reading was the same shape. released_reviews exposes author_email and
-- subject_email with the review body. yaad_scores, worker_scores and
-- client_scores expose subject_email with a score, which is every user of the
-- platform, enumerable by anybody with the key. They return nothing today only
-- because reviews, job_reviews and the profile tables are still empty. December
-- fills them.
--
-- The tables themselves were never the problem and are not touched here. RLS is
-- on for all 47 of them, is_admin() is written correctly, and both anon and a
-- signed in stranger were tested against live data on 29 Aug: every sensitive
-- table returned zero rows.
--
-- Grants are named for public, anon and authenticated together, per 20260828f.
-- Revoking from one of them is never enough.

-- ── 1. the three views nothing reads ──────────────────────────────────────
-- released_reviews, client_scores and yaad_scores have zero references in the
-- app, the edge functions or the concierge. They are admin shaped reporting
-- views that were left reachable by the public API. Nothing keeps SELECT.
revoke all on public.released_reviews from public, anon, authenticated;
revoke all on public.client_scores    from public, anon, authenticated;
revoke all on public.yaad_scores      from public, anon, authenticated;

-- client_summary is named in a comment in web/app/jobs/page.tsx but never
-- queried: the board reads the client columns off open_jobs instead.
revoke all on public.client_summary   from public, anon, authenticated;

-- ── 2. worker_scores loses the email it never needed to publish ───────────
-- The public worker page looks this up for one worker at a time, and it already
-- knows that worker by slug: it has just fetched the profile by slug, then went
-- back out to ask for the score by email. Keying on the slug the way
-- published_reviews already does removes the email column entirely, so there is
-- no list of addresses to walk even for somebody reading the view directly.
--
-- The join to worker_profiles also narrows the view to workers who have a
-- profile, which is exactly the set the page can ask about.
--
-- Still SECURITY DEFINER on purpose. It aggregates rows in reviews that a
-- visitor cannot read and must not be able to read. A definer aggregate is the
-- right tool for that, once what comes out of it is public by nature: a slug, a
-- rounded score and a count.
drop view if exists public.worker_scores;
create view public.worker_scores as
  select wp.slug as subject_slug,
         round(avg(r.stars), 1) as score,
         count(*) as reviews
    from reviews r
    join worker_profiles wp on lower(wp.worker_email) = lower(r.subject_email)
   where r.direction = 'client_of_worker'
     and (exists (select 1 from reviews o
                   where o.job_id = r.job_id and o.direction <> r.direction)
          or r.created_at < now() - interval '14 days')
   group by wp.slug;

-- ── 3. read only for the views the site genuinely serves ──────────────────
-- open_jobs was already correct at anon=r and is restated so the whole set can
-- be read in one place. Nobody outside service_role writes through a view again.
revoke all on public.open_jobs         from public, anon, authenticated;
revoke all on public.published_reviews from public, anon, authenticated;
revoke all on public.worker_scores     from public, anon, authenticated;
grant select on public.open_jobs         to anon, authenticated;
grant select on public.published_reviews to anon, authenticated;
grant select on public.worker_scores     to anon, authenticated;

-- ── 4. two admin policies that were aimed at the wrong role ───────────────
-- Both were written TO public, so anon evaluated is_admin() as well. anon has
-- no EXECUTE on it, so the request died with 42501 instead of returning an
-- empty result. No data leaked, but an anonymous read of either table errors
-- rather than coming back empty, and an error is a much worse failure mode to
-- discover in December. Every other admin policy in this schema is already
-- TO authenticated. These two now match.
drop policy if exists "intake_threads_admin_all" on public.intake_threads;
create policy "intake_threads_admin_all" on public.intake_threads
  for all to authenticated
  using (is_admin()) with check (is_admin());

drop policy if exists "kickoff_drafts_select_admin" on public.kickoff_drafts;
create policy "kickoff_drafts_select_admin" on public.kickoff_drafts
  for select to authenticated
  using (is_admin());
