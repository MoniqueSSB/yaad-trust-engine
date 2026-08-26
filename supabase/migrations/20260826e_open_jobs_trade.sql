-- Applied to production 26 Aug 2026 via MCP (open_jobs_trade).
-- Adds trade to the public open_jobs view, appended as the last column
-- because Postgres will not reorder view columns in place. The contact
-- scrub in descr and the open/no-worker/stage-0 gate are unchanged.
create or replace view public.open_jobs as
 SELECT j.id,
    j.title,
    j.parish,
    regexp_replace(regexp_replace(regexp_replace(j.descr, '(^|\n)\s*(Address|Access contact)\s*:[^\n]*'::text, '\1'::text, 'gi'::text), '\+?[0-9][0-9\s().-]{7,}[0-9]'::text, '[contact removed]'::text, 'g'::text), '\n{3,}'::text, '\n\n'::text, 'g'::text) AS descr,
    j.updated_at,
    cp.user_id IS NOT NULL AS client_signed,
    COALESCE(cp.jobs_completed, 0) AS client_jobs_completed,
    j.trade
   FROM jobs j
     LEFT JOIN client_profiles cp ON lower(cp.email) = lower(COALESCE(j.client_email, ''::text))
  WHERE j.open = true AND COALESCE(j.worker_email, ''::text) = ''::text AND j.stage = 0;
