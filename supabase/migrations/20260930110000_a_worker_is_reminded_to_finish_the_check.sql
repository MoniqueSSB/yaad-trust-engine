-- A worker is reminded to finish their check. 30 Sep 2026.
--
-- Founder, on being told "nothing automatic reminds them": "yes fix this".
-- Somebody who applies and never does the ID check, the TRN, the referees
-- and the Guidelines stays a lead for ever, hearing about jobs they cannot
-- quote on. Now they are reminded twice: three days after applying, and a
-- week after that. Never a third time; after that it is a person's call.
--
-- The reminder goes out through yaad-notify-client (kind
-- worker_check_reminder), which sends WhatsApp inside the 24 hour window,
-- SMS outside it, and email where there is one, with the link that opens
-- the application on the site. This function only decides WHO is due and
-- records that they were sent to; it writes no message and decides nothing
-- about the application.
--
-- Who is due: status received, not published (no active worker_profile on
-- the application), the identity check not yet approved. Somebody whose ID
-- is approved but whose TRN is not is a desk matter, not a reminder matter.

alter table public.applications
  add column if not exists check_reminders int not null default 0,
  add column if not exists check_reminded_at timestamptz;

comment on column public.applications.check_reminders is
  'How many "finish your check" reminders have gone out. Two at most, sent by remind_unfinished_applications().';

create or replace function public.remind_unfinished_applications()
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
     where a.status = 'received'
       and a.check_reminders < 2
       and coalesce(a.persona_status, '') not in ('approved', 'completed')
       and not exists (select 1 from worker_profiles p where p.application_id = a.id and p.active is true)
       and (
             (a.check_reminders = 0 and a.created_at < now() - interval '3 days')
          or (a.check_reminders = 1 and a.check_reminded_at < now() - interval '7 days')
       )
     order by a.created_at
     limit 50
  loop
    update applications
       set check_reminders = check_reminders + 1,
           check_reminded_at = now()
     where id = r.id;
    perform net.http_post(
      url := 'https://leffyisvfvjwzilydlwf.supabase.co/functions/v1/yaad-notify-client',
      body := jsonb_build_object('secret', public.notify_trigger_secret(), 'applicationId', r.id, 'kind', 'worker_check_reminder'),
      headers := jsonb_build_object('Content-Type','application/json','apikey','sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz','Authorization','Bearer '||'sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz'),
      timeout_milliseconds := 15000
    );
    n := n + 1;
  end loop;
  return n;
end;
$function$;

revoke all on function public.remind_unfinished_applications() from public, anon, authenticated;

-- 15:07 UTC daily: 10am in Jamaica, 4pm in London in summer, 3pm in winter.
-- A reminder about a form is a daytime message.
do $do$
begin
  if exists (select 1 from cron.job where jobname = 'yaad-check-reminders') then
    perform cron.unschedule('yaad-check-reminders');
  end if;
  perform cron.schedule('yaad-check-reminders', '7 15 * * *', 'select public.remind_unfinished_applications();');
end
$do$;

-- Proof it is on:
--   select jobname, schedule, active from cron.job where jobname = 'yaad-check-reminders';
--   select app_id, check_reminders, check_reminded_at from applications order by created_at desc limit 5;
