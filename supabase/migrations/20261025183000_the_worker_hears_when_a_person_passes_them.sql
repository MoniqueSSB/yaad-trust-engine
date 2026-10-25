-- The worker hears when a person at the desk passes their application.
-- 25 October 2026.
--
-- Until now Pass recorded a decision and sent nothing. The worker found out
-- days later when the profile was published, if a TRN and an ID check had
-- not stalled it first. Founder, 25 Oct 2026: "when i press pass does an
-- email go to them". The same shape as trg_worker_cleared (20260930100000):
-- fires once, on the change to passed, and asks yaad-notify-client (kind
-- worker_passed) to send. The function reads the row again and refuses
-- unless the status really is passed, so this trigger can only ever cause a
-- true message. Nothing is sent to anybody else. Gap and Block stay silent
-- on purpose: a gap names a document, a block is a safety finding, and both
-- are the desk's own words to send from Reach them.

create or replace function public.notify_application_passed()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.status = 'passed'
     and old.status is distinct from new.status
  then
    perform net.http_post(
      url := 'https://leffyisvfvjwzilydlwf.supabase.co/functions/v1/yaad-notify-client',
      body := jsonb_build_object('secret', public.notify_trigger_secret(), 'applicationId', new.id, 'kind', 'worker_passed'),
      headers := jsonb_build_object('Content-Type','application/json','apikey','sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz','Authorization','Bearer '||'sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz'),
      timeout_milliseconds := 15000
    );
  end if;
  return new;
end;
$function$;

revoke all on function public.notify_application_passed() from public, anon, authenticated;

drop trigger if exists trg_application_passed on public.applications;
create trigger trg_application_passed
  after update on public.applications
  for each row execute function public.notify_application_passed();

comment on trigger trg_application_passed on public.applications is
  'Tells the applicant, once, when a person passes them. Fires only on the change to passed. Gap and Block send nothing: those are the desk''s own words. Sends nothing to anybody else.';
