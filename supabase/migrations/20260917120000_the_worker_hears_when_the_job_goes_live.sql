-- The worker hears when the job goes live.
--
-- booked_worker (yaad-notify-client) tells a worker not to start yet, and
-- that they will get a message on their number once the client's invoice to
-- Yaadly is paid. Read on 17 Sep 2026: nothing sent that message. A worker
-- could be booked, the client could pay, and the worker would sit waiting
-- for word that never came.
--
-- Founder, 17 Sep 2026: tell the worker, and tell them to check in with a
-- WhatsApp location pin when they arrive on site.
--
-- Fires when a job with a worker on it moves into work (in_progress or
-- evidence) from anything that is not already work. That is the moment
-- start_job_on_agency_fee_paid() sets stage 1 and sync_job_status() lifts
-- awaiting_payment. Coming back from a dispute, or the evidence and
-- in_progress status swapping as photos land, does not fire it.
--
-- No human gate moves. A person still marks the invoice paid; this only
-- tells the worker that it has been. Extends the one AFTER UPDATE trigger
-- function on jobs, as 20260831o and 20260915000000 did. The body below is
-- production's, read live on 17 Sep 2026 and identical to 20260915000000,
-- with the one block added.

create or replace function public.notify_client_on_job_change()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
    begin
      if coalesce(new.stage,0) > coalesce(old.stage,0)
         and exists (select 1 from public.stage_approvals a where a.job_id = new.id and a.stage = new.stage - 1)
      then
        perform net.http_post(
          url := 'https://leffyisvfvjwzilydlwf.supabase.co/functions/v1/yaad-notify-client',
          body := jsonb_build_object('secret', public.notify_trigger_secret(), 'jobId', new.id, 'kind', 'stage_released'),
          headers := jsonb_build_object('Content-Type','application/json','apikey','sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz','Authorization','Bearer '||'sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz'),
          timeout_milliseconds := 15000
        );
      end if;

      if new.status = 'complete' and coalesce(old.status, '') is distinct from 'complete' then
        perform net.http_post(
          url := 'https://leffyisvfvjwzilydlwf.supabase.co/functions/v1/yaad-notify-client',
          body := jsonb_build_object('secret', public.notify_trigger_secret(), 'jobId', new.id, 'kind', 'stage_released_worker'),
          headers := jsonb_build_object('Content-Type','application/json','apikey','sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz','Authorization','Bearer '||'sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz'),
          timeout_milliseconds := 15000
        );
      end if;

      if new.walk_call_notes is not null
         and old.walk_call_notes is distinct from new.walk_call_notes
      then
        perform net.http_post(
          url := 'https://leffyisvfvjwzilydlwf.supabase.co/functions/v1/yaad-notify-client',
          body := jsonb_build_object('secret', public.notify_trigger_secret(), 'jobId', new.id, 'kind', 'walkthrough_notes_ready'),
          headers := jsonb_build_object('Content-Type','application/json','apikey','sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz','Authorization','Bearer '||'sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz'),
          timeout_milliseconds := 15000
        );
      end if;

      -- A client has requested a video walkthrough, or changed one the
      -- worker has not yet confirmed. 20260915000000.
      if new.signoff_method = 'walkthrough'
         and new.walk_link is null
         and coalesce(new.worker_email, '') <> ''
         and (
           coalesce(old.signoff_method, '') is distinct from 'walkthrough'
           or old.walk_link is not null
           or old.walk_platform is distinct from new.walk_platform
           or old.walk_date     is distinct from new.walk_date
           or old.walk_notes    is distinct from new.walk_notes
         )
      then
        perform net.http_post(
          url := 'https://leffyisvfvjwzilydlwf.supabase.co/functions/v1/yaad-notify-client',
          body := jsonb_build_object('secret', public.notify_trigger_secret(), 'jobId', new.id, 'kind', 'walkthrough_requested'),
          headers := jsonb_build_object('Content-Type','application/json','apikey','sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz','Authorization','Bearer '||'sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz'),
          timeout_milliseconds := 15000
        );
      end if;

      -- The job has gone live with a worker on it: the client's invoice that
      -- starts the job is paid, and sync_job_status has moved it off
      -- awaiting_payment. booked_worker promised the worker a message when
      -- this happened. 20260917120000.
      if coalesce(new.worker_email, '') <> ''
         and new.status in ('in_progress', 'evidence')
         and coalesce(old.status, '') not in ('in_progress', 'evidence', 'disputed', 'complete', 'cancelled')
      then
        perform net.http_post(
          url := 'https://leffyisvfvjwzilydlwf.supabase.co/functions/v1/yaad-notify-client',
          body := jsonb_build_object('secret', public.notify_trigger_secret(), 'jobId', new.id, 'kind', 'job_live_worker'),
          headers := jsonb_build_object('Content-Type','application/json','apikey','sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz','Authorization','Bearer '||'sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz'),
          timeout_milliseconds := 15000
        );
      end if;

      return new;
    end;
$function$;
