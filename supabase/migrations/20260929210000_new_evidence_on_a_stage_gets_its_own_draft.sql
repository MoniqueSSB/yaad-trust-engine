-- New evidence on a stage gets its own draft. The same evidence never gets two.
--
-- Founder, 29 September 2026, testing as the worker on JOB-WEB-1789253807959:
-- "no draft report sent to me", "there was no response on next steps, there
-- should be", "a worker should never have to think what to do next".
--
-- WHAT HAPPENED. She filed photographs on stage 3 at 13:50, was sent the draft
-- at 13:53 and accepted it at 14:03. At 15:57 she filed more on the same
-- stage, was told "the client hears about it once it is drafted", and nothing
-- was ever drafted. The timer opened, ran out and was cleared silently,
-- because 20260906015600 allows one notification per job and stage, for good.
--
-- WHY THAT RULE NO LONGER DOES WHAT IT WAS WRITTEN FOR. Her instruction of
-- 5 September was "it should only go to the email ONCE not twice", about a
-- CLIENT receiving the same sentence about the same stage twice. But since
-- 20260831zz evidence_landed is not the client's message at all. It is the
-- draft sent to the WORKER, and the client hears only when the worker has
-- confirmed it. So the once-per-stage rule has been silencing the worker's
-- next step, and with it everything the client would have been told about a
-- second day's work on a stage.
--
-- THE RULE NOW. A notification is due when there is evidence on the stage
-- newer than the last one sent. Both instructions hold: nothing is ever
-- drafted twice for the same evidence, and nothing filed later goes unheard.
-- The 90 second quiet timer is untouched, so a burst is still one draft.
--
-- THE COST, stated plainly. A stage worked over three days can produce three
-- drafts, and if the worker sends all three the client hears three times.
-- Each one says something new. That is the trade she chose today.
--
-- Function body only. No table, no column, no policy changes, so nothing here
-- needs RLS and the deployed edge functions need no redeploy for it.

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
          -- Due only if something was filed on this stage after the last
          -- notification that was actually sent. No earlier notification at
          -- all means everything on the stage is new.
          and exists (
            select 1 from public.evidence e
             where e.job_id = p.job_id
               and greatest(coalesce(e.stage, 0), 1) = p.stage
               and e.created_at > coalesce((
                     select max(q.notified_at) from public.evidence_landed_pending q
                      where q.job_id = p.job_id and q.stage = p.stage
                   ), '-infinity'::timestamptz)
          )) as should_notify
    from public.evidence_landed_pending p
    join public.jobs j on j.id = p.job_id
   where p.fired_at is null and p.due_at <= now();
$$;

revoke all on function public.due_evidence_landed_notifies() from public, anon, authenticated;

-- Proof, on a job that has had two batches on one stage: the second row now
-- carries a notified_at of its own.
--   select job_id, stage, created_at, fired_at, notified_at
--     from public.evidence_landed_pending order by created_at desc limit 10;
