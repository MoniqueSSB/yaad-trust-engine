-- The CRM hears every job and every stage move, from the database.
--
-- Until now HubSpot heard about one thing: a WhatsApp job whose client had
-- confirmed the read-back, sent inline by yaad-inbound. A job booked in the
-- portal or on the website form, a client paying, evidence landing, a stage
-- being approved and a worker being paid all happened here in Postgres and
-- the board never moved. The app's stage webhook was built and called by
-- nothing. Monique's instruction, 30 September 2026: connect it correctly, so
-- it works from the portal and from WhatsApp alike.
--
-- Fired from the writes that change state, never from a screen, the same
-- pattern as the client notifications (20260831i) and the Completion Report
-- (20260928210000). A job row is a job row whichever door wrote it.
--
-- The triggers send only the job id and the name of what happened.
-- yaad-crm-sync reads the row and decides what leaves; the app decides what
-- stage an event implies and refuses to go backwards, so a trigger firing
-- twice is harmless. Test jobs are skipped there too. Nothing here moves
-- money or touches an approval: it reports them.
--
-- The secret is public.notify_trigger_secret(), reused, never regenerated.
-- 20260831z2 records what regenerating it did to every other trigger.

create or replace function public.crm_sync(p_job text, p_kind text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform net.http_post(
    url := 'https://leffyisvfvjwzilydlwf.supabase.co/functions/v1/yaad-crm-sync',
    body := jsonb_build_object('secret', public.notify_trigger_secret(), 'jobId', p_job, 'kind', p_kind),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz',
      'Authorization', 'Bearer ' || 'sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz'),
    timeout_milliseconds := 15000
  );
exception when others then
  -- The CRM is never allowed to fail a job write.
  raise warning 'crm_sync % %: %', p_kind, p_job, sqlerrm;
end $$;
revoke all on function public.crm_sync(text, text) from public, anon, authenticated;

-- ── a job exists, or its shape changed ──────────────────────────────────
-- A draft is a conversation, not a job: the WhatsApp path syncs its own
-- confirmed read-back inline, and everything else is picked up the moment the
-- row leaves draft. Later changes to the fields that leave (name, number,
-- parish, trade, urgency) are sent again; the lead route updates in place.
create or replace function public.crm_on_job_written()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if coalesce(new.is_test, false) then return new; end if;
  if new.status = 'draft' then return new; end if;
  if tg_op = 'INSERT'
     or old.status = 'draft'
     or new.client_name  is distinct from old.client_name
     or new.client_phone is distinct from old.client_phone
     or new.parish       is distinct from old.parish
     or new.trade        is distinct from old.trade
     or new.urgency      is distinct from old.urgency then
    perform public.crm_sync(new.id, 'lead');
  end if;
  return new;
end $$;
revoke all on function public.crm_on_job_written() from public, anon, authenticated;

drop trigger if exists trg_crm_job_written on public.jobs;
create trigger trg_crm_job_written
  after insert or update of status, client_name, client_phone, parish, trade, urgency on public.jobs
  for each row execute function public.crm_on_job_written();

-- ── evidence landed, job complete ───────────────────────────────────────
-- Same transition the client notification uses: INTO 'evidence', once, not
-- on every row sync_job_status touches. 'complete' re-checks the worker's
-- pay (below), because the last worker payment can land before the status.
create or replace function public.crm_on_job_status()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if coalesce(new.is_test, false) then return new; end if;
  if new.status = 'evidence' and coalesce(old.status, '') is distinct from 'evidence' then
    perform public.crm_sync(new.id, 'evidence_submitted');
  end if;
  if new.status = 'complete' and coalesce(old.status, '') is distinct from 'complete'
     and public.crm_worker_fully_paid(new.id) then
    perform public.crm_sync(new.id, 'worker_paid');
  end if;
  return new;
end $$;
revoke all on function public.crm_on_job_status() from public, anon, authenticated;

drop trigger if exists trg_crm_job_status on public.jobs;
create trigger trg_crm_job_status
  after update of status on public.jobs
  for each row execute function public.crm_on_job_status();

-- ── a stage approved ────────────────────────────────────────────────────
-- Only approve_stage() writes this table, so a row here is a named human's
-- decision and nothing else. Reported, never made, by this.
create or replace function public.crm_on_stage_approved()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform public.crm_sync(new.job_id, 'client_approved');
  return new;
end $$;
revoke all on function public.crm_on_stage_approved() from public, anon, authenticated;

drop trigger if exists trg_crm_stage_approved on public.stage_approvals;
create trigger trg_crm_stage_approved
  after insert on public.stage_approvals
  for each row execute function public.crm_on_stage_approved();

-- ── money marked paid ───────────────────────────────────────────────────
-- "Completed and Paid" on the board means the job is complete and every
-- worker payable on it has been paid, not the first of several stage
-- payments. Add-on bills are part of the same job and count the same way.
create or replace function public.crm_worker_fully_paid(p_job text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (select 1 from jobs j where j.id = p_job and j.status = 'complete')
     and exists (select 1 from invoices w where w.job_id = p_job and w.payable_to = 'worker' and w.status = 'paid')
     and not exists (select 1 from invoices w where w.job_id = p_job and w.payable_to = 'worker'
                        and w.status in ('draft', 'sent') and coalesce(w.total_pence, 0) > 0);
$$;
revoke all on function public.crm_worker_fully_paid(text) from public, anon, authenticated;

create or replace function public.crm_on_invoice_paid()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.status <> 'paid' or coalesce(old.status, '') = 'paid' then return new; end if;
  if new.job_id is null or coalesce(new.total_pence, 0) <= 0 then return new; end if;
  if coalesce(new.payable_to, 'yaadly') = 'worker' then
    if public.crm_worker_fully_paid(new.job_id) then
      perform public.crm_sync(new.job_id, 'worker_paid');
    end if;
  else
    -- The first client payment on the job. The route refuses to go
    -- backwards, so the second and third stage payments are no-ops there.
    perform public.crm_sync(new.job_id, 'client_paid');
  end if;
  return new;
end $$;
revoke all on function public.crm_on_invoice_paid() from public, anon, authenticated;

drop trigger if exists trg_crm_invoice_paid on public.invoices;
create trigger trg_crm_invoice_paid
  after update of status on public.invoices
  for each row execute function public.crm_on_invoice_paid();
