-- job_stall_state was created with no RLS policy of its own, and
-- worker_stall_history was a plain view over it. A plain view in Postgres
-- runs with the OWNER's privileges by default, not the querying role's, so
-- it would have exposed every worker's stall history to anyone PostgREST
-- ever granted select to, RLS on the underlying tables notwithstanding.
-- Caught before this was ever wired into concierge, not after.
--
-- Fixed two ways, together: job_stall_state gets an explicit admin-only
-- policy, same is_admin() gate every other staff-only table in this
-- repository uses, and worker_stall_history is recreated with
-- security_invoker so it actually respects that policy instead of running
-- as the view owner and bypassing it.

alter table public.job_stall_state enable row level security;

drop policy if exists job_stall_state_admin_only on public.job_stall_state;
create policy job_stall_state_admin_only on public.job_stall_state
  for select to authenticated
  using (public.is_admin());

-- Written only by mark_job_nudged / mark_job_escalated / clear_resolved_job_stalls,
-- all SECURITY DEFINER and all already revoked from anon and authenticated
-- (20260831r). No insert or update policy is needed here for the same
-- reason those three functions exist: the service role they run under is
-- not subject to RLS at all, and nobody else should be writing this table.

drop view if exists public.worker_stall_history;
create view public.worker_stall_history
  with (security_invoker = true)
  as
  select j.worker_email, s.job_id, j.title, j.parish, s.nudged_at, s.escalated_at, s.updated_at
    from public.job_stall_state s
    join public.jobs j on j.id = s.job_id
   where s.nudged_at is not null
   order by s.nudged_at desc;

comment on view public.worker_stall_history is
  'Every job that went quiet long enough to be nudged, one row each, newest first. security_invoker so it reads through job_stall_state_admin_only rather than the view owner''s own privileges: admin-only, same as everything else concierge shows. Nothing in this repository computes a score from it or acts on it automatically.';

revoke all on public.worker_stall_history from public, anon;
grant select on public.worker_stall_history to authenticated;
