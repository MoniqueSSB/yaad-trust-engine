-- The staging prefix in the evidence bucket gets a sweep.
--
-- yaad-inbound stages an inbound WhatsApp photo at evidence/_pending/<uuid>
-- before it knows which job it belongs to, and MOVES it to <job_id>/<uuid>
-- once the worker has answered the job code, the "what does this show"
-- question and the before/after question. A move is a rename, so anything
-- left under _pending/ is evidence nobody ever answered for. Nothing removed
-- those. No row pointed at them and nothing swept the prefix.
--
-- Checked live on 5 September 2026, before writing any of this: the prefix
-- held ZERO objects. That is the honest number and it is the reason this is
-- scheduled rather than run once by hand. There is nothing to clean up today;
-- the leak starts when real workers start abandoning conversations, which is
-- December's traffic, not August's. A purge written now and called by nobody
-- is exactly the failure 20260827f exists to record, so the schedule goes on
-- at the same time as the function.
--
-- ── Why this file is stamped 6 September when it was written on the 5th ──
--
-- Migrations must sort last (CLAUDE.md 12, scripts/check-migration-order.mjs),
-- and the legacy letter-named files of 5 September sort AFTER any 14-digit
-- stamp from the same day, because '0' sorts before 'a'. So the timestamp
-- files on main have all moved to 6 September, and this one follows them. The
-- stamp is a sort key that clears the letter files, not a claim about when it
-- was written. The odd minute is deliberate too: parallel sessions that both
-- reach for the obvious next number collide, which is the whole reason the
-- letter scheme was abandoned.
--
-- ── The secret ──
--
-- Same shape as 20260827f, deliberately, rather than a second pattern: the
-- pg_cron job lives inside this database and cannot read an Edge Function's
-- environment, so it presents a secret of its own and the function checks it
-- against a SHA-256 hash in app_settings. The database holds nothing usable.
-- The only copy of the plaintext is in the cron job command, and the cron
-- schema is not exposed through PostgREST. It is generated inside the DO block
-- and never returned to the session that ran it. To rotate, re-run the block.
--
-- Its own secret rather than sharing the purge's: rotating one job's key
-- should not silently break the other.

create extension if not exists pg_cron;
create extension if not exists pg_net    with schema extensions;
create extension if not exists pgcrypto  with schema extensions;

do $do$
declare
  s      text := encode(extensions.gen_random_bytes(32), 'hex');
  fn_url text := 'https://leffyisvfvjwzilydlwf.supabase.co/functions/v1/yaad-evidence-sweep';
  -- Publishable key, public by design and already shipped in the browser
  -- bundle. It is here to satisfy the gateway's verify_jwt, not to authorise
  -- anything: the secret above is what actually authorises the sweep.
  pubkey text := 'sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz';
  cmd    text;
begin
  insert into public.app_settings(key, value)
  values ('evidence_sweep_cron_secret_sha256', encode(extensions.digest(s, 'sha256'), 'hex'))
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

  if exists (select 1 from cron.job where jobname = 'yaad-evidence-sweep') then
    perform cron.unschedule('yaad-evidence-sweep');
  end if;

  -- 04:23 UTC daily. Off the hour for the same reason as the purge, and an
  -- hour clear of it so two housekeeping jobs are never in flight together.
  perform cron.schedule('yaad-evidence-sweep', '23 4 * * *', cmd);
end
$do$;

comment on table public.app_settings is
  'Small operational settings. purge_cron_secret_sha256 and evidence_sweep_cron_secret_sha256 are hashes, never the secrets: see 20260827f and 20260906013700.';

-- Proof it is on:
--   select jobname, schedule, active from cron.job;
--   select status_code, content, created from net._http_response order by created desc limit 5;
