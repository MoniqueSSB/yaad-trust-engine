-- Materials money that left the account and has no receipt against it yet.
--
-- Founder's instruction, 5 September 2026, and the reasoning is worth keeping
-- because it is not a data quality point. Under the principal structure Yaadly
-- holds no money on anybody's behalf, which is exactly what keeps it trading
-- rather than running a payment service. The other side of that coin is that
-- there is no structural thing stopping materials money for one job paying
-- labour on another. Small contractors do not usually go under because a job
-- lost money. They go under because the materials money for job B quietly
-- covered a wage bill on job A, and nobody could see it happening until the
-- blocks did not arrive.
--
-- The gap is already recordable and nothing was reading it: materials_releases
-- carries released_at (money moved) and receipt_ref (what it bought), and a row
-- can sit with the first set and the second empty indefinitely. That row is the
-- warning. These two views are the only thing in this repository that looks at
-- it.
--
-- Deliberately a report and not a block. Nothing here refuses a release, and it
-- must not: a release is a named human moving money under section 2, and the
-- answer to money going astray is a person seeing it, not a trigger deciding it.
-- The threshold, how many days is too many, is NOT set here. That is the
-- founder's number and it belongs in RUNBOOK.md where she can change it without
-- a migration. The view reports age; a person reads it.
--
-- No new table, so no new RLS. Both views run security_invoker so the existing
-- policies on materials_releases apply unchanged: the desk sees everything, and
-- a client or worker on the job sees their own rows and nobody else's.

-- ------------------------------------------------- one row per open release

create or replace view public.materials_open_releases
with (security_invoker = true) as
  select mr.id,
         mr.job_id,
         mr.stage,
         mr.amount_jmd,
         mr.released_at,
         mr.released_by,
         date_part('day', now() - mr.released_at)::int as days_outstanding,
         mr.note
    from public.materials_releases mr
   where mr.released_at is not null
     and btrim(coalesce(mr.receipt_ref, '')) = ''
   order by mr.released_at;

comment on view public.materials_open_releases is
  'Materials money that has actually left the account with no receipt filed against it. One row per tranche, oldest first, with days_outstanding. A row appearing here is not yet a problem: a worker who was paid this morning has not had time to reach the hardware store. A row that stays here is the problem, and it is the shape of materials money being spent on something else. Rows with released_at still null are excluded on purpose: those are planned, not paid.';

grant select on public.materials_open_releases to authenticated;

-- --------------------------------------------------------- per job roll-up

create or replace view public.materials_reconciliation
with (security_invoker = true) as
  select mr.job_id,
         count(*) filter (where mr.released_at is not null)                as tranches_paid,
         coalesce(sum(mr.amount_jmd) filter (where mr.released_at is not null), 0)
                                                                          as paid_jmd,
         count(*) filter (where mr.released_at is not null
                            and btrim(coalesce(mr.receipt_ref, '')) <> '') as tranches_receipted,
         coalesce(sum(mr.amount_jmd) filter (where mr.released_at is not null
                            and btrim(coalesce(mr.receipt_ref, '')) <> ''), 0)
                                                                          as receipted_jmd,
         count(*) filter (where mr.released_at is not null
                            and btrim(coalesce(mr.receipt_ref, '')) = '')  as tranches_open,
         coalesce(sum(mr.amount_jmd) filter (where mr.released_at is not null
                            and btrim(coalesce(mr.receipt_ref, '')) = ''), 0)
                                                                          as open_jmd,
         max(date_part('day', now() - mr.released_at)::int)
             filter (where mr.released_at is not null
                       and btrim(coalesce(mr.receipt_ref, '')) = '')       as oldest_open_days
    from public.materials_releases mr
   group by mr.job_id;

comment on view public.materials_reconciliation is
  'Per job: materials money paid out, how much of it has a receipt against it, and how old the oldest unreceipted tranche is. open_jmd is the number that matters, being money out of the account with nothing yet showing what it bought. Amounts are J$ throughout, matching materials_releases, because reconciling a Portmore hardware receipt against a converted figure is how disputes start.';

grant select on public.materials_reconciliation to authenticated;
