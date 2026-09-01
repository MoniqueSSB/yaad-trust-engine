-- Quote Kickoff Pack, step 3 of 3: the automatic trigger starts running.
-- Same shape as kickoff_check_cron_secret_sha256 (20260831zzzz15): a fresh
-- secret generated here, kept only as a SHA-256 hash in app_settings, the
-- plaintext living in exactly one place, this cron job's own command.
--
-- Once a minute: a job going live should not wait on a daily cron before a
-- worker sees anything but a blank quote form.
--
-- Requires yaad-quote-pack-check and yaad-quote-pack deployed from disk
-- first (CLAUDE.md §12); this migration only wires the schedule.
do $do$
declare
  s      text := encode(extensions.gen_random_bytes(32), 'hex');
  fn_url text := 'https://leffyisvfvjwzilydlwf.supabase.co/functions/v1/yaad-quote-pack-check';
  pubkey text := 'sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz';
  cmd    text;
begin
  insert into public.app_settings(key, value)
  values ('quote_pack_check_cron_secret_sha256', encode(extensions.digest(s, 'sha256'), 'hex'))
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

  if exists (select 1 from cron.job where jobname = 'yaad-quote-pack-check') then
    perform cron.unschedule('yaad-quote-pack-check');
  end if;

  perform cron.schedule('yaad-quote-pack-check', '* * * * *', cmd);
end
$do$;

comment on table public.app_settings is
  'Small operational settings. purge_cron_secret_sha256, notify_trigger_secret_sha256, job_health_cron_secret_sha256, followup_cron_secret_sha256, evidence_landed_check_cron_secret_sha256, kickoff_check_cron_secret_sha256 and quote_pack_check_cron_secret_sha256 are hashes, never the secrets: see 20260827f, 20260831i, 20260831s, 20260831zzzz4, 20260831zzzz7, 20260831zzzz15 and this migration.';
