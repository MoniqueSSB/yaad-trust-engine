-- The quote pack is the gate, and clearing one held draft is a decision.
--
-- CORRECTING 20260904u, WHICH GOT THE SEQUENCE BACKWARDS. That migration
-- excluded quote_pack_drafts and kickoff_packs from desk_decisions and said
-- they were "documents issued automatically after a human accepted a quote,
-- not decisions anybody sat down and made". The second half was right about
-- the 314 auto-issued rows and the first half was simply wrong, in a way that
-- matters more than a comment usually does.
--
-- The quote pack does not follow a quote. It is what a worker quotes AGAINST:
-- an approved draft is the thing RLS lets a worker read before pricing the
-- job, and 20260901r is explicit that 'approved' rather than 'ready' is the
-- gate the worker's own quote form reads. Founder's words, 4 September 2026:
-- the quote pack is the only thing that needs to approve a job. So the one
-- document I described as an afterthought is the document that decides whether
-- a job reaches anybody at all.
--
-- The kickoff pack is the one that follows, and it does not follow acceptance
-- either. Founder, same day: it is generated for jobs which have paid and
-- require it.
--
-- WHAT CHANGES IN THE COUNT. The system:% exclusion stays exactly as it was
-- and still keeps all 314 auto-issued rows out. What was wrong was excluding
-- the TABLES, which also threw away the human path. approve_quote_pack_draft()
-- is admin only, refuses outright on any guardrail flag rather than offering
-- an override, and attributes the approval to the signed-in admin precisely so
-- that "a named human confirmed this" is something the row can prove. That is
-- the definition of a desk decision, and it was the one being discarded.
--
-- On 4 September 2026 no human had ever cleared one: 307 auto-issued, 22
-- failed, and one sitting at 'ready' waiting for a person. So this adds no
-- rows today. It stops the first one from going uncounted.

create or replace view public.desk_decisions
with (security_invoker = true) as
    select 'evidence sign-off'::text as kind, sa.job_id, sa.approved_at as at, sa.approved_by as who
      from public.stage_approvals sa
     where sa.approved_at is not null
       and coalesce(sa.approved_by, '') <> ''
       and sa.approved_by not like 'system:%'
  union all
    select 'quote review', qr.job_id, qr.created_at, qr.reviewed_by
      from public.quote_reviews qr
     where coalesce(qr.reviewed_by, '') <> ''
       and qr.reviewed_by not like 'system:%'
  union all
    select 'materials release', mr.job_id, mr.released_at, mr.released_by
      from public.materials_releases mr
     where mr.released_at is not null
       and coalesce(mr.released_by, '') <> ''
       and mr.released_by not like 'system:%'
  union all
    -- The gate on whether a job reaches a worker at all.
    select 'quote pack cleared', qp.job_id, qp.approved_at, qp.approved_by
      from public.quote_pack_drafts qp
     where qp.approved_at is not null
       and coalesce(qp.approved_by, '') <> ''
       and qp.approved_by not like 'system:%'
  union all
    select 'kickoff pack approved', kp.job_id, kp.approved_at, kp.approved_by
      from public.kickoff_packs kp
     where kp.approved_at is not null
       and coalesce(kp.approved_by, '') <> ''
       and kp.approved_by not like 'system:%'
  union all
    select 'sketch pack approved', sp.job_id, sp.approved_at, sp.approved_by
      from public.sketch_packs sp
     where sp.approved_at is not null
       and coalesce(sp.approved_by, '') <> ''
       and sp.approved_by not like 'system:%';

comment on view public.desk_decisions is
  'Every consequential step a named person actually took, with when. Rows whose approver reads system:* are excluded, because an auto-issued guardrail-clean pack is the system deciding the content was clean, not a person sitting down to a decision. A pack HELD for a person and then cleared by them is counted, and the quote pack is the one that gates whether a job reaches a worker at all.';

grant select on public.desk_decisions to authenticated;

-- What is held right now, waiting on a person. Separate from the capacity
-- views on purpose: those look backwards at what was done, this is a queue.
create or replace view public.packs_awaiting_a_person
with (security_invoker = true) as
  select 'quote pack'::text as kind, qp.id::text as ref, qp.job_id, qp.created_at,
         round(extract(epoch from (now() - qp.created_at)) / 3600.0, 1) as hours_waiting
    from public.quote_pack_drafts qp
   where qp.status = 'ready';

comment on view public.packs_awaiting_a_person is
  'Quote pack drafts held at ready because the guardrail flagged something, waiting for a named person to clear or redraft. A held quote pack stops the job reaching any worker, and until 5 September 2026 nothing on the Overview counted one.';

grant select on public.packs_awaiting_a_person to authenticated;
