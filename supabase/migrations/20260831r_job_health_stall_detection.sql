-- Worker nudges, stall escalation to the founder, and client delay notices,
-- founder's own framing 31 Aug 2026: "prompt to the workers ensuring he
-- does this so the client is updated... if there is something that need
-- escalating I will be contact direct." One clock, two thresholds, three
-- audiences.
--
-- Money is untouched by any of this. approve_stage() already refuses to
-- release a stage with nothing filed against it; a stalled job simply never
-- reaches that gate. This is coordination, catching a job before it goes
-- quiet long enough to worry a client, never a payment decision, and
-- nothing here writes to jobs.status, stage_approvals or evidence.
--
-- job_silence_hours() is one definition of "how long has nothing happened
-- on this job", used by both the nudge and the escalation so the two
-- thresholds are measured against the same clock rather than two that could
-- silently drift apart. The floor is jobs.updated_at: a job with a worker
-- but not one single arrival or evidence row yet is not exempt, it is the
-- most stalled case there is.

create table if not exists public.job_stall_state (
  job_id       text primary key references public.jobs(id) on delete cascade,
  nudged_at    timestamptz,
  escalated_at timestamptz,
  updated_at   timestamptz not null default now()
);

comment on table public.job_stall_state is
  'One row per job that has gone quiet long enough to have been nudged or escalated. Deleted once the job shows real activity again, so the clock genuinely resets rather than a stale flag lingering. Doubles as the founder-reviewed lateness record: see worker_stall_history.';

create or replace function public.job_silence_hours(p_job text)
returns numeric
language sql
stable
security definer
set search_path to 'public'
as $$
  select extract(epoch from (
    now() - greatest(
      coalesce((select max(a.arrived_at) from public.arrival_log a where a.job_id = p_job), '-infinity'::timestamptz),
      coalesce((select max(e.created_at) from public.evidence e where e.job_id = p_job), '-infinity'::timestamptz),
      coalesce((select max(sa.approved_at) from public.stage_approvals sa where sa.job_id = p_job), '-infinity'::timestamptz),
      (select j.updated_at from public.jobs j where j.id = p_job)
    )
  )) / 3600.0;
$$;

revoke all on function public.job_silence_hours(text) from public, anon, authenticated;

create or replace function public.stalled_job_candidates(p_nudge_hours numeric)
returns table(job_id text, title text, worker_email text, client_email text, hours_silent numeric, already_nudged boolean, already_escalated boolean)
language sql
stable
security definer
set search_path to 'public'
as $$
  select j.id, coalesce(j.title, j.id), j.worker_email, j.client_email,
         public.job_silence_hours(j.id),
         s.nudged_at is not null,
         s.escalated_at is not null
    from public.jobs j
    left join public.job_stall_state s on s.job_id = j.id
   where j.status = 'in_progress'
     and coalesce(j.worker_email, '') <> ''
     and public.job_silence_hours(j.id) >= p_nudge_hours;
$$;

revoke all on function public.stalled_job_candidates(numeric) from public, anon, authenticated;
-- Called from yaad-job-health with the service role, never from a browser:
-- it names every worker and client email on a stalled job, which is exactly
-- the kind of thing RLS on jobs itself already keeps from a stranger, and
-- this function would otherwise be a second door around that.

create or replace function public.mark_job_nudged(p_job text)
returns void
language sql
security definer
set search_path to 'public'
as $$
  insert into public.job_stall_state (job_id, nudged_at, updated_at)
  values (p_job, now(), now())
  on conflict (job_id) do update set nudged_at = coalesce(job_stall_state.nudged_at, now()), updated_at = now();
$$;

create or replace function public.mark_job_escalated(p_job text)
returns void
language sql
security definer
set search_path to 'public'
as $$
  insert into public.job_stall_state (job_id, nudged_at, escalated_at, updated_at)
  values (p_job, now(), now(), now())
  on conflict (job_id) do update set
    nudged_at = coalesce(job_stall_state.nudged_at, now()),
    escalated_at = now(),
    updated_at = now();
$$;

create or replace function public.clear_resolved_job_stalls(p_nudge_hours numeric)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_count integer;
begin
  delete from public.job_stall_state s
   where public.job_silence_hours(s.job_id) < p_nudge_hours;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.mark_job_nudged(text) from public, anon, authenticated;
revoke all on function public.mark_job_escalated(text) from public, anon, authenticated;
revoke all on function public.clear_resolved_job_stalls(numeric) from public, anon, authenticated;
-- No grants to authenticated either: these three are write paths on a table
-- with no RLS policies of its own, called only by yaad-job-health holding
-- the service role. A signed-in worker or client marking their own job
-- "nudged" or "escalated" would make the record worthless.

-- ---------------------------------------------------------- the admin record

-- The narrow version of what was asked for, not a computed score: a plain
-- list of which jobs actually stalled and what happened, for a human to
-- read and decide what it means. Founder's own words: "human reviewed...
-- visible to me... not automatic." Flagged before building, 31 Aug 2026,
-- against CLAUDE.md's own "Yaad Score computation" out-of-scope line;
-- this is deliberately narrower than that: no aggregation, no ranking, no
-- client-facing surface, and nothing here feeds worker matching.
create or replace view public.worker_stall_history as
  select j.worker_email, s.job_id, j.title, j.parish, s.nudged_at, s.escalated_at, s.updated_at
    from public.job_stall_state s
    join public.jobs j on j.id = s.job_id
   where s.nudged_at is not null
   order by s.nudged_at desc;

comment on view public.worker_stall_history is
  'Every job that went quiet long enough to be nudged, one row each, newest first. Read by concierge only; nothing in this repository computes a score from it or acts on it automatically.';
