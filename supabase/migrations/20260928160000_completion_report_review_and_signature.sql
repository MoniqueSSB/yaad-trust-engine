-- The Completion Report gets a review trail and a worker's signature.
--
-- Founder decision, 28 September 2026, after a clickable preview and a sweep of
-- twenty two comparable documents (JCT and NEC completion certificates, the
-- RICS Level 3 survey, snagging reports, the IET minor works certificate,
-- Checkatrade and TrustMark guarantees, Jobber, Housecall Pro, Fixflo). Nearly
-- every one of them ends on a named person signing. Ours ended on nobody: the
-- report appeared at /portal/jobs/[id]/completion the moment
-- sync_job_status() marked the job complete, although PORTAL-SPEC.md has said
-- "No auto-published Completion Report" since it was written.
--
-- The order, as she set it: worker first, then the desk, then the client.
--
--   1 drafted          yaad-completion drafts the care notes (a draft only)
--   2 accepted         a named person on the desk edits and accepts them;
--                      the report goes to the worker with a sign code
--   3 signed           the worker reads it, may change the WORDS (care notes,
--                      their own account of the work), and signs with their
--                      typed name and the code
--   4 issued           a named person accepts what the worker signed and
--                      issues it; only now can the client see it
--   5 client_confirmed or client_flagged, the client's review
--
-- What the worker can change is the words and nothing else. Dates, arrivals,
-- approvals, photographs and fingerprints are read from the record by the
-- page and are not stored here at all, so there is nothing for anybody to
-- edit, the desk included. That is what makes the signature worth having.
--
-- A worker's change never reaches the client unread: issuing is step 4, a
-- named human, always. A desk edit after the worker has signed is a new
-- claim, so it starts a new revision, clears the signature and the issue, and
-- the report goes back to the worker. Same rule the Kickoff Pack keeps.
--
-- The worker edits on one portal page. That is a deliberate exception to
-- CLAUDE.md section 9 and to the founder's own 1 September correction that
-- worker confirmations go over WhatsApp; she chose the page over the WhatsApp
-- route when asked on 28 September 2026. See DECISIONS.md.
--
-- No money anywhere in this table, by decision: the report can be forwarded
-- to family or a buyer without showing what was paid.

create table if not exists public.completion_reports (
  job_id              text primary key references public.jobs(id),
  rev                 int  not null default 1,
  status              text not null default 'draft'
                      check (status in ('draft','with_worker','worker_signed','issued')),
  care_notes          text[] not null default '{}',
  worker_account      text,
  drafted_model       text,
  drafted_at          timestamptz,
  accepted_by         text,
  accepted_name       text,
  accepted_at         timestamptz,
  sign_code           text,
  worker_signed_name  text,
  worker_signed_email text,
  worker_signed_at    timestamptz,
  worker_changed      boolean,
  issued_by           text,
  issued_name         text,
  issued_at           timestamptz,
  client_confirmed_at timestamptz,
  client_flag         text,
  client_flagged_at   timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table if not exists public.completion_report_events (
  id          bigint generated always as identity primary key,
  job_id      text not null references public.jobs(id),
  rev         int  not null,
  step        text not null check (step in
                ('drafted','edited','accepted','signed','issued','client_confirmed','client_flagged')),
  actor_email text,
  actor_name  text,
  at          timestamptz not null default now(),
  detail      jsonb not null default '{}'::jsonb
);
create index if not exists completion_report_events_job on public.completion_report_events(job_id, at);

alter table public.completion_reports enable row level security;
alter table public.completion_report_events enable row level security;

-- Who may read what. The client sees nothing until it is issued. The worker
-- sees it from the moment it is sent to them, because they are asked to read
-- and sign it. No write policy for anybody but the admin: every other write
-- goes through the functions below, which carry the rules.
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
        or (r.status in ('with_worker','worker_signed','issued')
          and lower(coalesce(j.worker_email,'')) = lower(auth.jwt()->>'email'))
      )
  );
$$;
revoke execute on function public._completion_report_visible(text) from anon, public;
grant  execute on function public._completion_report_visible(text) to authenticated;

drop policy if exists "admin full completion_reports" on public.completion_reports;
create policy "admin full completion_reports" on public.completion_reports
  for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists "parties read completion_reports" on public.completion_reports;
create policy "parties read completion_reports" on public.completion_reports
  for select using (public._completion_report_visible(job_id));

drop policy if exists "admin full completion_report_events" on public.completion_report_events;
create policy "admin full completion_report_events" on public.completion_report_events
  for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists "parties read completion_report_events" on public.completion_report_events;
create policy "parties read completion_report_events" on public.completion_report_events
  for select using (public._completion_report_visible(job_id));

revoke all on public.completion_reports, public.completion_report_events from anon;

-- Care notes are short sentences, a handful of them. Checked in one place so
-- the desk and the worker are held to the same shape.
create or replace function public._clean_care_notes(p text[])
returns text[]
language plpgsql
immutable
set search_path to 'public'
as $$
declare
  v text[] := '{}';
  x text;
begin
  foreach x in array coalesce(p, '{}') loop
    x := btrim(regexp_replace(coalesce(x,''), '\s+', ' ', 'g'));
    if x = '' then continue; end if;
    if char_length(x) > 400 then
      raise exception 'A care note is one or two sentences. That one is % characters; keep each under 400.', char_length(x)
        using errcode = 'check_violation';
    end if;
    v := v || x;
  end loop;
  if coalesce(array_length(v,1),0) > 8 then
    raise exception 'Keep the care notes to eight or fewer. A long list gets read as small print.'
      using errcode = 'check_violation';
  end if;
  return v;
end $$;

-- Step 1 and every desk edit. Creates the report if there is none. Any edit
-- after it has left the desk is a new claim: new revision, back to draft,
-- signature and issue cleared, and it has to go round again.
create or replace function public.save_completion_report(
  p_job text, p_care_notes text[], p_worker_account text default null, p_drafted_model text default null)
returns table(report_rev int, report_status text)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_job   jobs%rowtype;
  v_rep   completion_reports%rowtype;
  v_email text := lower(nullif(btrim(auth.jwt()->>'email'), ''));
  v_notes text[];
  v_acct  text := nullif(btrim(coalesce(p_worker_account,'')), '');
  v_rev   int;
  v_was   text;
begin
  if not public.is_admin() then
    raise exception 'Admin only.' using errcode = '28000';
  end if;
  select * into v_job from jobs where id = p_job;
  if not found then raise exception 'No such job.' using errcode = 'check_violation'; end if;
  if v_job.status <> 'complete' then
    raise exception 'A Completion Report is for a finished job. This one is %.', v_job.status
      using errcode = 'check_violation';
  end if;
  if v_acct is not null and char_length(v_acct) > 2000 then
    raise exception 'The account of the work is % characters. Keep it under 2,000.', char_length(v_acct)
      using errcode = 'check_violation';
  end if;
  v_notes := public._clean_care_notes(p_care_notes);

  select * into v_rep from completion_reports where job_id = p_job for update;
  v_was := case when found then v_rep.status end;
  if v_was is null then
    insert into completion_reports (job_id, care_notes, worker_account, drafted_model, drafted_at)
    values (p_job, v_notes, v_acct, p_drafted_model, case when p_drafted_model is not null then now() end);
    v_rev := 1;
  else
    v_rev := case when v_rep.status = 'draft' then v_rep.rev else v_rep.rev + 1 end;
    update completion_reports set
      rev = v_rev, status = 'draft',
      care_notes = v_notes, worker_account = v_acct,
      drafted_model = coalesce(p_drafted_model, drafted_model),
      drafted_at = case when p_drafted_model is not null then now() else drafted_at end,
      accepted_by = null, accepted_name = null, accepted_at = null, sign_code = null,
      worker_signed_name = null, worker_signed_email = null, worker_signed_at = null, worker_changed = null,
      issued_by = null, issued_name = null, issued_at = null,
      client_confirmed_at = null, client_flag = null, client_flagged_at = null,
      updated_at = now()
    where job_id = p_job;
  end if;

  insert into completion_report_events (job_id, rev, step, actor_email, actor_name, detail)
  values (p_job, v_rev,
          case when p_drafted_model is not null then 'drafted' else 'edited' end,
          case when p_drafted_model is not null then null else v_email end,
          case when p_drafted_model is not null then 'Drafting agent (a draft only)' else null end,
          jsonb_build_object('care_notes', to_jsonb(v_notes), 'worker_account', v_acct,
                             'model', p_drafted_model,
                             'reopened_from', case when v_was <> 'draft' then v_was end));

  return query select v_rev, 'draft'::text;
end $$;

-- Step 2. A named person accepts the wording and it goes to the worker.
create or replace function public.accept_completion_report(p_job text, p_name text)
returns table(code text)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_rep   completion_reports%rowtype;
  v_email text := lower(nullif(btrim(auth.jwt()->>'email'), ''));
  v_name  text := nullif(btrim(coalesce(p_name,'')), '');
  v_code  text := upper(substring(encode(extensions.gen_random_bytes(4), 'hex') from 1 for 6));
  v_job   jobs%rowtype;
begin
  if not public.is_admin() then raise exception 'Admin only.' using errcode = '28000'; end if;
  if v_name is null or char_length(v_name) < 3 then
    raise exception 'Your name, as it will print on the report. A report is accepted by a named person.'
      using errcode = 'check_violation';
  end if;
  select * into v_rep from completion_reports where job_id = p_job for update;
  if not found then raise exception 'There is no draft for this job yet. Draft the care notes first.' using errcode = 'check_violation'; end if;
  if v_rep.status <> 'draft' then
    raise exception 'This report is already %; only a draft can be accepted.', replace(v_rep.status,'_',' ')
      using errcode = 'check_violation';
  end if;
  select * into v_job from jobs where id = p_job;
  if nullif(btrim(coalesce(v_job.worker_email,'')), '') is null then
    raise exception 'There is no worker on this job to sign it.' using errcode = 'check_violation';
  end if;

  update completion_reports set status = 'with_worker', accepted_by = v_email, accepted_name = v_name,
         accepted_at = now(), sign_code = v_code, updated_at = now()
   where job_id = p_job;
  insert into completion_report_events (job_id, rev, step, actor_email, actor_name, detail)
  values (p_job, v_rep.rev, 'accepted', v_email, v_name,
          jsonb_build_object('care_notes', to_jsonb(v_rep.care_notes), 'worker_account', v_rep.worker_account));
  return query select v_code;
end $$;

-- Step 3. The worker, signed in, with the code from the link. The code is
-- checked against the current revision, so a link from before a desk edit
-- fails closed rather than signing wording that changed under them.
create or replace function public.sign_completion_report(
  p_job text, p_code text, p_name text, p_care_notes text[], p_worker_account text default null)
returns table(worker_did_change boolean)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_rep   completion_reports%rowtype;
  v_job   jobs%rowtype;
  v_email text := lower(nullif(btrim(auth.jwt()->>'email'), ''));
  v_name  text := nullif(btrim(regexp_replace(coalesce(p_name,''), '\s+', ' ', 'g')), '');
  v_notes text[];
  v_acct  text := nullif(btrim(coalesce(p_worker_account,'')), '');
  v_changed boolean;
begin
  if v_email is null then raise exception 'Sign in to sign this report.' using errcode = '28000'; end if;
  select * into v_job from jobs where id = p_job;
  if not found then raise exception 'No such job.' using errcode = 'check_violation'; end if;
  if lower(coalesce(v_job.worker_email,'')) <> v_email then
    raise exception 'Only the worker on this job can sign its report.' using errcode = '28000';
  end if;
  select * into v_rep from completion_reports where job_id = p_job for update;
  if not found or v_rep.status <> 'with_worker' then
    raise exception 'This report is not waiting for your signature.' using errcode = 'check_violation';
  end if;
  if v_rep.sign_code is null or upper(btrim(coalesce(p_code,''))) <> v_rep.sign_code then
    raise exception 'That code does not match the current version of this report. Open the latest link from your WhatsApp.'
      using errcode = 'check_violation';
  end if;
  if v_name is null or char_length(v_name) < 3 or v_name !~ '\s' then
    raise exception 'Type your full name, first and last, to sign.' using errcode = 'check_violation';
  end if;
  if v_acct is not null and char_length(v_acct) > 2000 then
    raise exception 'Your account of the work is % characters. Keep it under 2,000.', char_length(v_acct)
      using errcode = 'check_violation';
  end if;
  v_notes := public._clean_care_notes(p_care_notes);
  v_changed := v_notes is distinct from v_rep.care_notes or v_acct is distinct from v_rep.worker_account;

  update completion_reports set care_notes = v_notes, worker_account = v_acct,
         status = 'worker_signed', worker_signed_name = v_name, worker_signed_email = v_email,
         worker_signed_at = now(), worker_changed = v_changed, updated_at = now()
   where job_id = p_job;
  insert into completion_report_events (job_id, rev, step, actor_email, actor_name, detail)
  values (p_job, v_rep.rev, 'signed', v_email, v_name,
          jsonb_build_object('changed', v_changed,
            'before', jsonb_build_object('care_notes', to_jsonb(v_rep.care_notes), 'worker_account', v_rep.worker_account),
            'after',  jsonb_build_object('care_notes', to_jsonb(v_notes), 'worker_account', v_acct)));
  return query select v_changed;
end $$;

-- Step 4. A named person reads what the worker signed and issues it. This is
-- the only door to the client, so a worker's change is always read first.
create or replace function public.issue_completion_report(p_job text, p_name text)
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
    raise exception 'Your name, as it will print on the report. A report is issued by a named person.'
      using errcode = 'check_violation';
  end if;
  select * into v_rep from completion_reports where job_id = p_job for update;
  if not found or v_rep.status <> 'worker_signed' then
    raise exception 'Only a report the worker has signed can be issued. This one is %.',
      coalesce(replace(v_rep.status,'_',' '), 'not drafted') using errcode = 'check_violation';
  end if;
  update completion_reports set status = 'issued', issued_by = v_email, issued_name = v_name,
         issued_at = now(), updated_at = now()
   where job_id = p_job;
  insert into completion_report_events (job_id, rev, step, actor_email, actor_name, detail)
  values (p_job, v_rep.rev, 'issued', v_email, v_name,
          jsonb_build_object('worker_changed', v_rep.worker_changed));
end $$;

-- Step 5. The client's review. They cannot edit a signed report; a point they
-- raise lands on the desk's inbox as a portal message, and if it is upheld the
-- desk edits, which starts a new revision round.
create or replace function public.confirm_completion_report(p_job text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_rep   completion_reports%rowtype;
  v_job   jobs%rowtype;
  v_email text := lower(nullif(btrim(auth.jwt()->>'email'), ''));
begin
  if v_email is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  select * into v_job from jobs where id = p_job;
  if not found or lower(coalesce(v_job.client_email,'')) <> v_email then
    raise exception 'Only the client on this job can confirm its report.' using errcode = '28000';
  end if;
  select * into v_rep from completion_reports where job_id = p_job for update;
  if not found or v_rep.status <> 'issued' then
    raise exception 'This report has not been issued.' using errcode = 'check_violation';
  end if;
  if v_rep.client_confirmed_at is not null then return; end if;
  update completion_reports set client_confirmed_at = now(), updated_at = now() where job_id = p_job;
  insert into completion_report_events (job_id, rev, step, actor_email, actor_name)
  values (p_job, v_rep.rev, 'client_confirmed', v_email, v_job.client_name);
end $$;

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
  if char_length(v_body) < 5 or char_length(v_body) > 2000 then
    raise exception 'Say what is wrong or missing, in a sentence or two (under 2,000 characters).'
      using errcode = 'check_violation';
  end if;
  update completion_reports set client_flag = v_body, client_flagged_at = now(), updated_at = now()
   where job_id = p_job;
  insert into completion_report_events (job_id, rev, step, actor_email, actor_name, detail)
  values (p_job, v_rep.rev, 'client_flagged', v_email, v_job.client_name, jsonb_build_object('body', v_body));
  insert into portal_contacts (job_id, sender_email, sender_role, body)
  values (p_job, v_email, 'client', 'About the Completion Report: ' || v_body);
end $$;

revoke execute on function public._clean_care_notes(text[]) from anon, public;
revoke execute on function public.save_completion_report(text, text[], text, text) from anon, public;
revoke execute on function public.accept_completion_report(text, text) from anon, public;
revoke execute on function public.sign_completion_report(text, text, text, text[], text) from anon, public;
revoke execute on function public.issue_completion_report(text, text) from anon, public;
revoke execute on function public.confirm_completion_report(text) from anon, public;
revoke execute on function public.flag_completion_report(text, text) from anon, public;
grant execute on function public.save_completion_report(text, text[], text, text) to authenticated;
grant execute on function public.accept_completion_report(text, text) to authenticated;
grant execute on function public.sign_completion_report(text, text, text, text[], text) to authenticated;
grant execute on function public.issue_completion_report(text, text) to authenticated;
grant execute on function public.confirm_completion_report(text) to authenticated;
grant execute on function public.flag_completion_report(text, text) to authenticated;

-- The desk's list: every finished job, with where its report is.
create or replace view public.v_completion_reports
with (security_invoker = true) as
select j.id, j.title, j.parish, j.trade, j.client_name, j.worker_name, j.updated_at as job_updated_at,
       coalesce(r.status, 'not_drafted') as report_status,
       r.rev, r.care_notes, r.worker_account, r.drafted_model, r.drafted_at,
       r.accepted_name, r.accepted_at, r.sign_code,
       r.worker_signed_name, r.worker_signed_at, r.worker_changed,
       r.issued_name, r.issued_at, r.client_confirmed_at, r.client_flag, r.client_flagged_at,
       coalesce(j.is_test, false) as is_test
  from public.jobs j
  left join public.completion_reports r on r.job_id = j.id
 where j.status = 'complete';
revoke all on public.v_completion_reports from anon;
grant select on public.v_completion_reports to authenticated;

comment on table public.completion_reports is
  'The Completion Report''s words and its sign-off chain: drafted, accepted by a named person, signed by the worker, issued by a named person, reviewed by the client. Facts are read from the record by the page, never stored here. See 20260928160000.';
comment on table public.completion_report_events is
  'The review trail printed on the Completion Report. Written only by the completion report functions.';
