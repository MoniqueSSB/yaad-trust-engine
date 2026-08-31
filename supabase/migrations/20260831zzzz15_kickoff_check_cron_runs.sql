-- Kickoff Pack dual agreement, step 4 of 5, last piece: the automatic
-- trigger starts running. Same shape as yaad-evidence-landed-check
-- (20260831zzzz7): a fresh secret generated here, kept only as a SHA-256
-- hash in app_settings, the plaintext living in exactly one place, this
-- cron job's own command. A genuinely new target gets a genuinely new
-- secret, never the shared notify-trigger one.
--
-- Once a minute: a client who just accepted a quote should not be waiting
-- on a daily cron to find out their pack is coming.
--
-- Requires yaad-kickoff-check deployed (supabase/functions/yaad-kickoff-check)
-- and yaad-kickoff's own auth updated to accept a service-role caller
-- alongside a real admin session (see that function's own comment). Both
-- confirmed live: the first real run of this schedule drafted, guardrail-
-- checked and auto-issued a genuine Kickoff Pack for a test job with no
-- manual step anywhere in the chain, cover note read back and sane, then
-- deleted along with every other piece of test data used to prove it.
do $do$
declare
  s      text := encode(extensions.gen_random_bytes(32), 'hex');
  fn_url text := 'https://leffyisvfvjwzilydlwf.supabase.co/functions/v1/yaad-kickoff-check';
  pubkey text := 'sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz';
  cmd    text;
begin
  insert into public.app_settings(key, value)
  values ('kickoff_check_cron_secret_sha256', encode(extensions.digest(s, 'sha256'), 'hex'))
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

  if exists (select 1 from cron.job where jobname = 'yaad-kickoff-check') then
    perform cron.unschedule('yaad-kickoff-check');
  end if;

  perform cron.schedule('yaad-kickoff-check', '* * * * *', cmd);
end
$do$;

comment on table public.app_settings is
  'Small operational settings. purge_cron_secret_sha256, notify_trigger_secret_sha256, job_health_cron_secret_sha256, followup_cron_secret_sha256, evidence_landed_check_cron_secret_sha256 and kickoff_check_cron_secret_sha256 are hashes, never the secrets: see 20260827f, 20260831i, 20260831s, 20260831zzzz4, 20260831zzzz7 and this migration.';
