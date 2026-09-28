-- The worker signs the Completion Report with a button, on WhatsApp or in the
-- portal. Founder, 28 September 2026: "the worker always needs to sign off
-- first", "it has to be a button the work presses", "through whatsapp or the
-- portal".
--
-- Two doors, one core, the same shape as approve_stage and
-- approve_stage_via_whatsapp:
--
--   sign_completion_report(job, code, notes, account)   the portal button,
--       signed in, with the code from the link. The worker may change their
--       words first; pressing the button signs whatever is in the form.
--   sign_completion_report_via_whatsapp(job, phone)     the WhatsApp button,
--       whose tap arrives in yaad-inbound as the job's own code. The phone on
--       the worker's profile is the credential, as it is for every other
--       WhatsApp door. It signs the words exactly as they stand.
--
-- No typed name any more. The signature is the name on the worker's Yaadly
-- profile, falling back to the name on the job, recorded with how they signed.
-- Signing remains the only way a report can move towards a client: the
-- screen reads only worker_signed, release reads only held, and both of those
-- exist only after a signature.

create or replace function public._do_sign_completion_report(
  p_job text, p_email text, p_notes text[], p_account text, p_via text)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_rep     completion_reports%rowtype;
  v_job     jobs%rowtype;
  v_name    text;
  v_notes   text[];
  v_acct    text := nullif(btrim(coalesce(p_account,'')), '');
  v_changed boolean;
begin
  select * into v_job from jobs where id = p_job;
  select * into v_rep from completion_reports where job_id = p_job for update;
  if not found or v_rep.status <> 'with_worker' then
    raise exception 'This report is not waiting for your signature.' using errcode = 'check_violation';
  end if;
  if v_acct is not null and char_length(v_acct) > 2000 then
    raise exception 'Your account of the work is % characters. Keep it under 2,000.', char_length(v_acct)
      using errcode = 'check_violation';
  end if;
  select nullif(btrim(wp.name), '') into v_name
    from worker_profiles wp where lower(wp.worker_email) = lower(p_email) limit 1;
  v_name := coalesce(v_name, nullif(btrim(coalesce(v_job.worker_name,'')), ''));
  if v_name is null then
    raise exception 'There is no name on your Yaadly profile to sign with. Message Yaadly to add it.'
      using errcode = 'check_violation';
  end if;
  v_notes := public._clean_care_notes(p_notes);
  v_changed := v_notes is distinct from v_rep.care_notes or v_acct is distinct from v_rep.worker_account;

  update completion_reports set care_notes = v_notes, worker_account = v_acct,
         status = 'worker_signed', worker_signed_name = v_name, worker_signed_email = lower(p_email),
         worker_signed_at = now(), worker_changed = v_changed, updated_at = now()
   where job_id = p_job;
  insert into completion_report_events (job_id, rev, step, actor_email, actor_name, detail)
  values (p_job, v_rep.rev, 'signed', lower(p_email), v_name,
          jsonb_build_object('changed', v_changed, 'via', p_via,
            'before', jsonb_build_object('care_notes', to_jsonb(v_rep.care_notes), 'worker_account', v_rep.worker_account),
            'after',  jsonb_build_object('care_notes', to_jsonb(v_notes), 'worker_account', v_acct)));
  return v_changed;
end $$;
revoke execute on function public._do_sign_completion_report(text, text, text[], text, text) from public, anon, authenticated;

-- The portal button.
drop function if exists public.sign_completion_report(text, text, text, text[], text);
create or replace function public.sign_completion_report(
  p_job text, p_code text, p_care_notes text[], p_worker_account text default null)
returns table(worker_did_change boolean)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_rep   completion_reports%rowtype;
  v_job   jobs%rowtype;
  v_email text := lower(nullif(btrim(auth.jwt()->>'email'), ''));
begin
  if v_email is null then raise exception 'Sign in to sign this report.' using errcode = '28000'; end if;
  select * into v_job from jobs where id = p_job;
  if not found then raise exception 'No such job.' using errcode = 'check_violation'; end if;
  if lower(coalesce(v_job.worker_email,'')) <> v_email then
    raise exception 'Only the worker on this job can sign its report.' using errcode = '28000';
  end if;
  select * into v_rep from completion_reports where job_id = p_job;
  if not found or v_rep.status <> 'with_worker' then
    raise exception 'This report is not waiting for your signature.' using errcode = 'check_violation';
  end if;
  if v_rep.sign_code is null or upper(btrim(coalesce(p_code,''))) <> v_rep.sign_code then
    raise exception 'That link is out of date. Open the latest link from your WhatsApp.'
      using errcode = 'check_violation';
  end if;
  return query select public._do_sign_completion_report(p_job, v_email, p_care_notes, p_worker_account, 'portal');
end $$;
revoke execute on function public.sign_completion_report(text, text, text[], text) from public, anon;
grant  execute on function public.sign_completion_report(text, text, text[], text) to authenticated;

-- The WhatsApp button. Called by yaad-inbound with the service role, never by
-- a browser. Signs the words as they stand; changing them is the portal's job.
create or replace function public.sign_completion_report_via_whatsapp(p_job text, p_phone text)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_email text;
begin
  if length(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g')) < 9 then
    raise exception 'No usable phone number.';
  end if;
  select lower(j.worker_email) into v_email
    from jobs j
    join completion_reports r on r.job_id = j.id
    join worker_profiles wp on lower(wp.worker_email) = lower(j.worker_email)
   where j.id = p_job
     and r.status = 'with_worker'
     and public.same_phone(wp.phone, p_phone)
   limit 1;
  if v_email is null then
    raise exception 'No Completion Report on this job is waiting on your signature from this number.';
  end if;
  return public._do_sign_completion_report(
    p_job, v_email,
    (select care_notes from completion_reports where job_id = p_job),
    (select worker_account from completion_reports where job_id = p_job),
    'whatsapp');
end $$;
revoke execute on function public.sign_completion_report_via_whatsapp(text, text) from public, anon, authenticated;
grant  execute on function public.sign_completion_report_via_whatsapp(text, text) to service_role;
