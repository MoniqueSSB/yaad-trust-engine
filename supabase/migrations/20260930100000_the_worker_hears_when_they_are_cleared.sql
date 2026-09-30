-- The worker hears when a person publishes them. 30 Sep 2026.
--
-- Founder: "Nothing tells them they are cleared", "fix this all". Until now a
-- worker applied, did their checks, and the desk's Publish click sent nothing.
-- This fires yaad-notify-client with kind worker_cleared the moment
-- worker_profiles.active flips to true. It runs AFTER the row is written, so
-- trg_profile_publish_checks (a BEFORE trigger, 20260830c) has already
-- refused anything without an approved ID check, an approved TRN and an
-- email; a message this sends is therefore only ever true. The function
-- reads the phone and the name off the row itself and sends one message to
-- the worker: what happens now, and where the portal is. It sends nothing to
-- anybody else and decides nothing.
--
-- Same shape as every notify trigger since 20260903a: the secret comes from
-- the vault through notify_trigger_secret(), never from this file.

create or replace function public.notify_worker_cleared()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.active is true
     and old.active is distinct from new.active
     and coalesce(new.worker_email, '') <> ''
  then
    perform net.http_post(
      url := 'https://leffyisvfvjwzilydlwf.supabase.co/functions/v1/yaad-notify-client',
      body := jsonb_build_object('secret', public.notify_trigger_secret(), 'workerEmail', new.worker_email, 'kind', 'worker_cleared'),
      headers := jsonb_build_object('Content-Type','application/json','apikey','sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz','Authorization','Bearer '||'sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz'),
      timeout_milliseconds := 15000
    );
  end if;
  return new;
end;
$function$;

revoke all on function public.notify_worker_cleared() from public, anon, authenticated;

drop trigger if exists trg_worker_cleared on public.worker_profiles;
create trigger trg_worker_cleared
  after update on public.worker_profiles
  for each row execute function public.notify_worker_cleared();

comment on trigger trg_worker_cleared on public.worker_profiles is
  'Tells the worker, once, when a person publishes them. Fires only when active flips to true, after the publish gate has let it. Sends nothing to anybody else.';
