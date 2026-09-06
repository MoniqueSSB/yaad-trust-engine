-- The evidence email goes once per stage, not once per batch.
--
-- Founder's instruction, 5 September 2026: "it should only go to the email
-- ONCE not twice."
--
-- 20260831zzzz6 debounced a BURST. Every evidence insert resets a 90 second
-- quiet timer, so five photographs sent back to back over WhatsApp produce one
-- email rather than five. That was correct and it still is.
--
-- What it never covered is two batches an hour apart. The open-timer index is
-- partial (where fired_at is null), so once a timer has fired, the next photo
-- opens a fresh one, and should_notify is still true: the job is still status
-- 'evidence' on the same stage, because nobody has approved it yet. Second
-- email.
--
-- That was occasional before today. It is now the ordinary shape of a job:
-- 20260906014900 asks a worker to tag each photograph as a before or an after,
-- so a stage reliably has a before filing and, later, an after filing. Two
-- batches, ninety minutes apart, two emails. Building that and leaving this
-- would be shipping the annoyance on purpose.
--
-- So: one evidence email per job and stage. Anything filed after the first
-- notification lands silently, and the client sees it when they open the stage
-- they have already been told to look at. The desk sees every item either way.
--
-- The cost, stated plainly: a client who reads the email the moment the before
-- lands and then never looks again is not pinged when the after arrives. That
-- is the right way round. Two emails saying the same sentence about the same
-- stage is how people learn to ignore both, and the approval that releases
-- money is a thing they come back to the portal for.
--
-- ── Why a new column ──
--
-- fired_at cannot answer "has this stage already been emailed", because
-- yaad-evidence-landed-check stamps it on BOTH paths: one when it sent, one
-- when it cleared a stale timer silently (approved, disputed or moved on in
-- the 90 seconds the timer was open). Reusing it would treat a silently
-- cleared timer as a delivered email and suppress the real one. notified_at
-- records only the sends.

alter table public.evidence_landed_pending
  add column if not exists notified_at timestamptz;

comment on column public.evidence_landed_pending.notified_at is
  'Set only when an evidence_landed notification was actually attempted for this timer. fired_at is stamped on every timer that gets dealt with, including ones cleared silently as stale, so it cannot be read as "the client was told".';

-- Dropped rather than overloaded. A two-argument version alongside the
-- existing one-argument version makes the call PostgREST already makes,
-- {"p_id": ...}, ambiguous between them, and the failure would be a 300 at
-- the moment a notification was due.
drop function if exists public.mark_evidence_landed_fired(uuid);

create function public.mark_evidence_landed_fired(p_id uuid, p_notified boolean default false)
returns void
language sql
security definer
set search_path to 'public'
as $$
  update public.evidence_landed_pending
     set fired_at    = now(),
         notified_at = case when p_notified then now() else notified_at end
   where id = p_id;
$$;

revoke all on function public.mark_evidence_landed_fired(uuid, boolean) from public, anon, authenticated;

-- The default is false on purpose, so the currently deployed edge function,
-- which passes only p_id, keeps behaving exactly as it does today until it is
-- redeployed. It will simply never record a send, which suppresses nothing.
-- Failing towards the old behaviour is the right direction for a change that
-- decides whether a client hears from us at all.

create or replace function public.due_evidence_landed_notifies()
returns table(id uuid, job_id text, stage integer, should_notify boolean)
language sql
stable
security definer
set search_path to 'public'
as $$
  select p.id, p.job_id, p.stage,
         (j.status = 'evidence'
          and greatest(coalesce(j.stage, 0), 1) = p.stage
          -- Once per job and stage. A second batch on a stage the client has
          -- already been told about lands silently.
          and not exists (
            select 1 from public.evidence_landed_pending q
             where q.job_id = p.job_id
               and q.stage  = p.stage
               and q.notified_at is not null
          )) as should_notify
    from public.evidence_landed_pending p
    join public.jobs j on j.id = p.job_id
   where p.fired_at is null and p.due_at <= now();
$$;

revoke all on function public.due_evidence_landed_notifies() from public, anon, authenticated;

-- Proof, on a job that has had two batches on one stage:
--   select job_id, stage, created_at, fired_at, notified_at
--     from public.evidence_landed_pending order by created_at desc limit 10;
-- Expect exactly one row per job and stage with notified_at set.
