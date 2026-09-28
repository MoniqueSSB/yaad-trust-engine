-- The Completion Report is the worker's document. Yaadly steps in only when
-- something goes wrong.
--
-- Founder, 28 September 2026, the same day 20260928200000 went live: "no i
-- dont edit it, it is the workers document, not mine to edit", then "i only
-- step in when things go wrong and a dispute is raised". Asked three
-- questions, she chose each recommended answer:
--
--   1 It starts on its own. When a job completes, yaad-completion-flow drafts
--     care notes and the report goes straight to the worker, who gets a
--     WhatsApp link.
--   2 When the worker signs, the words they signed are screened automatically
--     (the same banned-language list as both runtimes, plus money amounts).
--     Clean, it goes to the client. Flagged, it is held and Monique is alerted:
--     that counts as something going wrong.
--   3 The client's "Something is wrong or missing" raises a dispute on the
--     job, through the ordinary dispute path: the worker hears first, Monique
--     is alerted, and it can be escalated.
--
-- So the desk loses every way to write the words: save_completion_report and
-- accept_completion_report are dropped, and issue_completion_report becomes
-- release_completion_report, which only lets a HELD report go, unchanged.
-- What Monique keeps is the dispute tool: send it back to the worker with a
-- reason. They change their own words and sign again.
--
-- Against the governing rule. Nothing here moves money, rules on a dispute or
-- touches a reputation, and issuing a report is not in HUMAN_ONLY_DECISIONS.
-- A named human still confirms the words before any client reads them: the
-- worker, who signs them. The automatic step can only hold a report back,
-- never write or change one. The report says plainly that nobody at Yaadly
-- read it before it was sent, when that is what happened.

-- ── columns and states ────────────────────────────────────────────────────
alter table public.completion_reports
  add column if not exists hold_reason   text,
  add column if not exists return_reason text,
  add column if not exists returned_name text,
  add column if not exists returned_at   timestamptz,
  add column if not exists dispute_id    uuid;

alter table public.completion_reports drop constraint if exists completion_reports_status_check;
alter table public.completion_reports add constraint completion_reports_status_check
  check (status in ('draft','with_worker','worker_signed','held','issued'));

alter table public.completion_report_events drop constraint if exists completion_report_events_step_check;
alter table public.completion_report_events add constraint completion_report_events_step_check
  check (step in ('drafted','edited','accepted','sent_to_worker','signed','held','released','issued',
                  'returned','client_confirmed','client_flagged'));

-- The worker sees a report sent back to them; the client never sees a held one.
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
        or (r.status in ('with_worker','worker_signed','held','issued')
          and lower(coalesce(j.worker_email,'')) = lower(auth.jwt()->>'email'))
      )
  );
$$;

-- ── the desk no longer writes the words ───────────────────────────────────
drop function if exists public.save_completion_report(text, text[], text, text);
drop function if exists public.accept_completion_report(text, text);
drop function if exists public.issue_completion_report(text, text);

-- ── 1. it starts on its own ───────────────────────────────────────────────
-- Called by yaad-completion-flow with the service role, never by a browser.
-- Idempotent: a second call for the same job does nothing. Care notes may be
-- empty, when the drafter was down: the worker writes their own.
create or replace function public._start_completion_report(p_job text, p_notes text[], p_model text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_job  jobs%rowtype;
  v_code text := upper(substring(encode(extensions.gen_random_bytes(4), 'hex') from 1 for 6));
  v_notes text[];
begin
  select * into v_job from jobs where id = p_job;
  if not found or v_job.status <> 'complete' then return 'not_complete'; end if;
  if nullif(btrim(coalesce(v_job.worker_email,'')), '') is null then return 'no_worker'; end if;
  if exists (select 1 from completion_reports where job_id = p_job) then return 'exists'; end if;
  v_notes := public._clean_care_notes(p_notes);

  insert into completion_reports (job_id, status, care_notes, drafted_model, drafted_at, sign_code)
  values (p_job, 'with_worker', v_notes, p_model, case when p_model is not null then now() end, v_code);
  if p_model is not null then
    insert into completion_report_events (job_id, rev, step, actor_name, detail)
    values (p_job, 1, 'drafted', 'Drafting agent (a draft only)',
            jsonb_build_object('care_notes', to_jsonb(v_notes), 'model', p_model));
  end if;
  insert into completion_report_events (job_id, rev, step, actor_name)
  values (p_job, 1, 'sent_to_worker', 'Yaadly (automatic)');
  return 'started';
end $$;
revoke execute on function public._start_completion_report(text, text[], text) from public, anon, authenticated;
grant  execute on function public._start_completion_report(text, text[], text) to service_role;

-- ── 2. the automatic screen, which can only hold ──────────────────────────
-- p_findings is what the screen found: an empty array means clean. The
-- revision must match, so a screen that finishes after the report was sent
-- back cannot release the old wording.
create or replace function public._screen_completion_report(p_job text, p_rev int, p_findings jsonb)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_rep completion_reports%rowtype;
  v_n   int := coalesce(jsonb_array_length(p_findings), 0);
begin
  select * into v_rep from completion_reports where job_id = p_job for update;
  if not found or v_rep.status <> 'worker_signed' or v_rep.rev <> p_rev then return 'not_waiting'; end if;
  if v_n = 0 then
    update completion_reports set status = 'issued', issued_by = null, issued_name = null,
           issued_at = now(), hold_reason = null, updated_at = now()
     where job_id = p_job;
    insert into completion_report_events (job_id, rev, step, actor_name, detail)
    values (p_job, v_rep.rev, 'released', 'Automatic screen', jsonb_build_object('findings', '[]'::jsonb));
    return 'issued';
  end if;
  update completion_reports set status = 'held',
         hold_reason = left((select string_agg(x->>'text', '; ') from jsonb_array_elements(p_findings) x), 500),
         updated_at = now()
   where job_id = p_job;
  insert into completion_report_events (job_id, rev, step, actor_name, detail)
  values (p_job, v_rep.rev, 'held', 'Automatic screen', jsonb_build_object('findings', p_findings));
  return 'held';
end $$;
revoke execute on function public._screen_completion_report(text, int, jsonb) from public, anon, authenticated;
grant  execute on function public._screen_completion_report(text, int, jsonb) to service_role;

-- ── Monique, when something has gone wrong ────────────────────────────────
-- A held report she has read and is content with goes out unchanged, under
-- her name. She cannot change a word of it.
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
    raise exception 'Your name. A held report is released by a named person.' using errcode = 'check_violation';
  end if;
  select * into v_rep from completion_reports where job_id = p_job for update;
  if not found or v_rep.status <> 'held' then
    raise exception 'Only a held report can be released. This one is %.',
      coalesce(replace(v_rep.status,'_',' '), 'not started') using errcode = 'check_violation';
  end if;
  update completion_reports set status = 'issued', issued_by = v_email, issued_name = v_name,
         issued_at = now(), updated_at = now()
   where job_id = p_job;
  insert into completion_report_events (job_id, rev, step, actor_email, actor_name, detail)
  values (p_job, v_rep.rev, 'released', v_email, v_name, jsonb_build_object('was_held_for', v_rep.hold_reason));
end $$;

-- Sent back to the worker with her reason: a new revision, a new code, the
-- signature and the issue cleared. The client stops seeing it until the
-- worker signs again and it passes the screen.
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
    raise exception 'Your name. A report is sent back by a named person.' using errcode = 'check_violation';
  end if;
  if v_reason is null or char_length(v_reason) < 10 then
    raise exception 'Say what the worker needs to change. They read this.' using errcode = 'check_violation';
  end if;
  select * into v_rep from completion_reports where job_id = p_job for update;
  if not found or v_rep.status not in ('worker_signed','held','issued') then
    raise exception 'Only a signed report can be sent back.' using errcode = 'check_violation';
  end if;
  update completion_reports set rev = v_rep.rev + 1, status = 'with_worker', sign_code = v_code,
         return_reason = left(v_reason, 1000), returned_name = v_name, returned_at = now(),
         worker_signed_name = null, worker_signed_email = null, worker_signed_at = null, worker_changed = null,
         hold_reason = null, issued_by = null, issued_name = null, issued_at = null,
         client_confirmed_at = null, updated_at = now()
   where job_id = p_job;
  insert into completion_report_events (job_id, rev, step, actor_email, actor_name, detail)
  values (p_job, v_rep.rev + 1, 'returned', v_email, v_name,
          jsonb_build_object('reason', v_reason, 'was', v_rep.status));
  return v_code;
end $$;

revoke execute on function public.release_completion_report(text, text) from public, anon;
revoke execute on function public.return_completion_report(text, text, text) from public, anon;
grant  execute on function public.release_completion_report(text, text) to authenticated;
grant  execute on function public.return_completion_report(text, text, text) to authenticated;

-- ── 3. the client's flag is a dispute ─────────────────────────────────────
-- Through the ordinary dispute row, so its own triggers tell the worker first
-- and alert Monique, exactly as for any other dispute. The body arrives
-- already scrubbed of contact details by the portal, as raiseDispute does.
create or replace function public.flag_completion_report(p_job text, p_body text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_rep   completion_reports%rowtype;
  v_job   jobs%rowtype;
  v_email text := lower(nullif(btrim(auth.jwt()->>'email'), ''));
  v_body  text := btrim(coalesce(p_body,''));
  v_id    uuid;
begin
  if v_email is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  select * into v_job from jobs where id = p_job;
  if not found or lower(coalesce(v_job.client_email,'')) <> v_email then
    raise exception 'Only the client on this job can raise a point on its report.' using errcode = '28000';
  end if;
  select * into v_rep from completion_reports where job_id = p_job for update;
  if not found or v_rep.status <> 'issued' then
    raise exception 'This report has not been issued.' using errcode = 'check_violation';
  end if;
  if char_length(v_body) < 5 or char_length(v_body) > 1900 then
    raise exception 'Say what is wrong or missing, in a sentence or two.' using errcode = 'check_violation';
  end if;
  insert into disputes (job_id, raised_by, kinds, body, state)
  values (p_job, v_email, '["The Completion Report"]'::jsonb, 'About the Completion Report: ' || v_body, 'direct')
  returning id into v_id;
  update completion_reports set client_flag = v_body, client_flagged_at = now(), dispute_id = v_id, updated_at = now()
   where job_id = p_job;
  insert into completion_report_events (job_id, rev, step, actor_email, actor_name, detail)
  values (p_job, v_rep.rev, 'client_flagged', v_email, v_job.client_name,
          jsonb_build_object('body', v_body, 'dispute_id', v_id));
end $$;

-- ── the wiring: who is told, and when ─────────────────────────────────────
-- A job completing starts the report. Its own trigger, rather than a line in
-- notify_client_on_job_change, so the job's existing messages are untouched.
create or replace function public.start_completion_report_on_complete()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.status = 'complete' and coalesce(old.status, '') is distinct from 'complete' then
    perform net.http_post(
      url := 'https://leffyisvfvjwzilydlwf.supabase.co/functions/v1/yaad-completion-flow',
      body := jsonb_build_object('secret', public.notify_trigger_secret(), 'jobId', new.id, 'step', 'start'),
      headers := jsonb_build_object('Content-Type','application/json','apikey','sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz','Authorization','Bearer '||'sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz'),
      timeout_milliseconds := 15000
    );
  end if;
  return new;
end $$;
revoke all on function public.start_completion_report_on_complete() from public, anon, authenticated;

drop trigger if exists trg_start_completion_report on public.jobs;
create trigger trg_start_completion_report
  after update of status on public.jobs
  for each row execute function public.start_completion_report_on_complete();

-- The report moving tells the next person. Only on a real change of state or
-- revision, so an unrelated update never sends anything twice.
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
  elsif new.status = 'held' then
    perform net.http_post(url := v_url || 'yaad-notify-client',
      body := jsonb_build_object('secret', public.notify_trigger_secret(), 'jobId', new.job_id,
        'kind', 'desk_alert', 'meta', jsonb_build_object('event', 'report_held')),
      headers := v_hdr, timeout_milliseconds := 15000);
  end if;
  return new;
end $$;
revoke all on function public.notify_completion_report_moved() from public, anon, authenticated;

drop trigger if exists trg_notify_completion_report_moved on public.completion_reports;
create trigger trg_notify_completion_report_moved
  after insert or update of status, rev on public.completion_reports
  for each row execute function public.notify_completion_report_moved();

-- ── the desk's list, with the new columns ─────────────────────────────────
drop view if exists public.v_completion_reports;
create view public.v_completion_reports
with (security_invoker = true) as
select j.id, j.title, j.parish, j.trade, j.client_name, j.worker_name, j.updated_at as job_updated_at,
       coalesce(r.status, 'not_started') as report_status,
       r.rev, r.care_notes, r.worker_account, r.drafted_model, r.drafted_at, r.sign_code,
       r.worker_signed_name, r.worker_signed_at, r.worker_changed,
       r.hold_reason, r.return_reason, r.returned_name, r.returned_at,
       r.issued_name, r.issued_at, r.client_confirmed_at, r.client_flag, r.client_flagged_at, r.dispute_id,
       coalesce(j.is_test, false) as is_test
  from public.jobs j
  left join public.completion_reports r on r.job_id = j.id
 where j.status = 'complete';
revoke all on public.v_completion_reports from anon;
grant select on public.v_completion_reports to authenticated;
