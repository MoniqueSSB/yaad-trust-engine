-- The client hears when the job goes live, and when a stage bill is paid.
-- 1 Oct 2026.
--
-- Founder: "make sure this aligns to the worker whatsapp work flow." Read
-- side by side, the booked message and the Kickoff Pack reply both promise
-- the client "a message here when the job is live", and only the worker was
-- ever sent one (job_live_worker, 20260917190000). On a job billed by stage
-- the worker is told when the next stage's bill is paid and to start
-- (stage_paid_worker, 20260930180000); the client, who paid it, heard
-- nothing.
--
-- Both fire at the same moment as the worker's message and are checked
-- again in yaad-notify-client off the rows themselves. Nothing here moves
-- money or decides anything: a person still marks every bill paid.

-- 1. The job goes live: its own trigger, the same condition as the worker's
--    branch of notify_client_on_job_change, so that function is untouched.
create or replace function public.notify_client_job_live()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if coalesce(new.worker_email, '') <> ''
     and new.status in ('in_progress', 'evidence')
     and coalesce(old.status, '') not in ('in_progress', 'evidence', 'disputed', 'complete', 'cancelled')
  then
    perform net.http_post(
      url := 'https://leffyisvfvjwzilydlwf.supabase.co/functions/v1/yaad-notify-client',
      body := jsonb_build_object('secret', public.notify_trigger_secret(), 'jobId', new.id, 'kind', 'job_live'),
      headers := jsonb_build_object('Content-Type','application/json','apikey','sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz','Authorization','Bearer '||'sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz'),
      timeout_milliseconds := 15000
    );
  end if;
  return new;
exception when others then
  -- A message that could not be queued must never stop a job going live.
  return new;
end
$function$;
revoke all on function public.notify_client_job_live() from public, anon, authenticated;

drop trigger if exists trg_notify_client_job_live on public.jobs;
create trigger trg_notify_client_job_live
  after update of status on public.jobs
  for each row execute function public.notify_client_job_live();

-- 2. A stage bill is paid: the same function now tells the client as well.
create or replace function public.notify_worker_on_stage_bill_paid()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  k text;
begin
  if new.status = 'paid'
     and old.status is distinct from 'paid'
     and new.job_id is not null
     and coalesce(new.stage, 0) >= 1
     and coalesce(new.payable_to, 'yaadly') = 'yaadly'
     and new.addon_id is null
     and new.part_of is null
     and not coalesce(new.starts_job, false)
     and public._job_is_billed_by_stage(new.job_id)
     and exists (select 1 from public.jobs j where j.id = new.job_id and coalesce(j.worker_email, '') <> '')
     and not exists (
       select 1 from public.invoices i
        where i.job_id = new.job_id and i.stage = new.stage and i.id <> new.id
          and coalesce(i.payable_to, 'yaadly') = 'yaadly' and i.addon_id is null
          and i.status = 'paid'
     )
  then
    foreach k in array array['stage_paid_worker', 'stage_paid'] loop
      perform net.http_post(
        url := 'https://leffyisvfvjwzilydlwf.supabase.co/functions/v1/yaad-notify-client',
        body := jsonb_build_object('secret', public.notify_trigger_secret(), 'jobId', new.job_id,
          'kind', k, 'meta', jsonb_build_object('invoiceId', new.id)),
        headers := jsonb_build_object('Content-Type','application/json','apikey','sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz','Authorization','Bearer '||'sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz'),
        timeout_milliseconds := 15000
      );
    end loop;
  end if;
  return new;
exception when others then
  -- A message that could not be queued must never stop a bill being marked
  -- paid. The desk can still tell either side by hand.
  return new;
end
$function$;
revoke all on function public.notify_worker_on_stage_bill_paid() from public, anon, authenticated;
