-- The evidence-landed debounce check starts running.
--
-- Same shape as yaad-job-health (20260831s) and yaad-followup-check
-- (20260831zzzz4): a fresh secret generated here, kept only as a SHA-256
-- hash in app_settings, plaintext living in exactly one place, this cron
-- job's own command. A genuinely new target gets a genuinely new secret,
-- the same reasoning zzzz4 used.
--
-- Once a minute, not once a day: the 90-second quiet window
-- (20260831zzzz6) needs checking on a timescale a client would actually
-- notice, unlike the daily stall and follow-up checks, which are watching
-- for silence over hours, not seconds.

do $do$
declare
  s      text := encode(extensions.gen_random_bytes(32), 'hex');
  fn_url text := 'https://leffyisvfvjwzilydlwf.supabase.co/functions/v1/yaad-evidence-landed-check';
  pubkey text := 'sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz';
  cmd    text;
begin
  insert into public.app_settings(key, value)
  values ('evidence_landed_check_cron_secret_sha256', encode(extensions.digest(s, 'sha256'), 'hex'))
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

  if exists (select 1 from cron.job where jobname = 'yaad-evidence-landed-check') then
    perform cron.unschedule('yaad-evidence-landed-check');
  end if;

  perform cron.schedule('yaad-evidence-landed-check', '* * * * *', cmd);
end
$do$;

comment on table public.app_settings is
  'Small operational settings. purge_cron_secret_sha256, notify_trigger_secret_sha256, job_health_cron_secret_sha256, followup_cron_secret_sha256 and evidence_landed_check_cron_secret_sha256 are hashes, never the secrets: see 20260827f, 20260831i, 20260831s, 20260831zzzz4 and 20260831zzzz7.';
