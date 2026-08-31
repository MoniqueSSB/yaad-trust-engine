-- The follow-up check starts running. Same shape as yaad-job-health's own
-- cron wiring (20260831s): a fresh secret generated here, kept only as a
-- SHA-256 hash in app_settings, plaintext living in exactly one place, the
-- cron job's own command. This is a genuinely new, independent secret for
-- a genuinely new cron target, not a case where the "never regenerate"
-- warning elsewhere in this file applies: that warning is about the ONE
-- shared secret several trigger functions all check against, and minting
-- a fresh key for a target that has never had one before is exactly how
-- job_health_cron_secret_sha256 was created too.
--
-- 14:00 UTC, one hour after yaad-job-health's 13:00, so the two daily
-- checks do not land in the same minute for no reason.

do $do$
declare
  s      text := encode(extensions.gen_random_bytes(32), 'hex');
  fn_url text := 'https://leffyisvfvjwzilydlwf.supabase.co/functions/v1/yaad-followup-check';
  pubkey text := 'sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz';
  cmd    text;
begin
  insert into public.app_settings(key, value)
  values ('followup_cron_secret_sha256', encode(extensions.digest(s, 'sha256'), 'hex'))
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

  if exists (select 1 from cron.job where jobname = 'yaad-followup-check') then
    perform cron.unschedule('yaad-followup-check');
  end if;

  perform cron.schedule('yaad-followup-check', '0 14 * * *', cmd);
end
$do$;

comment on table public.app_settings is
  'Small operational settings. purge_cron_secret_sha256, notify_trigger_secret_sha256, job_health_cron_secret_sha256 and followup_cron_secret_sha256 are hashes, never the secrets: see 20260827f, 20260831i, 20260831s and 20260831zzzz4.';
