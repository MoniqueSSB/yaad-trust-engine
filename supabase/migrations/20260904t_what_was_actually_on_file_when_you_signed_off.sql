-- What was actually on file when you signed off.
--
-- The system review asked for evidence completeness at sign-off and there was
-- no way to answer it. Counting evidence rows per job answers a different and
-- much weaker question, because a photograph filed the day after an approval
-- counts towards it just the same, and the whole point of the measure is what
-- the person had in front of them at the moment they decided.
--
-- stage_approvals.evidence already solves that. It is a snapshot written at
-- approval time: the evidence items as they stood, each with the sha256 of the
-- exact bytes. So this reads the snapshot rather than recounting the table,
-- and the number cannot improve retrospectively.
--
-- TWO SHAPES IN THAT COLUMN. Older desk approvals wrote {} and newer ones
-- write an array. jsonb_typeof sorts them; an object counts as zero items,
-- which is what it means.
--
-- THREE PARTS, REPORTED SEPARATELY, AND THAT IS DELIBERATE. A single
-- pass/fail composite would read near zero today and blame the workers for it,
-- when in fact the Arrival Log has only just become something a worker can do
-- from the phone in their hand (20260904h, the location pin lane). Rolling
-- three unrelated gaps into one percentage hides which one is actually open.
--
-- WHAT IS NOT MEASURED HERE, on purpose: whether there is a "before" and an
-- "after". Nothing in the schema records that. The labels often say it in
-- free text and reading it out of them would be a guess dressed as a check.
-- If before-and-after is to be measured it needs a field that says so, and
-- that is a product decision, not a view.

create or replace view public.evidence_at_signoff
with (security_invoker = true) as
  select
    sa.job_id,
    sa.stage,
    sa.approved_at,
    sa.approved_by,
    sa.confirmed_method,
    case when jsonb_typeof(sa.evidence) = 'array'
         then jsonb_array_length(sa.evidence) else 0 end                  as items,
    case when jsonb_typeof(sa.evidence) = 'array' then (
      select count(*) from jsonb_array_elements(sa.evidence) e
       where nullif(e ->> 'sha256', '') is not null
    ) else 0 end                                                          as fingerprinted,
    exists (
      select 1 from public.arrival_log a
       where a.job_id = sa.job_id and a.stage = sa.stage
         and a.arrived_at <= sa.approved_at
    )                                                                     as arrival_logged,
    (
      exists (
        select 1 from public.arrival_log a
         where a.job_id = sa.job_id and a.stage = sa.stage
           and a.arrived_at <= sa.approved_at and a.lat is not null
      )
      or exists (
        select 1 from public.work_log_pins w
         where w.job_id = sa.job_id and w.stage = sa.stage
           and w.shared_at <= sa.approved_at
      )
    )                                                                     as located,
    exists (
      select 1 from public.arrival_log a
       where a.job_id = sa.job_id and a.stage = sa.stage
         and a.arrived_at <= sa.approved_at and a.far_from_site is true
    )                                                                     as flagged_far_from_site
  from public.stage_approvals sa;

comment on view public.evidence_at_signoff is
  'One row per stage approval, describing what was on file at the moment a named human signed it off. Read from the stage_approvals.evidence snapshot rather than from the evidence table, so a photograph filed after the approval does not count towards it.';

grant select on public.evidence_at_signoff to authenticated;

-- The scoreboard version. All time rather than a 30 day window: approvals are
-- the rarest event in this system and a window would mostly measure how quiet
-- the month was.
create or replace view public.evidence_completeness
with (security_invoker = true) as
  select
    count(*)                                                    as signoffs,
    count(*) filter (where items > 0)                           as with_any_evidence,
    count(*) filter (where items > 0 and fingerprinted = items) as fully_fingerprinted,
    count(*) filter (where arrival_logged)                       as with_arrival,
    count(*) filter (where located)                              as with_a_pin,
    count(*) filter (where flagged_far_from_site)                as flagged_far,
    round(avg(items), 1)                                         as avg_items
  from public.evidence_at_signoff;

comment on view public.evidence_completeness is
  'Evidence completeness at sign-off, all time. Reported as separate parts rather than one composite score, because the three gaps have different causes and rolling them together hides which one is open.';

grant select on public.evidence_completeness to authenticated;
