-- The worker is told when a client requests a video walkthrough.
--
-- 20260831l built request_walkthrough(): the client names a platform, a
-- preferred time and what they want walked through, and it lands on the
-- job row. Nothing told the worker. They found out only by opening the job
-- in the portal on the chance, which on a phone mid-job means never. The
-- one notification in this loop (20260831o) fires later, to the CLIENT,
-- once the worker has written up notes from a call that, without this,
-- may never have been arranged.
--
-- Founder, 14 Sep 2026: the worker is notified by WhatsApp and email that
-- a message has been sent to them. yaad-notify-client, kind
-- walkthrough_requested, routes to the worker's phone from worker_profiles
-- and the worker's own email off the job, the same shape as
-- dispute_raised_worker.
--
-- Fires on a NEW request, and again if the client changes it before the
-- worker has confirmed, because request_walkthrough() clears any confirmed
-- link on a re-request and the worker needs to know the old arrangement is
-- stale. Never fires on the worker's own confirm (that sets walk_link) or
-- on a clear (that sets signoff_method null). Extends the one AFTER UPDATE
-- trigger function on jobs rather than adding a second one competing for
-- the row, the same reasoning 20260831o gave.
--
-- No human gate moves. A walkthrough is how a client chooses to LOOK at
-- the evidence; approve_stage() still does not read signoff_method.

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

      return new;
    end;
$function$;
