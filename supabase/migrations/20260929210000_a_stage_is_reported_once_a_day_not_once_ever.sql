-- A stage is reported once a day, not once ever.
--
-- Founder, 29 Sep 2026 ("fix all"), after her own test photographs were filed
-- on stage 3 and no draft came. The cause was 20260906015600, which was her
-- own instruction of 5 September: "it should only go to the email ONCE not
-- twice". That instruction is kept. What changes is how long "once" lasts.
--
-- WHAT WAS WRONG WITH ONCE EVER
--   One notification per job and stage, for the life of the stage. A worker
--   who filed on Monday and again on Wednesday got a draft for Monday only.
--   Wednesday's evidence was filed and nobody was told, on a product whose
--   daily check-in asks for an update every day. It also meant the one draft
--   was always written from the FIRST batch, ninety seconds after the befores
--   landed, so the afters never reached a report at all.
--
-- THE RULE NOW
--   The CLIENT is told about a stage at most once per Jamaica day. That is
--   her 5 September rule, per day. draft_decisions is the record of a report
--   actually reaching a client, so it is what this reads.
--
--   Until the day's report has gone, new evidence refreshes the draft the
--   WORKER is holding. He is the one deciding what to send, so he should be
--   deciding on everything filed so far, not on the first batch. A refreshed
--   draft replaces the waiting one; it never stacks a second.
--
--   Once the day's report has gone, anything else filed that day lands
--   silently, exactly as before. The desk sees every item either way and the
--   client sees it when they open the stage.
--
-- THE COST, stated plainly, as 20260906015600 stated its own: evidence filed
-- after the day's report went out, on a stage nothing more is filed on, is
-- never reported by message. It is on the record and in the portal.
--
-- A timer is "already covered" when a notification went out after it was
-- opened. That is what stops a burst of timers each sending a draft.
--
-- Decides nothing. It chooses when a worker is offered a draft. Every report
-- is still sent by him, and every approval is still a named person's.

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
          -- already covered: a draft went out after this timer was opened
          and not exists (
            select 1 from public.evidence_landed_pending q
             where q.job_id = p.job_id
               and q.stage  = p.stage
               and q.notified_at is not null
               and q.notified_at >= p.created_at
          )
          -- the client has had today's report on this stage
          and not exists (
            select 1 from public.draft_decisions d
             where d.job_id = p.job_id
               and d.stage  = p.stage
               and d.kind   = 'evidence_report'
               and (d.decided_at at time zone 'America/Jamaica')::date
                   = (now() at time zone 'America/Jamaica')::date
          )) as should_notify
    from public.evidence_landed_pending p
    join public.jobs j on j.id = p.job_id
   where p.fired_at is null and p.due_at <= now();
$$;

revoke execute on function public.due_evidence_landed_notifies() from public, anon, authenticated;
grant execute on function public.due_evidence_landed_notifies() to service_role;
