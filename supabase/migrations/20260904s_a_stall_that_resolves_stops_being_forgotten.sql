-- A stall that resolves stops being forgotten.
--
-- job_stall_state holds one row per job that has gone quiet long enough to be
-- nudged or escalated, and clear_resolved_job_stalls() DELETES that row the
-- moment the job moves again. That delete is right: the comment on the table
-- says the clock should genuinely reset rather than leave a stale flag, and it
-- does.
--
-- It also throws away the only evidence the stall ever happened. So "how often
-- do jobs stall" could be answered for right now and never over time, and "how
-- long do they stay stalled" could not be answered at all. Both were asked for
-- in the system review and neither was computable.
--
-- One row written on the way out fixes it. The live table keeps behaving
-- exactly as it did; nothing about nudging, escalating or clearing changes.
--
-- WHAT THE CLOCK MEASURES, precisely, because the name matters. It runs from
-- when WE NOTICED (nudged_at) to when the job moved again, not from when the
-- job actually went quiet. The moment it went quiet is not recorded anywhere
-- and back-computing it from job_silence_hours() at delete time would be
-- inventing a number. Time from noticing to moving is also the more useful
-- one: it is the part Yaadly controls.

create table if not exists public.job_stall_resolved (
  id            bigint generated always as identity primary key,
  job_id        text        not null,
  nudged_at     timestamptz,
  escalated_at  timestamptz,
  first_seen_at timestamptz not null,
  resolved_at   timestamptz not null default now(),
  hours_stalled numeric
);

comment on table public.job_stall_resolved is
  'One row per stall that ended, written by clear_resolved_job_stalls() just before it deletes the live row. hours_stalled runs from when Yaadly noticed (nudged_at, or first_seen_at if it never got that far) to when the job moved again, not from when it actually went quiet: that moment is not recorded anywhere and inventing it would be worse than measuring the part Yaadly controls.';

create index if not exists job_stall_resolved_at_idx on public.job_stall_resolved (resolved_at desc);

alter table public.job_stall_resolved enable row level security;
drop policy if exists "job_stall_resolved_admin_read" on public.job_stall_resolved;
create policy "job_stall_resolved_admin_read" on public.job_stall_resolved
  for select using (is_admin());
revoke all on public.job_stall_resolved from anon;
grant select on public.job_stall_resolved to authenticated;
grant all on public.job_stall_resolved to service_role;

-- Same signature, same return, same delete. It just writes the row down first.
create or replace function public.clear_resolved_job_stalls(p_nudge_hours numeric)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_count integer;
begin
  insert into public.job_stall_resolved (job_id, nudged_at, escalated_at, first_seen_at, resolved_at, hours_stalled)
  select s.job_id, s.nudged_at, s.escalated_at, s.updated_at, now(),
         round(extract(epoch from (now() - coalesce(s.nudged_at, s.updated_at))) / 3600.0, 1)
    from public.job_stall_state s
   where public.job_silence_hours(s.job_id) < p_nudge_hours;

  delete from public.job_stall_state s
   where public.job_silence_hours(s.job_id) < p_nudge_hours;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- What the desk asks. One row, so the Overview does no arithmetic.
create or replace view public.stall_metrics
with (security_invoker = true) as
  select
    (select count(*) from public.job_stall_state)                            as stalled_now,
    (select count(*) from public.job_stall_state where escalated_at is not null) as escalated_now,
    (select count(*) from public.jobs
      where status in ('evidence','open_for_quotes','quoted'))               as live_jobs,
    (select round(avg(hours_stalled)) from public.job_stall_resolved
      where resolved_at > now() - interval '30 days')                        as avg_hours_to_unstall,
    (select count(*) from public.job_stall_resolved
      where resolved_at > now() - interval '30 days')                        as resolved_30d;

comment on view public.stall_metrics is
  'Stall rate and time to unstall. stalled_now over live_jobs is the rate right now; avg_hours_to_unstall is how long a stall lasted from Yaadly noticing to the job moving, over the last 30 days.';

grant select on public.stall_metrics to authenticated;
