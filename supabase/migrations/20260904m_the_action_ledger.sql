-- The action ledger.
--
-- The trail already exists. It is scattered across a dozen tables and an
-- OpenTelemetry exporter that is inert until an endpoint is configured, so on
-- the day a client disputes a job, reconstructing who did what is archaeology
-- across threads, evidence, approvals, notifications and packs.
--
-- This is not a debugging log. It is the record you hand to a client, an
-- insurer or a solicitor and say: here is exactly what happened, and here is
-- who decided it. That is why actor and actor_kind are not nullable and why
-- there is a check constraint rather than a convention.
--
-- CLAUDE.md §2 is enforced in Python (yaad/guardrails.py) and in Deno
-- (_shared/guardrails.ts). This puts the same rule in Postgres, which is the
-- layer nothing can talk past: a consequential action recorded against a
-- machine is refused at write time, not caught in review.

create table if not exists public.agent_actions (
  id          uuid primary key default gen_random_uuid(),
  at          timestamptz not null default now(),
  job_id      text references public.jobs(id) on delete cascade,
  actor       text not null,
  actor_kind  text not null check (actor_kind in ('human', 'agent')),
  action      text not null,
  summary     text,
  refs        jsonb not null default '{}'::jsonb,
  guardrail_findings jsonb,
  model       text,
  provider    text,

  -- The governing rule, in the database.
  --
  -- The list is HUMAN_ONLY_DECISIONS from yaad/guardrails.py, plus
  -- approve_stage, which is the name the live system actually uses for the
  -- step that moves money. Adding an action to this list is fine. Removing
  -- one is not, and a migration that does should be read as a mistake until
  -- somebody explains otherwise in DECISIONS.md.
  --
  -- 'system', 'auto' and an empty actor are refused for the same reason the
  -- Python guard refuses them: "the system did it" is not a named human.
  constraint agent_actions_human_only check (
    action not in (
      'release_funds', 'withhold_funds', 'refund_client', 'rule_on_dispute',
      'adjust_yaad_score', 'suspend_worker', 'approve_job', 'approve_stage'
    )
    or (
      actor_kind = 'human'
      and length(btrim(actor)) > 0
      and lower(btrim(actor)) not in ('ai', 'agent', 'system', 'auto', 'unknown')
    )
  )
);

create index if not exists agent_actions_job_idx on public.agent_actions(job_id, at desc);
create index if not exists agent_actions_at_idx  on public.agent_actions(at desc);
create index if not exists agent_actions_action_idx on public.agent_actions(action, at desc);

alter table public.agent_actions enable row level security;

-- Same read shape as evidence_comments and stage_approvals: this job's client
-- or worker, or an admin. A client being able to read the history of their own
-- job is a feature worth showing them, not a leak.
--
-- Rows with no job_id are desk-wide activity and are admin only.
create policy "parties read the ledger" on public.agent_actions
  for select using (
    public.is_admin() or (
      agent_actions.job_id is not null and exists (
        select 1 from public.jobs j
         where j.id = agent_actions.job_id
           and (lower(coalesce(j.client_email, '')) = lower(auth.jwt() ->> 'email')
                or lower(coalesce(j.worker_email, '')) = lower(auth.jwt() ->> 'email'))
      )
    )
  );

-- No insert, update or delete policy for anybody, deliberately.
--
-- Writes come from the Edge Functions on the service role, which bypasses RLS.
-- Append only is the whole point of a record you might one day put in front of
-- a solicitor: nothing in this system, including the desk, should be able to
-- edit history through PostgREST. Revoking explicitly rather than relying on
-- the absence of a policy, because absence is easy to undo by accident.
revoke insert, update, delete on public.agent_actions from anon, authenticated;

comment on table public.agent_actions is
  'Append only record of every consequential step: what the agents drafted and flagged, and what a named person then decided. Written by the Edge Functions on the service role. The check constraint enforces CLAUDE.md §2 at the database: an action that moves money or changes a reputation cannot be recorded against a machine.';

comment on column public.agent_actions.actor is
  'A named person''s email, or the function name for an agent step. Never "system" or "auto" on a consequential action.';
comment on column public.agent_actions.refs is
  'The rows this action touched, as {table: id}. Enough to find the evidence again in six months.';

-- What a dispute actually asks for: one job, one list, oldest first.
--
-- security_invoker is load bearing and not decoration. A Postgres view runs
-- with its OWNER's rights by default, which would have made this view read
-- every job's history for anybody who could select from it, straight past the
-- policy above. The comment underneath claims it inherits row level security;
-- this setting is the only thing that makes that claim true. Same reason
-- 20260903g exists, and the same setting the parallel session put on
-- sla_first_reply.
create or replace view public.v_job_history
with (security_invoker = true) as
  select a.job_id, a.at, a.actor, a.actor_kind, a.action, a.summary, a.refs
    from public.agent_actions a
   order by a.job_id, a.at;

comment on view public.v_job_history is
  'One job read as a single story. security_invoker means it inherits row level security from agent_actions, so a client sees their own job and nobody else''s.';

grant select on public.v_job_history to authenticated;
