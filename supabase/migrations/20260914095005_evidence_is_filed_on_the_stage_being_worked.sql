-- Evidence is filed on the stage being worked, and on no other.
--
-- Founder, 14 Sep 2026: "they should be able to click on a stage and attach
-- the evidence to that stage, the other stages should be blacked out until
-- each stage is finished", and "stage one SHOULD NOT START UNTIL THE AGENCY
-- FEE IS PAID".
--
-- The job page now opens only the current stage for filing. That is a sign
-- on a door, not a lock: anybody signed in to the job can post straight to
-- the evidence table with any stage number they like. This is the lock.
--
--   * Before stage 1 (jobs.stage 0), nothing is filed. The job reaches
--     stage 1 when the Guarantee & Support invoice is paid
--     (start_job_on_agency_fee_paid). The insert policy already refuses
--     evidence while a job is awaiting_payment; this also covers a job at
--     stage 0 in any other status, such as one still open for quotes.
--   * From stage 1, only jobs.stage is accepted. A later stage is locked
--     until the ones before it are signed off, which happens only through
--     approve_stage(), a named client pressing Approve. A signed off stage
--     is closed. Nothing here moves a stage: this only refuses a filing.
--
-- Held to signed-in people only (request.jwt.claims role authenticated or
-- anon). Service role callers are Yaadly's own code: WhatsApp evidence in
-- yaad-inbound files against jobs.stage itself, and the job form's photos in
-- yaad-post-job are intake, not stage evidence. A signed-in admin is not held
-- to it either, so the desk can correct a misfiled item. Direct SQL has no
-- claims and is not held to it.
--
-- Insert only. Rows already filed are untouched, including historic ones on
-- a stage other than their job's current one.

create or replace function public.evidence_on_the_working_stage()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_role  text;
  v_stage integer;
begin
  v_role := coalesce(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role', '');
  if v_role not in ('authenticated', 'anon') then
    return new;
  end if;
  if public.is_admin() then
    return new;
  end if;

  select j.stage into v_stage from public.jobs j where j.id = new.job_id;
  if not found then
    -- No such job. The insert policy refuses it; nothing to say here.
    return new;
  end if;
  v_stage := coalesce(v_stage, 0);

  if v_stage < 1 then
    raise exception 'Stage 1 has not started on this job, so no evidence can be filed yet. It starts once the Guarantee & Support invoice is paid.'
      using errcode = 'check_violation';
  end if;

  if coalesce(new.stage, 1) > v_stage then
    raise exception 'Stage % is locked. Evidence goes on stage %, the stage being worked, and stage % opens once the stages before it are signed off.',
      coalesce(new.stage, 1), v_stage, coalesce(new.stage, 1)
      using errcode = 'check_violation';
  end if;

  if coalesce(new.stage, 1) < v_stage then
    raise exception 'Stage % is signed off and closed. Evidence goes on stage %, the stage being worked.',
      coalesce(new.stage, 1), v_stage
      using errcode = 'check_violation';
  end if;

  return new;
end
$function$;

revoke execute on function public.evidence_on_the_working_stage() from public, anon, authenticated;

drop trigger if exists trg_evidence_on_the_working_stage on public.evidence;
create trigger trg_evidence_on_the_working_stage
  before insert on public.evidence
  for each row execute function public.evidence_on_the_working_stage();

comment on function public.evidence_on_the_working_stage() is
  'Refuses a signed-in non-admin filing evidence before stage 1 or on any stage but jobs.stage. Stage 1 starts when the Guarantee & Support invoice is paid; each later stage opens when approve_stage() signs off the one before. Refuses only; never moves a stage. 20260914095005.';
