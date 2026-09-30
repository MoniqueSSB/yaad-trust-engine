-- The worker hears when a stage is signed off. 30 Sep 2026.
--
-- The booking message tells the worker they are paid within 7 days of each
-- stage signing off, but until now the worker heard nothing until the whole
-- job was complete. This adds one call, stage_signed_off_worker, beside the
-- existing stage_released call for the client, on the same condition: the
-- stage moved on and a named person's stage approval exists for the stage
-- before. It sends a message and nothing else. It approves nothing and moves
-- no money. yaad-notify-client skips the last stage, which
-- stage_released_worker already covers.
--
-- Copied from the live definition (pg_get_functiondef, 30 Sep 2026), which
-- matched 20260930120000. Only the marked block is new. Re-read the live
-- definition right before applying in case another session changed it.

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

        -- New, 20260930170000: the worker is told too.
        if coalesce(new.worker_email, '') <> '' then
          perform net.http_post(
            url := 'https://leffyisvfvjwzilydlwf.supabase.co/functions/v1/yaad-notify-client',
            body := jsonb_build_object('secret', public.notify_trigger_secret(), 'jobId', new.id, 'kind', 'stage_signed_off_worker'),
            headers := jsonb_build_object('Content-Type','application/json','apikey','sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz','Authorization','Bearer '||'sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz'),
            timeout_milliseconds := 15000
          );
        end if;
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
      -- this happened. 20260917190000.
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

      -- The worker has offered a day and time for the walkthrough, on
      -- WhatsApp or in the portal. Yaadly sends it to the client, who
      -- accepts. 20260930120000.
      if new.walk_offered_at is not null
         and old.walk_offered_at is distinct from new.walk_offered_at
      then
        perform net.http_post(
          url := 'https://leffyisvfvjwzilydlwf.supabase.co/functions/v1/yaad-notify-client',
          body := jsonb_build_object('secret', public.notify_trigger_secret(), 'jobId', new.id, 'kind', 'walkthrough_offered'),
          headers := jsonb_build_object('Content-Type','application/json','apikey','sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz','Authorization','Bearer '||'sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz'),
          timeout_milliseconds := 15000
        );
      end if;

      -- The client accepted the offered time. Both sides are told.
      if new.walk_accepted_at is not null
         and old.walk_accepted_at is distinct from new.walk_accepted_at
      then
        perform net.http_post(
          url := 'https://leffyisvfvjwzilydlwf.supabase.co/functions/v1/yaad-notify-client',
          body := jsonb_build_object('secret', public.notify_trigger_secret(), 'jobId', new.id, 'kind', 'walkthrough_accepted'),
          headers := jsonb_build_object('Content-Type','application/json','apikey','sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz','Authorization','Bearer '||'sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz'),
          timeout_milliseconds := 15000
        );
        perform net.http_post(
          url := 'https://leffyisvfvjwzilydlwf.supabase.co/functions/v1/yaad-notify-client',
          body := jsonb_build_object('secret', public.notify_trigger_secret(), 'jobId', new.id, 'kind', 'walkthrough_accepted_worker'),
          headers := jsonb_build_object('Content-Type','application/json','apikey','sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz','Authorization','Bearer '||'sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz'),
          timeout_milliseconds := 15000
        );
      end if;


      return new;
    end;
$function$;
