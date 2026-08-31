-- A third way to confirm a stage, alongside approving from the evidence
-- package and the video walkthrough: a client who is physically in Jamaica
-- can inspect the work themselves and say so. Founder's own framing, 31 Aug
-- 2026: "if a client is in the country and can review the site by
-- themself... they just confirmed completed job by in-person visual so
-- that is signed out if there is any disputes in the future."
--
-- This is an ATTESTATION, not a bypass. Every other rule approve_stage()
-- already enforces stays exactly as strict: a dispute still blocks it, and
-- evidence still has to exist for the stage being approved. The human
-- confirmation gate this repository's own governing rule protects is the
-- client's tap; that never moves. What changes is that the tap now records
-- HOW the client is confirming, which is worth more in a dispute than a
-- bare approval: "I stood on the property and looked at it myself" is a
-- stronger record than "I approved," and there was previously no way to
-- tell the two apart on the same row.

alter table public.stage_approvals
  add column if not exists confirmed_method text not null default 'evidence';

alter table public.stage_approvals drop constraint if exists stage_approvals_confirmed_method_chk;
alter table public.stage_approvals add constraint stage_approvals_confirmed_method_chk
  check (confirmed_method in ('evidence', 'in_person'));

comment on column public.stage_approvals.confirmed_method is
  'evidence means the client approved reviewing the filed evidence remotely, the default and the original behaviour. in_person means the client attested to physically inspecting the work on the property themselves. Set once, at approval, immutable like every other column on this table: it is a record of what happened, not a setting.';

-- create or replace does not retire an existing narrower overload: Postgres
-- treats a second parameter, even with a default, as a distinct function
-- signature. Left alone, this migration would leave BOTH approve_stage(text)
-- and approve_stage(text, text) live at once, and a caller sending only
-- p_job would become genuinely ambiguous between them rather than cleanly
-- resolving to either. The one-argument version is dropped outright first
-- so there is exactly one approve_stage from here on.
drop function if exists public.approve_stage(text);

create or replace function public.approve_stage(p_job text, p_method text default 'evidence')
returns table(job_id text, stage integer, evidence_count integer, confirmed_method text)
language plpgsql
security definer
set search_path to 'public, auth'
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  j record;
  v_stage integer;
  v_evidence jsonb;
  v_count integer;
  v_dispute_open boolean;
  -- Anything that is not literally "in_person" is treated as the existing
  -- default. A caller sending garbage does not get a confusing rejection
  -- for a field that is attribution, not a gate; it just gets recorded
  -- honestly as the ordinary path.
  v_method text := case when p_method = 'in_person' then 'in_person' else 'evidence' end;
begin
  if v_uid is null then
    raise exception 'Not signed in.' using errcode = '28000';
  end if;

  select lower(btrim(u.email)) into v_email
    from auth.users u
   where u.id = v_uid and u.email_confirmed_at is not null;

  if v_email is null or v_email = '' then
    raise exception 'Confirm your email address first.' using errcode = '28000';
  end if;

  select * into j from public.jobs where id = p_job;
  if j.id is null then
    raise exception 'No such job.' using errcode = 'check_violation';
  end if;

  if lower(coalesce(j.client_email, '')) <> v_email then
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

  -- Unchanged: an in-person attestation still needs a filed record of the
  -- stage to attach itself to. Standing on the property is not instead of
  -- the evidence log, it is alongside it.
  select jsonb_agg(
           jsonb_build_object('id', e.id, 'sha256', e.sha256, 'label', e.label, 'created_at', e.created_at)
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
  values (p_job, v_stage, v_email, v_evidence, v_method);

  update public.jobs
     set stage = v_stage + 1,
         status = 'in_progress',
         updated_at = now()
   where id = p_job;

  return query select p_job, v_stage, v_count, v_method;
end;
$$;

-- Grants on a redefined function are dropped by CREATE OR REPLACE only if
-- the signature changes; it did (a second parameter with a default), so
-- they are reasserted rather than assumed carried over.
revoke all on function public.approve_stage(text, text) from public, anon, authenticated;
grant execute on function public.approve_stage(text, text) to authenticated;
