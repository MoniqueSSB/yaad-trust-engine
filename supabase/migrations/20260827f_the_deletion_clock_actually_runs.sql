-- The deletion clock starts running.
--
-- yaad-vetting-purge has been written and deployed since 27 Aug 2026 and had
-- never once been called. pg_cron was not installed and nothing else invoked
-- it, so every vetting document carried a purge_after date that nothing ever
-- acted on. The join page told applicants their passport was "destroyed on a
-- clock once vetting is decided" while the clock did not exist.
--
-- Applied 27 Aug 2026. The first run destroyed 11 files, all of them test
-- uploads, and kept all 11 rows.
--
-- ── Why the secret is a hash ──
--
-- The function's own auth accepts YAAD_CRON_SECRET from its environment, or a
-- signed-in admin. The scheduler is neither: it is a pg_cron job inside this
-- database, and it cannot read an Edge Function's environment.
--
-- So the job presents a secret of its own and the function checks it against a
-- SHA-256 hash in app_settings. The database holds nothing usable. The only
-- copy of the plaintext lives in the cron job's command, and the cron schema is
-- not exposed through PostgREST.
--
-- The secret is generated inside the DO block below and never returned to the
-- session that ran it, so it exists in exactly one place and was never in
-- anybody's terminal history. To rotate it, re-run this block: it overwrites
-- the hash and reschedules the job in one transaction.

create extension if not exists pg_cron;
create extension if not exists pg_net    with schema extensions;
create extension if not exists pgcrypto  with schema extensions;

do $do$
declare
  s      text := encode(extensions.gen_random_bytes(32), 'hex');
  fn_url text := 'https://leffyisvfvjwzilydlwf.supabase.co/functions/v1/yaad-vetting-purge';
  -- Publishable key, public by design and already shipped in the browser
  -- bundle. It is here to satisfy the gateway's verify_jwt, not to authorise
  -- anything: the secret above is what actually authorises the purge.
  pubkey text := 'sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz';
  cmd    text;
begin
  insert into public.app_settings(key, value)
  values ('purge_cron_secret_sha256', encode(extensions.digest(s, 'sha256'), 'hex'))
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

  if exists (select 1 from cron.job where jobname = 'yaad-vetting-purge') then
    perform cron.unschedule('yaad-vetting-purge');
  end if;

  -- 03:17 UTC daily. Off the hour on purpose: everything else in the world
  -- fires on the hour and a purge does not need to queue behind it.
  perform cron.schedule('yaad-vetting-purge', '17 3 * * *', cmd);
end
$do$;

comment on table public.app_settings is
  'Small operational settings. purge_cron_secret_sha256 is a hash, never the secret: see 20260827f.';

-- Proof it is on:
--   select jobname, schedule, active from cron.job;
--   select status_code, content, created from net._http_response order by created desc limit 5;
--   select count(*) from public.vetting_documents
--    where purge_after <= now() and purged_at is null and storage_path is not null;  -- expect 0 after 03:17
