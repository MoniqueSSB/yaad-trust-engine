-- A test worker sees test jobs on the board. Nobody else does.
--
-- WHAT WAS WRONG. Found running a worker test job on 28 Sep 2026.
-- 20260909150000 took every job marked is_test off open_jobs, for everybody,
-- which was right for the public and wrong for the founder: a job marked as a
-- test could never reach a worker, test workers included, so the only way to
-- test the worker side of the portal was to leave the job unmarked and let it
-- sit on the public board while she quoted it. The rule meant to keep tests
-- off the shop window was forcing them onto it.
--
-- WHAT THIS DOES. open_jobs keeps a test job for exactly one kind of viewer:
-- a signed-in worker whose own worker_profiles row is active and marked
-- is_test. Anonymous visitors, clients and every real worker see the board
-- exactly as before. Both flags are set only by a person, from the desk
-- (mark_job_test, mark_worker_test); nothing here infers either.
--
-- WHAT THIS DOES NOT DO. Quoting was never blocked by is_test:
-- job_open_for_quotes() and the jq_insert_vetted policy do not read it. This
-- change is about visibility only. A real worker still cannot see a test job,
-- and a test worker's quote on a real job is unchanged.
--
-- PRODUCTION SHAPE, same as 20260909150000: production has no request_state
-- and no request_is_live() (20260905a not applied), so that clause is built
-- conditionally. The btrim(client_email) clause from 20260913230642 is kept.

create or replace function public.viewer_is_test_worker()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.worker_profiles wp
     where wp.is_test
       and wp.active
       and lower(wp.worker_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
       and coalesce(auth.jwt() ->> 'email', '') <> ''
  );
$$;

comment on function public.viewer_is_test_worker() is
  'True only for a signed-in worker whose own active profile a person marked is_test. Lets open_jobs show test jobs to test workers and nobody else.';

revoke all on function public.viewer_is_test_worker() from public;
grant execute on function public.viewer_is_test_worker() to anon, authenticated;

do $body$
declare
  has_refusal boolean := exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'jobs' and column_name = 'request_state')
    and to_regproc('public.request_is_live') is not null;
begin
  execute format($v$
    create or replace view public.open_jobs as
     SELECT j.id, j.title, j.parish,
        public.board_descr(j.descr, j.client_name, j.client_email, j.client_phone) AS descr,
        j.updated_at,
        cp.user_id IS NOT NULL AS client_signed,
        COALESCE(cp.jobs_completed, 0) AS client_jobs_completed,
        j.trade, j.job_type, j.size_band, j.access_type, j.materials_by, j.urgency,
        j.materials_store_type
       FROM public.jobs j
         LEFT JOIN public.client_profiles cp ON lower(cp.email) = lower(COALESCE(j.client_email, ''::text))
      WHERE j.open = true AND COALESCE(j.worker_email, ''::text) = ''::text AND j.stage = 0
        AND (j.is_test = false OR public.viewer_is_test_worker())
        AND COALESCE(btrim(j.client_email), ''::text) <> ''::text
        %s
  $v$, case when has_refusal
            then 'AND NOT public.request_is_live(j.request_state, j.requested_at)'
            else '' end);
end
$body$;
