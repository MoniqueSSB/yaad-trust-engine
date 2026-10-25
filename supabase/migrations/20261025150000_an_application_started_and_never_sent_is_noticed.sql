-- An application started and never sent is noticed. 25 October 2026.
--
-- Found that morning from a screen recording: every worker who tapped Send
-- my application since 5 September had been refused with a database error
-- (a column the live function wrote and production did not have). Three
-- real people sat at status started, one of them for five weeks, and nothing
-- on the desk or the phone said so, because every count and every reminder
-- starts at status received. Somebody who gets as far as uploading documents
-- and then disappears is a lead who was lost, whichever side the fault is on.
--
-- Now, once, 48 hours after an application is opened and still at started,
-- with a phone number or an email on it: the applicant is reminded to finish
-- sending (yaad-notify-client, kind worker_send_reminder: WhatsApp inside
-- the window, text message outside it, email where there is one) and the
-- desk's phone is pushed the reference, trade and parish. Never a second
-- time; after that it is a person's call, from the Applications view, which
-- lists them under "Started, never sent" from the same day.
--
-- This function decides WHO is due and records that they were sent to. It
-- writes no message and decides nothing about the application. Test rows
-- are at status test, so they never match.

alter table public.applications
  add column if not exists send_reminders int not null default 0,
  add column if not exists send_reminded_at timestamptz;

comment on column public.applications.send_reminders is
  'How many "finish sending your application" reminders have gone out to an application still at started. One at most, sent by remind_unsent_applications().';

create or replace function public.remind_unsent_applications()
returns int
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r record;
  n int := 0;
begin
  for r in
    select a.id
      from applications a
     where a.status = 'started'
       and a.send_reminders = 0
       and a.created_at < now() - interval '48 hours'
       and (coalesce(a.phone, '') <> '' or coalesce(a.email, '') <> '')
     order by a.created_at
     limit 50
  loop
    update applications
       set send_reminders = send_reminders + 1,
           send_reminded_at = now()
     where id = r.id;
    perform net.http_post(
      url := 'https://leffyisvfvjwzilydlwf.supabase.co/functions/v1/yaad-notify-client',
      body := jsonb_build_object('secret', public.notify_trigger_secret(), 'applicationId', r.id, 'kind', 'worker_send_reminder'),
      headers := jsonb_build_object('Content-Type','application/json','apikey','sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz','Authorization','Bearer '||'sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz'),
      timeout_milliseconds := 15000
    );
    n := n + 1;
  end loop;
  return n;
end;
$function$;

revoke all on function public.remind_unsent_applications() from public, anon, authenticated;

-- 15:12 UTC daily, five minutes after the check reminders: 10am in Jamaica.
do $do$
begin
  if exists (select 1 from cron.job where jobname = 'yaad-send-reminders') then
    perform cron.unschedule('yaad-send-reminders');
  end if;
  perform cron.schedule('yaad-send-reminders', '12 15 * * *', 'select public.remind_unsent_applications();');
end
$do$;

-- Proof it is on:
--   select jobname, schedule, active from cron.job where jobname = 'yaad-send-reminders';
--   select app_id, status, send_reminders, send_reminded_at from applications where status = 'started' order by created_at;
