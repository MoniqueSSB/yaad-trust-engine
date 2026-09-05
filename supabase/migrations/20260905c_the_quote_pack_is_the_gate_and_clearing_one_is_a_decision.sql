-- The quote pack is the gate, and clearing one held draft is a decision.
--
-- CORRECTING 20260904u, WHICH GOT THE SEQUENCE BACKWARDS. That migration
-- excluded quote_pack_drafts and kickoff_packs from desk_decisions and said
-- they were "documents issued automatically after a human accepted a quote,
-- not decisions anybody sat down and made". The second half was right about
-- the 314 auto-issued rows and the first half was simply wrong, in a way that
-- matters more than a comment usually does.
--
-- The quote pack does not follow a quote. It BECOMES one. The table's own
-- comment says it plainly: one AI-drafted overview per job, scope and rough
-- timeline and payment-stage structure, no prices; a worker reviews it, edits
-- it, adds their own price on job_quotes, and that edited copy is the quote
-- the client sees. RLS only lets a worker read a draft at 'approved', which
-- 20260901r made the gate the worker's own quote form reads.
--
-- So it is not an internal artefact and it is not an afterthought. Founder's
-- words, 4 and 5 September 2026: the quote pack is the only thing that needs
-- to approve a job, and it is what is generated on each quote for the client.
-- A draft held at 'ready' therefore does not merely slow a job down. No worker
-- can read it, so no quote gets built from it, so nothing reaches the client
-- at all.
--
-- The kickoff pack comes after and is gated on money, not on acceptance.
-- Founder, same day: you have to pay for it. There is one per quote
-- (kickoff_packs_quote_id_unique) and both sides confirm a revision with a
-- shared code in kickoff_pack_agreements.
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
  'Quote pack drafts held at ready because the guardrail flagged something, waiting for a named person to clear or redraft. The draft is what a worker edits and prices into the quote the client actually sees, so a held one means no quote reaches that client at all. Until 5 September 2026 nothing on the Overview counted one.';

grant select on public.packs_awaiting_a_person to authenticated;
