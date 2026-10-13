-- Meta template approvals record themselves, 13 October 2026.
--
-- Until today a template approved by Meta switched nothing on until somebody
-- remembered to run the matching status action on yaad-twilio-setup from the
-- SQL editor. On 13 October two templates (the client job update and the
-- check reminder) had been approved for days with their senders still on the
-- text message and email fallback, because nobody had asked.
--
-- This schedules one call a day to the function's record-approvals action,
-- which reads every twilio_content_sid_<x>_pending key, asks Twilio where Meta
-- stands, and writes twilio_content_sid_<x> once the answer is approved. It
-- sends nothing, submits nothing, and only ever writes an approved SID.
--
-- The secret is read out of the yaad-job-health cron command inside the
-- database, the same way the hand-run paste does, so the function's gate is
-- unchanged and no secret is written into this file or into a new row.
-- security definer, owned by postgres, is what lets the function read
-- cron.job; it is revoked from every API role below.

create or replace function public.record_meta_template_approvals()
returns bigint
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  j record;
  req bigint;
begin
  select substring(command from '''secret'', ''([^'']*)''')  as secret,
         substring(command from '''apikey'', ''([^'']*)''')  as apikey,
         substring(command from 'url := ''(https://[^/]+)') as base
    into j
    from cron.job
   where jobname = 'yaad-job-health';
  if j.secret is null or j.apikey is null or j.base is null then
    raise warning 'record_meta_template_approvals: yaad-job-health cron job not found, nothing sent';
    return null;
  end if;
  select net.http_post(
    url := j.base || '/functions/v1/yaad-twilio-setup',
    body := jsonb_build_object('action', 'record-approvals', 'secret', j.secret),
    headers := jsonb_build_object('Content-Type', 'application/json', 'apikey', j.apikey, 'Authorization', 'Bearer ' || j.apikey),
    timeout_milliseconds := 60000
  ) into req;
  return req;
end;
$function$;

revoke all on function public.record_meta_template_approvals() from public, anon, authenticated;

comment on function public.record_meta_template_approvals() is
  'Daily: asks yaad-twilio-setup (record-approvals) to record every Meta-approved WhatsApp template in app_settings. Reads the cron secret from cron.job inside the database. Returns the net request id; the reply is in net._http_response.';

-- 09:19 UTC daily. Meta reviews overnight more often than not, so a morning
-- check means a template approved yesterday is live before anyone in Jamaica
-- is at work.
do $do$
begin
  if exists (select 1 from cron.job where jobname = 'yaad-meta-approvals') then
    perform cron.unschedule('yaad-meta-approvals');
  end if;
  perform cron.schedule('yaad-meta-approvals', '19 9 * * *', 'select public.record_meta_template_approvals();');
end
$do$;

-- Proof it is on:
--   select jobname, schedule, active from cron.job where jobname = 'yaad-meta-approvals';
-- To run it now rather than wait for the morning:
--   select public.record_meta_template_approvals();
--   then, after twenty seconds,
--   select id, status_code, content from net._http_response order by id desc limit 3;
--   and look for "checked" and "templates" in the content.
