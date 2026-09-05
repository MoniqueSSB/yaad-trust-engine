-- A photograph says which section of the job it belongs to.
--
-- THE GAP THIS CLOSES. terms.html has promised, since it was written, that
-- every stage is documented with "arrival on site, before photographs,
-- materials receipts, after photographs, and a walk-round video at the end".
-- Four of those five are recorded. Before and after were not. 20260904t said
-- so in its own comment and left it alone deliberately:
--
--   "WHAT IS NOT MEASURED HERE, on purpose: whether there is a before and an
--    after. Nothing in the schema records that. The labels often say it in
--    free text and reading it out of them would be a guess dressed as a
--    check. If before-and-after is to be measured it needs a field that says
--    so, and that is a product decision, not a view."
--
-- This is that product decision. Founder instruction, 5 September 2026: the
-- site was ahead of the system on the one claim the business rests on, and the
-- system is the half that had to move.
--
-- FIVE SECTIONS, NOT TWO. Founder instruction the same day: a job is not only
-- a before and an after. There is the work in progress, there is the thing the
-- worker found when the tile came up that nobody knew about, and there are the
-- materials. So the sections a client reads are:
--
--   before     the state of it before anybody touched it
--   during     the work in progress
--   after      the state of it when the stage was finished
--   issue      a problem found on site: rot behind the panel, a pipe nobody
--              knew was there, the wall that was never square
--   materials  NOT a phase. Already its own thing on evidence.kind since
--              20260828c, because filing it is what moves the risk in the
--              materials to the client. It is a section on the page, read off
--              kind, and the constraint below refuses a phase on it.
--
-- An issue photograph is also, in a temporal sense, a during. The worker picks
-- the one that is most use to the person reading it, and finding a problem is
-- always the more useful of the two. before_and_after below counts only a
-- before and an after, so an issue never stands in for either.
--
-- DECLARED, NEVER SNIFFED. phase is set because a person answered a direct
-- question, in the portal or over WhatsApp. Nothing reads it out of the label.
-- Same reasoning as evidence.kind in 20260828c: a rule that turns on somebody
-- typing a particular word is not a rule. "Before I started I had to move the
-- tank" is a sentence about a before; it is not a declaration that this
-- photograph is one.
--
-- NULL IS AN HONEST ANSWER. It means nobody said, and it must not read as
-- "no". Every row filed before today is null, and a worker who does not answer
-- the question still gets their evidence filed. Nothing about this column
-- blocks anything: it records, it reports, and a named human still decides.
-- Whether a missing before ever becomes a gate on approval is a separate
-- decision and is the founder's, not this migration's.

alter table public.evidence
  add column if not exists phase text;

-- Materials evidence is the receipt, the photographs and the video of the
-- materials in the place the client nominated. It is a custody record, not a
-- stage of the work, so a phase on it means nothing and is refused rather than
-- quietly stored and later counted. It is its own section on the page, read
-- off kind.
alter table public.evidence drop constraint if exists evidence_phase_chk;
alter table public.evidence add constraint evidence_phase_chk
  check (
    phase is null
    or (phase in ('before', 'during', 'after', 'issue') and kind is distinct from 'materials')
  );

comment on column public.evidence.phase is
  'before, during, after or issue, declared by the person filing it in answer to a direct question, never read out of the label. Null means nobody said, which is not the same as no, and is what every row filed before 5 Sep 2026 carries. Refused on kind = materials, which is its own section and is read off kind instead.';

-- Reading a stage's evidence back grouped into its sections is the one query
-- the client portal runs on every job.
create index if not exists evidence_job_stage_phase_idx
  on public.evidence (job_id, stage, phase) where phase is not null;

-- ─────────────────────────────────────────────── the snapshot carries it too
--
-- Without this the column would be readable from public.evidence and the
-- sign-off measure would have to count rows again, which is the exact failure
-- 20260904t and supabase/tests/signoff_snapshot_guards.sql exist to prevent: a
-- before filed the day after an approval would improve the approval. phase
-- goes into the snapshot at approval time, alongside the sha256, and the
-- measure reads the snapshot.
--
-- Otherwise unchanged from 20260831v. Reproduced in full rather than patched
-- because CREATE OR REPLACE FUNCTION replaces the whole body.

create or replace function public._do_approve_stage(p_job text, p_email text, p_method text)
returns table(job_id text, stage integer, evidence_count integer, confirmed_method text)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  j record;
  v_stage integer;
  v_evidence jsonb;
  v_count integer;
  v_dispute_open boolean;
  v_method text := case when p_method in ('in_person', 'whatsapp') then p_method else 'evidence' end;
begin
  if p_email is null or p_email = '' then
    raise exception 'No email on record to approve as.' using errcode = '28000';
  end if;

  select * into j from public.jobs where id = p_job;
  if j.id is null then
    raise exception 'No such job.' using errcode = 'check_violation';
  end if;

  if lower(coalesce(j.client_email, '')) <> lower(p_email) then
    raise exception 'That is not your job to approve.' using errcode = '28000';
  end if;

  select exists (
    select 1 from public.disputes d
     where d.job_id = p_job and d.state <> 'resolved'
  ) into v_dispute_open;

  if v_dispute_open then
    raise exception 'A dispute is open on this job. Nothing can be approved while it is.'
      using errcode = 'check_violation';
  end if;

  v_stage := greatest(coalesce(j.stage, 0), 1);

  select jsonb_agg(
           jsonb_build_object(
             'id', e.id, 'sha256', e.sha256, 'label', e.label,
             'phase', e.phase, 'created_at', e.created_at
           )
           order by e.created_at
         ),
         count(*)
    into v_evidence, v_count
    from public.evidence e
   where e.job_id = p_job and coalesce(e.stage, 1) = v_stage;

  if coalesce(v_count, 0) = 0 then
    raise exception 'Nothing has been filed for this stage yet.' using errcode = 'check_violation';
  end if;

  insert into public.stage_approvals (job_id, stage, approved_by, evidence, confirmed_method)
  values (p_job, v_stage, lower(p_email), v_evidence, v_method);

  update public.jobs
     set stage = v_stage + 1,
         status = 'in_progress',
         updated_at = now()
   where id = p_job;

  return query select p_job, v_stage, v_count, v_method;
end;
$$;

revoke all on function public._do_approve_stage(text, text, text) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────── the measure reports it
--
-- New columns on the end only, so CREATE OR REPLACE keeps the existing shape
-- and everything already selecting from this view is untouched. Reported as
-- has_before and has_after separately as well as paired, because "no after" and
-- "no before" are different failures: no before is a photograph nobody took
-- before the work covered it over, and no after is a job that was never shown
-- finished. during and issue are reported separately again and neither counts
-- towards the pair.

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
    )                                                                     as flagged_far_from_site,
    -- Read from the snapshot, same as items and fingerprinted. A before
    -- declared on an evidence row after this approval does not appear here,
    -- which is the whole point of reading the snapshot at all.
    case when jsonb_typeof(sa.evidence) = 'array' then exists (
      select 1 from jsonb_array_elements(sa.evidence) e where e ->> 'phase' = 'before'
    ) else false end                                                      as has_before,
    case when jsonb_typeof(sa.evidence) = 'array' then exists (
      select 1 from jsonb_array_elements(sa.evidence) e where e ->> 'phase' = 'after'
    ) else false end                                                      as has_after,
    case when jsonb_typeof(sa.evidence) = 'array' then (
      exists (select 1 from jsonb_array_elements(sa.evidence) e where e ->> 'phase' = 'before')
      and exists (select 1 from jsonb_array_elements(sa.evidence) e where e ->> 'phase' = 'after')
    ) else false end                                                      as before_and_after,
    case when jsonb_typeof(sa.evidence) = 'array' then exists (
      select 1 from jsonb_array_elements(sa.evidence) e where e ->> 'phase' = 'during'
    ) else false end                                                      as has_during,
    -- Counted rather than flagged. One problem found on a stage is ordinary
    -- site work; four is a job that is not the job that was quoted, and the
    -- desk should be able to tell those apart at a glance.
    case when jsonb_typeof(sa.evidence) = 'array' then (
      select count(*) from jsonb_array_elements(sa.evidence) e where e ->> 'phase' = 'issue'
    ) else 0 end                                                          as issues
  from public.stage_approvals sa;

comment on view public.evidence_at_signoff is
  'One row per stage approval, describing what was on file at the moment a named human signed it off. Read from the stage_approvals.evidence snapshot rather than from the evidence table, so a photograph filed after the approval, or a phase declared after it, does not count towards it.';

grant select on public.evidence_at_signoff to authenticated;

create or replace view public.evidence_completeness
with (security_invoker = true) as
  select
    count(*)                                                    as signoffs,
    count(*) filter (where items > 0)                            as with_any_evidence,
    count(*) filter (where items > 0 and fingerprinted = items)  as fully_fingerprinted,
    count(*) filter (where arrival_logged)                       as with_arrival,
    count(*) filter (where located)                              as with_a_pin,
    count(*) filter (where flagged_far_from_site)                as flagged_far,
    round(avg(items), 1)                                         as avg_items,
    count(*) filter (where before_and_after)                     as with_before_and_after,
    count(*) filter (where has_before)                           as with_before,
    count(*) filter (where has_after)                            as with_after,
    count(*) filter (where has_during)                           as with_during,
    count(*) filter (where issues > 0)                           as with_issues,
    coalesce(sum(issues), 0)                                     as issues_raised
  from public.evidence_at_signoff;

comment on view public.evidence_completeness is
  'Evidence completeness at sign-off, all time. Reported as separate parts rather than one composite score, because the gaps have different causes and rolling them together hides which one is open. before-and-after reads near zero until 5 Sep 2026, when the field that records it was added: nothing before that date declared one either way.';

grant select on public.evidence_completeness to authenticated;
