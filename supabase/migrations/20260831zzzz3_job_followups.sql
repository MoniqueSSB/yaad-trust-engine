-- The reporting agent's "Next:" line has said what happens next since the
-- port that gave it a live caller, 31 Aug 2026, and nothing has ever acted
-- on it: it is narrative in a WhatsApp message, read once and forgotten.
-- Founder's own gap, named directly in "what this session did not reach."
--
-- The mechanism mirrors job_stall_state / yaad-job-health on purpose,
-- rather than inventing a second pattern for "something needs to happen
-- later on this job": a table of pending items, a pg_cron check against it,
-- cleared automatically by real activity, fired once when the due date
-- arrives with nothing having moved. What differs is the SIGNAL, not the
-- shape: job-health watches for silence in general; this watches for one
-- named, specific thing the report itself promised would happen.

create table if not exists public.job_followups (
  id         uuid primary key default gen_random_uuid(),
  job_id     text not null references public.jobs(id) on delete cascade,
  stage      integer not null,
  reason     text not null,
  created_at timestamptz not null default now(),
  due_at     timestamptz not null,
  fired_at   timestamptz
);

-- One pending follow-up per job and stage at a time. A fresh report on the
-- same stage before the old one is due supersedes it (the upsert below),
-- rather than piling up several promises about the same piece of work.
create unique index if not exists job_followups_pending_uniq
  on public.job_followups (job_id, stage) where fired_at is null;

create index if not exists job_followups_due_idx
  on public.job_followups (due_at) where fired_at is null;

comment on table public.job_followups is
  'A promise the reporting agent made in its own "what happens next" line, with a date to check whether it happened. Cleared by real activity on the stage before the date arrives; fired once, via yaad-followup-check, if it does not. Never a payment decision: approve_stage() does not read this table and nothing here touches jobs.status.';

-- No policies, on purpose: every read and write goes through the
-- SECURITY DEFINER functions below, called only from yaad-notify-client
-- and yaad-followup-check on the service role. RLS enabled with nothing
-- granted is the default-deny CLAUDE.md's own security rules require on
-- every table, not only the ones a client or worker session ever queries
-- directly.
alter table public.job_followups enable row level security;

-- Two days, not job-health's three: this is a specific promised step, not
-- general silence, and the report that created it already told the client
-- something concrete was coming. A default, one constant, easy to retune
-- without touching the callers.
create or replace function public.create_job_followup(p_job text, p_stage integer, p_reason text, p_hours numeric default 48)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  insert into public.job_followups (job_id, stage, reason, due_at)
  values (p_job, p_stage, left(p_reason, 500), now() + (p_hours * interval '1 hour'))
  on conflict (job_id, stage) where fired_at is null
  do update set reason = excluded.reason, due_at = excluded.due_at, created_at = now();
end;
$$;

-- Called from yaad-notify-client, on the service role, right after the
-- reporting agent composes a message: the caller already knows the job,
-- the stage and the exact next-step text, so there is nothing here for a
-- browser session to authenticate.
revoke all on function public.create_job_followup(text, integer, text, numeric) from public, anon, authenticated;

-- A follow-up is resolved the moment the stage shows real activity after it
-- was created, the same "job shows real activity again" test job_stall_state
-- already applies, scoped to the one stage the promise was about rather
-- than the whole job: evidence filed, an arrival logged, or the stage
-- itself approved, any of which means whatever was promised has at least
-- moved, whether or not it was the exact thing named.
create or replace function public.clear_resolved_followups()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_count integer;
begin
  delete from public.job_followups f
   where f.fired_at is null
     and (
       exists (select 1 from public.evidence e where e.job_id = f.job_id and e.stage = f.stage and e.created_at > f.created_at)
       or exists (select 1 from public.arrival_log a where a.job_id = f.job_id and a.stage = f.stage and a.arrived_at > f.created_at)
       or exists (select 1 from public.stage_approvals sa where sa.job_id = f.job_id and sa.stage = f.stage and sa.approved_at > f.created_at)
     );
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.clear_resolved_followups() from public, anon, authenticated;

create or replace function public.due_job_followups()
returns table(id uuid, job_id text, stage integer, reason text)
language sql
stable
security definer
set search_path to 'public'
as $$
  select f.id, f.job_id, f.stage, f.reason
    from public.job_followups f
   where f.fired_at is null and f.due_at <= now();
$$;

revoke all on function public.due_job_followups() from public, anon, authenticated;

create or replace function public.mark_followup_fired(p_id uuid)
returns void
language sql
security definer
set search_path to 'public'
as $$
  update public.job_followups set fired_at = now() where id = p_id;
$$;

revoke all on function public.mark_followup_fired(uuid) from public, anon, authenticated;
