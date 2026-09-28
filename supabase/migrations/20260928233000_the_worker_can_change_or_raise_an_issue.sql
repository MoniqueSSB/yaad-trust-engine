-- Before signing, the worker can change their words or raise an issue, with a
-- button, on WhatsApp or from the link, with no login.
--
-- Founder, 28 September 2026, after signing the test report from her phone:
-- "the only issue is there is no way to edit", "or raise and issue", "on
-- whatsapp or portal", "fix that", "it should be a button". Asked how, she
-- chose both a WhatsApp route and a link that opens without signing in.
--
-- Three doors to the same three acts (change the words, sign, raise):
--   portal     signed in as the job's worker, with the link's code
--   link       no login: the code in the WhatsApp link IS the key. It is six
--              hex characters and changes every revision, and ten wrong codes
--              on one job lock the link until Yaadly sends the report back
--              (which makes a new code). Refused outside with_worker.
--   WhatsApp   the phone on the worker's profile, as for every WhatsApp door.
--              Change my words replaces their own account of the work, and
--              leaves it unsigned: they still press Sign.
--
-- Raising an issue stops the report where it is ('worker_raised') and alerts
-- Monique. That is the "something went wrong" she steps in on. It is NOT
-- signed, so it can never be released unchanged: release_completion_report
-- now requires a signature. Her only move is to send it back with her answer,
-- which gives the worker a new code, and they sign when it is right.

alter table public.completion_reports
  add column if not exists worker_issue    text,
  add column if not exists worker_issue_at timestamptz,
  add column if not exists code_failures   int not null default 0;

alter table public.completion_reports drop constraint if exists completion_reports_status_check;
alter table public.completion_reports add constraint completion_reports_status_check
  check (status in ('draft','with_worker','worker_signed','held','worker_raised','issued'));

alter table public.completion_report_events drop constraint if exists completion_report_events_step_check;
alter table public.completion_report_events add constraint completion_report_events_step_check
  check (step in ('drafted','edited','accepted','sent_to_worker','signed','held','released','issued',
                  'returned','client_confirmed','client_flagged','worker_edited','worker_raised'));

create or replace function public._completion_report_visible(p_job text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select public.is_admin() or exists (
    select 1 from public.completion_reports r
    join public.jobs j on j.id = r.job_id
    where r.job_id = p_job
      and nullif(btrim(lower(auth.jwt()->>'email')), '') is not null
      and (
        (r.status = 'issued'
          and lower(coalesce(j.client_email,'')) = lower(auth.jwt()->>'email'))
        or (r.status in ('with_worker','worker_signed','held','worker_raised','issued')
          and lower(coalesce(j.worker_email,'')) = lower(auth.jwt()->>'email'))
      )
  );
$$;

-- ── the cores, shared by every door ───────────────────────────────────────
create or replace function public._do_edit_completion_report(p_job text, p_email text, p_notes text[], p_account text, p_via text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_rep  completion_reports%rowtype;
  v_acct text := nullif(btrim(coalesce(p_account,'')), '');
  v_notes text[];
begin
  select * into v_rep from completion_reports where job_id = p_job for update;
  if not found or v_rep.status <> 'with_worker' then
    raise exception 'This report is not open for changes.' using errcode = 'check_violation';
  end if;
  if v_acct is not null and char_length(v_acct) > 2000 then
    raise exception 'Your account of the work is % characters. Keep it under 2,000.', char_length(v_acct)
      using errcode = 'check_violation';
  end if;
  v_notes := case when p_notes is null then v_rep.care_notes else public._clean_care_notes(p_notes) end;
  update completion_reports set care_notes = v_notes, worker_account = v_acct, updated_at = now() where job_id = p_job;
  insert into completion_report_events (job_id, rev, step, actor_email, actor_name, detail)
  values (p_job, v_rep.rev, 'worker_edited', lower(p_email),
          (select nullif(btrim(wp.name),'') from worker_profiles wp where lower(wp.worker_email)=lower(p_email) limit 1),
          jsonb_build_object('via', p_via,
            'before', jsonb_build_object('care_notes', to_jsonb(v_rep.care_notes), 'worker_account', v_rep.worker_account),
            'after',  jsonb_build_object('care_notes', to_jsonb(v_notes), 'worker_account', v_acct)));
end $$;
revoke execute on function public._do_edit_completion_report(text, text, text[], text, text) from public, anon, authenticated;

create or replace function public._do_raise_completion_issue(p_job text, p_email text, p_body text, p_via text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_rep  completion_reports%rowtype;
  v_body text := btrim(coalesce(p_body,''));
  v_name text;
begin
  select * into v_rep from completion_reports where job_id = p_job for update;
  if not found or v_rep.status <> 'with_worker' then
    raise exception 'This report is not waiting on you.' using errcode = 'check_violation';
  end if;
  if char_length(v_body) < 5 or char_length(v_body) > 1500 then
    raise exception 'Say what is wrong, in a sentence or two.' using errcode = 'check_violation';
  end if;
  select nullif(btrim(wp.name),'') into v_name from worker_profiles wp where lower(wp.worker_email)=lower(p_email) limit 1;
  update completion_reports set status = 'worker_raised', worker_issue = v_body, worker_issue_at = now(), updated_at = now()
   where job_id = p_job;
  insert into completion_report_events (job_id, rev, step, actor_email, actor_name, detail)
  values (p_job, v_rep.rev, 'worker_raised', lower(p_email), v_name, jsonb_build_object('via', p_via, 'body', v_body));
end $$;
revoke execute on function public._do_raise_completion_issue(text, text, text, text) from public, anon, authenticated;

-- ── portal, signed in ─────────────────────────────────────────────────────
create or replace function public.raise_completion_issue(p_job text, p_code text, p_body text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_job   jobs%rowtype;
  v_rep   completion_reports%rowtype;
  v_email text := lower(nullif(btrim(auth.jwt()->>'email'), ''));
begin
  if v_email is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  select * into v_job from jobs where id = p_job;
  if not found or lower(coalesce(v_job.worker_email,'')) <> v_email then
    raise exception 'Only the worker on this job can raise an issue on its report.' using errcode = '28000';
  end if;
  select * into v_rep from completion_reports where job_id = p_job;
  if v_rep.sign_code is null or upper(btrim(coalesce(p_code,''))) <> v_rep.sign_code then
    raise exception 'That link is out of date. Open the latest link from your WhatsApp.' using errcode = 'check_violation';
  end if;
  perform public._do_raise_completion_issue(p_job, v_email, p_body, 'portal');
end $$;
revoke execute on function public.raise_completion_issue(text, text, text) from public, anon;
grant  execute on function public.raise_completion_issue(text, text, text) to authenticated;

-- ── the link, no login ────────────────────────────────────────────────────
-- One check for every link door. A wrong code counts and ten lock the link.
-- It returns null rather than raising, because a raised error rolls the whole
-- call back, the failure count with it, and the lock would never close. The
-- public doors turn null into a refusal the page can show.
create or replace function public._completion_code_check(p_job text, p_code text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_rep completion_reports%rowtype;
begin
  select * into v_rep from completion_reports where job_id = p_job for update;
  if not found or v_rep.code_failures >= 10 then return null; end if;
  if v_rep.sign_code is null or upper(btrim(coalesce(p_code,''))) <> v_rep.sign_code then
    update completion_reports set code_failures = code_failures + 1 where job_id = p_job;
    return null;
  end if;
  return (select lower(worker_email) from jobs where id = p_job);
end $$;
revoke execute on function public._completion_code_check(text, text) from public, anon, authenticated;

create or replace function public._completion_code_refusal(p_job text)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select jsonb_build_object('error', case
    when (select code_failures from completion_reports where job_id = p_job) >= 10
      then 'This link is locked after too many wrong tries. Message Yaadly for a new one.'
    else 'That link is not valid, or it is out of date. Open the latest link from your WhatsApp.' end);
$$;
revoke execute on function public._completion_code_refusal(text) from public, anon, authenticated;

-- What the link page shows: the words to sign, and a plain summary of the
-- facts from the record, so the worker sees what they are signing. The
-- owner's first name only; no address, no contact details, no money.
create or replace function public.completion_report_for_code(p_job text, p_code text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_rep completion_reports%rowtype;
  v_job jobs%rowtype;
begin
  if public._completion_code_check(p_job, p_code) is null then return public._completion_code_refusal(p_job); end if;
  select * into v_rep from completion_reports where job_id = p_job;
  select * into v_job from jobs where id = p_job;
  return jsonb_build_object(
    'job', jsonb_build_object('id', v_job.id, 'title', v_job.title, 'parish', v_job.parish, 'trade', v_job.trade,
                              'worker_name', v_job.worker_name, 'descr', v_job.descr,
                              'owner_first', split_part(coalesce(v_job.client_name,''), ' ', 1)),
    'report', jsonb_build_object('status', v_rep.status, 'rev', v_rep.rev, 'care_notes', to_jsonb(v_rep.care_notes),
                                 'worker_account', v_rep.worker_account, 'return_reason', v_rep.return_reason,
                                 'worker_issue', v_rep.worker_issue, 'worker_signed_at', v_rep.worker_signed_at),
    'stages', coalesce((select jsonb_agg(jsonb_build_object('stage', a.stage, 'approved_at', a.approved_at, 'method', a.confirmed_method) order by a.stage)
                          from stage_approvals a where a.job_id = p_job), '[]'::jsonb),
    'arrivals', coalesce((select jsonb_agg(jsonb_build_object('stage', l.stage, 'at', l.arrived_at, 'far', l.far_from_site) order by l.arrived_at)
                            from arrival_log l where l.job_id = p_job), '[]'::jsonb),
    'evidence', coalesce((select jsonb_agg(jsonb_build_object('label', e.label, 'phase', e.phase, 'kind', e.kind, 'stage', e.stage, 'at', coalesce(e.captured_at, e.created_at)) order by e.created_at)
                            from evidence e where e.job_id = p_job), '[]'::jsonb)
  );
end $$;

create or replace function public.edit_completion_report_by_code(p_job text, p_code text, p_care_notes text[], p_worker_account text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_email text := public._completion_code_check(p_job, p_code);
begin
  if v_email is null then return public._completion_code_refusal(p_job); end if;
  perform public._do_edit_completion_report(p_job, v_email, p_care_notes, p_worker_account, 'link');
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.sign_completion_report_by_code(p_job text, p_code text, p_care_notes text[], p_worker_account text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_email text := public._completion_code_check(p_job, p_code);
begin
  if v_email is null then return public._completion_code_refusal(p_job); end if;
  return jsonb_build_object('ok', true,
    'changed', public._do_sign_completion_report(p_job, v_email, p_care_notes, p_worker_account, 'link'));
end $$;

create or replace function public.raise_completion_issue_by_code(p_job text, p_code text, p_body text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_email text := public._completion_code_check(p_job, p_code);
begin
  if v_email is null then return public._completion_code_refusal(p_job); end if;
  perform public._do_raise_completion_issue(p_job, v_email, p_body, 'link');
  return jsonb_build_object('ok', true);
end $$;

revoke execute on function public.completion_report_for_code(text, text) from public;
revoke execute on function public.edit_completion_report_by_code(text, text, text[], text) from public;
revoke execute on function public.sign_completion_report_by_code(text, text, text[], text) from public;
revoke execute on function public.raise_completion_issue_by_code(text, text, text) from public;
grant execute on function public.completion_report_for_code(text, text) to anon, authenticated;
grant execute on function public.edit_completion_report_by_code(text, text, text[], text) to anon, authenticated;
grant execute on function public.sign_completion_report_by_code(text, text, text[], text) to anon, authenticated;
grant execute on function public.raise_completion_issue_by_code(text, text, text) to anon, authenticated;

-- ── WhatsApp ──────────────────────────────────────────────────────────────
-- The worker on this job, found by the phone on their profile, only while the
-- report is waiting on them. Service role only, called by yaad-inbound.
create or replace function public._completion_worker_by_phone(p_job text, p_phone text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_email text;
begin
  if length(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g')) < 9 then
    raise exception 'No usable phone number.';
  end if;
  select lower(j.worker_email) into v_email
    from jobs j
    join completion_reports r on r.job_id = j.id
    join worker_profiles wp on lower(wp.worker_email) = lower(j.worker_email)
   where j.id = p_job and r.status = 'with_worker' and public.same_phone(wp.phone, p_phone)
   limit 1;
  if v_email is null then
    raise exception 'No Completion Report on this job is waiting on you from this number.';
  end if;
  return v_email;
end $$;
revoke execute on function public._completion_worker_by_phone(text, text) from public, anon, authenticated;

create or replace function public.edit_completion_account_via_whatsapp(p_job text, p_phone text, p_account text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform public._do_edit_completion_report(p_job, public._completion_worker_by_phone(p_job, p_phone), null, p_account, 'whatsapp');
end $$;

create or replace function public.raise_completion_issue_via_whatsapp(p_job text, p_phone text, p_body text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform public._do_raise_completion_issue(p_job, public._completion_worker_by_phone(p_job, p_phone), p_body, 'whatsapp');
end $$;
revoke execute on function public.edit_completion_account_via_whatsapp(text, text, text) from public, anon, authenticated;
revoke execute on function public.raise_completion_issue_via_whatsapp(text, text, text) from public, anon, authenticated;
grant  execute on function public.edit_completion_account_via_whatsapp(text, text, text) to service_role;
grant  execute on function public.raise_completion_issue_via_whatsapp(text, text, text) to service_role;

-- Which button a worker tapped, waiting for the words they type next.
-- Service role only; one row per phone; two hours to answer.
create table if not exists public.completion_report_whatsapp_pending (
  phone      text primary key,
  job_id     text not null references public.jobs(id),
  kind       text not null check (kind in ('edit','issue')),
  started_at timestamptz not null default now()
);
alter table public.completion_report_whatsapp_pending enable row level security;
drop policy if exists "admin reads completion whatsapp pending" on public.completion_report_whatsapp_pending;
create policy "admin reads completion whatsapp pending" on public.completion_report_whatsapp_pending
  for select using (public.is_admin());
revoke all on public.completion_report_whatsapp_pending from anon, authenticated;
grant select on public.completion_report_whatsapp_pending to authenticated;

-- ── Monique's side ────────────────────────────────────────────────────────
-- Release now needs a signature: a worker's raised issue is not signed, so it
-- can only be answered by sending the report back.
create or replace function public.release_completion_report(p_job text, p_name text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_rep   completion_reports%rowtype;
  v_email text := lower(nullif(btrim(auth.jwt()->>'email'), ''));
  v_name  text := nullif(btrim(coalesce(p_name,'')), '');
begin
  if not public.is_admin() then raise exception 'Admin only.' using errcode = '28000'; end if;
  if v_name is null or char_length(v_name) < 3 then
    raise exception 'Your name, for Yaadly''s own record.' using errcode = 'check_violation';
  end if;
  select * into v_rep from completion_reports where job_id = p_job for update;
  if not found or v_rep.status <> 'held' or v_rep.worker_signed_at is null then
    raise exception 'Only a held report the worker has signed can be released.' using errcode = 'check_violation';
  end if;
  update completion_reports set status = 'issued', issued_by = v_email, issued_name = v_name,
         issued_at = now(), updated_at = now()
   where job_id = p_job;
  insert into completion_report_events (job_id, rev, step, actor_email, actor_name, detail)
  values (p_job, v_rep.rev, 'released', v_email, v_name, jsonb_build_object('was_held_for', v_rep.hold_reason));
end $$;

-- Sending back now also answers a raised issue, and resets the link lock.
create or replace function public.return_completion_report(p_job text, p_reason text, p_name text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_rep    completion_reports%rowtype;
  v_email  text := lower(nullif(btrim(auth.jwt()->>'email'), ''));
  v_name   text := nullif(btrim(coalesce(p_name,'')), '');
  v_reason text := nullif(btrim(coalesce(p_reason,'')), '');
  v_code   text := upper(substring(encode(extensions.gen_random_bytes(4), 'hex') from 1 for 6));
begin
  if not public.is_admin() then raise exception 'Admin only.' using errcode = '28000'; end if;
  if v_name is null or char_length(v_name) < 3 then
    raise exception 'Your name, for Yaadly''s own record.' using errcode = 'check_violation';
  end if;
  if v_reason is null or char_length(v_reason) < 10 then
    raise exception 'Say what the worker needs to change. They read this.' using errcode = 'check_violation';
  end if;
  select * into v_rep from completion_reports where job_id = p_job for update;
  if not found or v_rep.status not in ('worker_signed','held','worker_raised','issued') then
    raise exception 'Only a signed report, or one the worker raised an issue on, can be sent back.' using errcode = 'check_violation';
  end if;
  update completion_reports set rev = v_rep.rev + 1, status = 'with_worker', sign_code = v_code, code_failures = 0,
         return_reason = left(v_reason, 1000), returned_name = v_name, returned_at = now(),
         worker_signed_name = null, worker_signed_email = null, worker_signed_at = null, worker_changed = null,
         hold_reason = null, issued_by = null, issued_name = null, issued_at = null,
         client_confirmed_at = null, updated_at = now()
   where job_id = p_job;
  insert into completion_report_events (job_id, rev, step, actor_email, actor_name, detail)
  values (p_job, v_rep.rev + 1, 'returned', v_email, v_name,
          jsonb_build_object('reason', v_reason, 'was', v_rep.status, 'answering', v_rep.worker_issue));
  return v_code;
end $$;

-- A worker raising an issue alerts Monique.
create or replace function public.notify_completion_report_moved()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_url  text := 'https://leffyisvfvjwzilydlwf.supabase.co/functions/v1/';
  v_hdr  jsonb := jsonb_build_object('Content-Type','application/json','apikey','sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz','Authorization','Bearer '||'sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz');
begin
  if tg_op = 'UPDATE' and new.status = old.status and new.rev = old.rev then return new; end if;

  if new.status = 'with_worker' then
    perform net.http_post(url := v_url || 'yaad-notify-client',
      body := jsonb_build_object('secret', public.notify_trigger_secret(), 'jobId', new.job_id, 'kind', 'completion_report_worker'),
      headers := v_hdr, timeout_milliseconds := 15000);
  elsif new.status = 'worker_signed' then
    perform net.http_post(url := v_url || 'yaad-completion-flow',
      body := jsonb_build_object('secret', public.notify_trigger_secret(), 'jobId', new.job_id, 'step', 'screen'),
      headers := v_hdr, timeout_milliseconds := 15000);
  elsif new.status = 'issued' then
    perform net.http_post(url := v_url || 'yaad-notify-client',
      body := jsonb_build_object('secret', public.notify_trigger_secret(), 'jobId', new.job_id, 'kind', 'completion_report_issued'),
      headers := v_hdr, timeout_milliseconds := 15000);
  elsif new.status in ('held','worker_raised') then
    perform net.http_post(url := v_url || 'yaad-notify-client',
      body := jsonb_build_object('secret', public.notify_trigger_secret(), 'jobId', new.job_id,
        'kind', 'desk_alert', 'meta', jsonb_build_object('event', case when new.status = 'held' then 'report_held' else 'report_worker_raised' end)),
      headers := v_hdr, timeout_milliseconds := 15000);
  end if;
  return new;
end $$;

drop view if exists public.v_completion_reports;
create view public.v_completion_reports
with (security_invoker = true) as
select j.id, j.title, j.parish, j.trade, j.client_name, j.worker_name, j.updated_at as job_updated_at,
       coalesce(r.status, 'not_started') as report_status,
       r.rev, r.care_notes, r.worker_account, r.drafted_model, r.drafted_at, r.sign_code,
       r.worker_signed_name, r.worker_signed_at, r.worker_changed,
       r.hold_reason, r.worker_issue, r.worker_issue_at, r.return_reason, r.returned_name, r.returned_at,
       r.issued_name, r.issued_at, r.client_confirmed_at, r.client_flag, r.client_flagged_at, r.dispute_id,
       coalesce(j.is_test, false) as is_test
  from public.jobs j
  left join public.completion_reports r on r.job_id = j.id
 where j.status = 'complete';
revoke all on public.v_completion_reports from anon;
grant select on public.v_completion_reports to authenticated;
