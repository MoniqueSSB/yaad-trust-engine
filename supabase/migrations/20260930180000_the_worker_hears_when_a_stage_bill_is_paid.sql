-- The worker hears when the client has paid for a stage. 30 Sep 2026.
--
-- On a job billed by stage (20260929100000), each stage is worked only once
-- its own bill is paid. stage_signed_off_worker (20260930170000) tells the
-- worker "Do not start it yet: the client pays for it first", and nothing
-- told the worker when that bill was paid. This adds that one message,
-- stage_paid_worker, sent by yaad-notify-client.
--
-- It sends a message and nothing else. It approves nothing, releases nothing
-- and moves no money. Marking a bill paid is a named person at the desk
-- (paid_by is written from the signed-in person, 20260914230000); the Stripe
-- webhook records a card payment and never marks an invoice paid. This only
-- follows that click.
--
-- WHAT FIRES IT: an invoice going INTO status 'paid' that is
--   a client bill for one stage of a job: job_id set, stage 1 or more,
--     payable to Yaadly (payable_to null or 'yaadly'), not an add-on bill
--     (addon_id null), not a part of a bill (part_of null);
--   not the bill that starts the job (starts_job false): job_live_worker
--     already covers that one, fired from the jobs row;
--   on a job billed by stage (_job_is_billed_by_stage), with a worker on it;
--   and the first paid bill for that stage, so a reissued bill cannot send it
--     twice.
--
-- ASSUMPTIONS, read from the migrations and to be checked against the live
-- definitions before applying:
--   invoices has columns job_id, stage, status, payable_to, addon_id,
--     part_of and starts_job (20260826, 20260913233000, 20260928235000).
--   Stage bills are drafted by _draft_client_stage_bill() with stage set,
--     part_of null and starts_job false; a part can only be taken from a bill
--     with no stage (request part refuses otherwise, 20260913233000), so a
--     stage bill is never a part.
--   public._job_is_billed_by_stage(text) exists (20260929100000).
--   public.notify_trigger_secret() and the publishable key headers are the
--     ones notify_client_on_job_change uses (20260930170000).
--
-- yaad-notify-client checks the rows again and stays quiet unless the job is
-- live and the paid stage is the stage being worked. A stage paid ahead is
-- said by stage_signed_off_worker when it comes up, which reads the same bill.
--
-- A new function and a new trigger. No existing function is redefined.

create or replace function public.notify_worker_on_stage_bill_paid()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
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
    perform net.http_post(
      url := 'https://leffyisvfvjwzilydlwf.supabase.co/functions/v1/yaad-notify-client',
      body := jsonb_build_object('secret', public.notify_trigger_secret(), 'jobId', new.job_id,
        'kind', 'stage_paid_worker', 'meta', jsonb_build_object('invoiceId', new.id)),
      headers := jsonb_build_object('Content-Type','application/json','apikey','sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz','Authorization','Bearer '||'sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz'),
      timeout_milliseconds := 15000
    );
  end if;
  return new;
exception when others then
  -- A message that could not be queued must never stop a bill being marked
  -- paid. The desk can still tell the worker by hand.
  return new;
end
$function$;

revoke all on function public.notify_worker_on_stage_bill_paid() from public, anon, authenticated;

drop trigger if exists trg_notify_worker_on_stage_bill_paid on public.invoices;
create trigger trg_notify_worker_on_stage_bill_paid
  after update of status on public.invoices
  for each row execute function public.notify_worker_on_stage_bill_paid();
