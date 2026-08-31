-- The stall check starts running. Same shape as yaad-vetting-purge
-- (20260827f): the secret is generated here, kept only as a SHA-256 hash in
-- app_settings, and the plaintext lives in exactly one place, the cron
-- job's own command, which pg_cron holds outside PostgREST's reach.
--
-- 13:00 UTC, 08:00 Jamaica. A morning check, not a middle-of-the-night one:
-- a worker nudged at 3am achieves nothing a nudge at 8am would not, and
-- reads as a company that does not sleep rather than one that is on top of
-- things.

do $do$
declare
  s      text := encode(extensions.gen_random_bytes(32), 'hex');
  fn_url text := 'https://leffyisvfvjwzilydlwf.supabase.co/functions/v1/yaad-job-health';
  pubkey text := 'sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz';
  cmd    text;
begin
  insert into public.app_settings(key, value)
  values ('job_health_cron_secret_sha256', encode(extensions.digest(s, 'sha256'), 'hex'))
  on conflict (key) do update set value = excluded.value;

  cmd := format(
    $c$select net.http_post(
      url := %L,
      body := jsonb_build_object('secret', %L),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', %L,
        'Authorization', 'Bearer ' || %L),
      timeout_milliseconds := 120000)$c$,
    fn_url, s, pubkey, pubkey);

  if exists (select 1 from cron.job where jobname = 'yaad-job-health') then
    perform cron.unschedule('yaad-job-health');
  end if;

  perform cron.schedule('yaad-job-health', '0 13 * * *', cmd);
end
$do$;

comment on table public.app_settings is
  'Small operational settings. purge_cron_secret_sha256, notify_trigger_secret_sha256 and job_health_cron_secret_sha256 are hashes, never the secrets: see 20260827f, 20260831i and 20260831s.';
