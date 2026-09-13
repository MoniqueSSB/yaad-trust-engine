-- The shared secret every trigger sends to yaad-notify-client used to be
-- baked into nine trigger function bodies as a literal, and two migrations
-- in this public repository (20260901g and 20260902c) pasted the real value
-- into the file instead of extracting it from the live function. Treat that
-- value as public: git history keeps it forever, so rotation, not deletion,
-- is the fix (RUNBOOK.md §6, "A key has been exposed").
--
-- Where it lives now: ONE Supabase Vault entry, notify_trigger_secret,
-- generated INSIDE Postgres so the plaintext never leaves the database, and
-- ONE locked helper, public.notify_trigger_secret(), that reads it. The nine
-- functions below call the helper at fire time; their bodies are otherwise
-- the exact live bodies read back from pg_proc before this was written
-- (RUNBOOK.md: read the live source back, every time). The three Edge
-- Functions that call the hub from outside a trigger (yaad-job-health,
-- yaad-followup-check, yaad-evidence-landed-check) call the same helper over
-- RPC with the service role key, so YAAD_CRON_SECRET no longer has to equal
-- this value and the "environment secret drifted from the hash" failure
-- recorded in RUNBOOK.md cannot recur.
--
-- This file contains no secret and never will. A new trigger that needs to
-- call yaad-notify-client writes   'secret', public.notify_trigger_secret()
-- and nothing else. Never extract a value from prosrc again: there is nothing
-- there to extract.

create extension if not exists supabase_vault with schema vault;

-- ── 1. The safe. Create the entry only if it is not there already, so a
--       re-run never silently rotates a working secret. ────────────────────
do $do$
begin
  if not exists (select 1 from vault.secrets where name = 'notify_trigger_secret') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'notify_trigger_secret',
      'Shared secret the notify triggers and the cron notifiers send to yaad-notify-client. '
      || 'Created 3 Sep 2026 after the previous value was committed to the public repository. '
      || 'To rotate: update this entry with a fresh value, then re-run the hash sync in RUNBOOK.md '
      || '("The notify trigger secret gets out of sync"). Nothing else needs touching.'
    );
  end if;
end $do$;

-- ── 2. The one key to the safe. SECURITY DEFINER so a trigger (which runs
--       as the row's writer) can read the Vault through it; executable by
--       the service role, which the three cron notifiers hold, and by nobody
--       who reaches the database from a browser. ───────────────────────────
create or replace function public.notify_trigger_secret()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select decrypted_secret
    from vault.decrypted_secrets
   where name = 'notify_trigger_secret'
   limit 1
$$;

revoke all on function public.notify_trigger_secret() from public, anon, authenticated;
grant execute on function public.notify_trigger_secret() to service_role;

comment on function public.notify_trigger_secret() is
  'The plaintext yaad-notify-client checks a caller against, read from Vault. '
  'Callable by triggers and the service role only. Never grant to anon or authenticated. '
  'See 20260903a.';

do $do$
begin
  if has_function_privilege('anon', 'public.notify_trigger_secret()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.notify_trigger_secret()', 'EXECUTE') then
    raise exception 'notify_trigger_secret() must not be executable by anon or authenticated.';
  end if;
end $do$;

-- ── 3. The hash the Edge Function compares against, resynced from the
--       Vault value in the same transaction that switches the triggers, so
--       there is no moment where a trigger sends one value and the hub
--       expects another. ─────────────────────────────────────────────────────
do $do$
declare
  s text := public.notify_trigger_secret();
begin
  if s is null or length(s) < 32 then
    raise exception 'notify_trigger_secret is missing from Vault. Refusing to switch the triggers to it.';
  end if;
  insert into public.app_settings (key, value)
  values ('notify_trigger_secret_sha256', encode(extensions.digest(s, 'sha256'), 'hex'))
  on conflict (key) do update set value = excluded.value;
end $do$;

-- ── 4. The nine callers, live bodies verbatim, literal replaced. ──────────

create or replace function public.notify_client_quote_arrived()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fn$
    begin
      if new.status = 'submitted' then
        perform net.http_post(
          url := 'https://leffyisvfvjwzilydlwf.supabase.co/functions/v1/yaad-notify-client',
          body := jsonb_build_object('secret', public.notify_trigger_secret(), 'jobId', new.job_id, 'kind', 'quote_arrived'),
          headers := jsonb_build_object('Content-Type','application/json','apikey','sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz','Authorization','Bearer '||'sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz'),
          timeout_milliseconds := 15000
        );
      end if;
      return new;
    end;
$fn$;

create or replace function public.notify_client_on_job_change()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fn$
    begin
      if coalesce(new.stage,0) > coalesce(old.stage,0)
         and exists (select 1 from public.stage_approvals a where a.job_id = new.id and a.stage = new.stage - 1)
      then
        perform net.http_post(
          url := 'https://leffyisvfvjwzilydlwf.supabase.co/functions/v1/yaad-notify-client',
          body := jsonb_build_object('secret', public.notify_trigger_secret(), 'jobId', new.id, 'kind', 'stage_released'),
          headers := jsonb_build_object('Content-Type','application/json','apikey','sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz','Authorization','Bearer '||'sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz'),
          timeout_milliseconds := 15000
        );
      end if;

      if new.status = 'complete' and coalesce(old.status, '') is distinct from 'complete' then
        perform net.http_post(
          url := 'https://leffyisvfvjwzilydlwf.supabase.co/functions/v1/yaad-notify-client',
          body := jsonb_build_object('secret', public.notify_trigger_secret(), 'jobId', new.id, 'kind', 'stage_released_worker'),
          headers := jsonb_build_object('Content-Type','application/json','apikey','sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz','Authorization','Bearer '||'sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz'),
          timeout_milliseconds := 15000
        );
      end if;

      if new.walk_call_notes is not null
         and old.walk_call_notes is distinct from new.walk_call_notes
      then
        perform net.http_post(
          url := 'https://leffyisvfvjwzilydlwf.supabase.co/functions/v1/yaad-notify-client',
          body := jsonb_build_object('secret', public.notify_trigger_secret(), 'jobId', new.id, 'kind', 'walkthrough_notes_ready'),
          headers := jsonb_build_object('Content-Type','application/json','apikey','sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz','Authorization','Bearer '||'sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz'),
          timeout_milliseconds := 15000
        );
      end if;

      return new;
    end;
$fn$;

create or replace function public.notify_client_dispute_raised()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fn$
    begin
      perform net.http_post(
        url := 'https://leffyisvfvjwzilydlwf.supabase.co/functions/v1/yaad-notify-client',
        body := jsonb_build_object('secret', public.notify_trigger_secret(), 'jobId', new.job_id, 'kind', 'dispute_raised'),
        headers := jsonb_build_object('Content-Type','application/json','apikey','sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz','Authorization','Bearer '||'sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz'),
        timeout_milliseconds := 15000
      );
      return new;
    end;
$fn$;

create or replace function public.notify_client_service_change()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fn$
    declare
      v_kind text := null;
    begin
      if tg_op = 'INSERT' then
        if new.status = 'held' then
          v_kind := 'service_booked';
        end if;
      else
        if new.status = 'awaiting_payment' and coalesce(old.status,'') is distinct from 'awaiting_payment' then
          v_kind := 'service_confirmed';
        elsif new.status = 'live' and coalesce(old.status,'') is distinct from 'live' then
          v_kind := 'service_live';
        end if;
      end if;

      if v_kind is not null then
        perform net.http_post(
          url := 'https://leffyisvfvjwzilydlwf.supabase.co/functions/v1/yaad-notify-client',
          body := jsonb_build_object('secret', public.notify_trigger_secret(), 'serviceId', new.id, 'kind', v_kind),
          headers := jsonb_build_object('Content-Type','application/json','apikey','sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz','Authorization','Bearer '||'sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz'),
          timeout_milliseconds := 15000
        );
      end if;

      return new;
    end;
$fn$;

create or replace function public.notify_client_worker_arrived()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fn$
    begin
      perform net.http_post(
        url := 'https://leffyisvfvjwzilydlwf.supabase.co/functions/v1/yaad-notify-client',
        body := jsonb_build_object('secret', public.notify_trigger_secret(), 'jobId', new.job_id, 'kind', 'worker_on_site'),
        headers := jsonb_build_object('Content-Type','application/json','apikey','sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz','Authorization','Bearer '||'sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz'),
        timeout_milliseconds := 15000
      );
      return new;
    end;
$fn$;

create or replace function public.notify_worker_kickoff_pack_ready()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fn$
    begin
      if coalesce(old.status,'') is distinct from 'approved' and new.status = 'approved' then
        perform net.http_post(
          url := 'https://leffyisvfvjwzilydlwf.supabase.co/functions/v1/yaad-notify-client',
          body := jsonb_build_object(
            'secret', public.notify_trigger_secret(),
            'jobId', new.job_id,
            'kind', 'kickoff_pack_ready',
            'meta', jsonb_build_object('quoteId', new.quote_id)
          ),
          headers := jsonb_build_object('Content-Type','application/json','apikey','sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz','Authorization','Bearer '||'sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz'),
          timeout_milliseconds := 15000
        );
      end if;
      return new;
    end;
$fn$;

create or replace function public.notify_worker_of_portal_comment()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fn$
    begin
      if new.from_role = 'client' and new.origin = 'portal' then
        perform net.http_post(
          url := 'https://leffyisvfvjwzilydlwf.supabase.co/functions/v1/yaad-notify-client',
          body := jsonb_build_object('secret', public.notify_trigger_secret(), 'jobId', new.job_id, 'kind', 'evidence_comment', 'meta', jsonb_build_object('comment_id', new.id)),
          headers := jsonb_build_object('Content-Type','application/json','apikey','sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz','Authorization','Bearer '||'sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz'),
          timeout_milliseconds := 15000
        );
      end if;
      return new;
    end;
$fn$;

create or replace function public.notify_worker_quote_awaits_confirm()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fn$
begin
  if new.status = 'submitted' then
    perform net.http_post(
      url := 'https://leffyisvfvjwzilydlwf.supabase.co/functions/v1/yaad-notify-client',
      body := jsonb_build_object(
        'secret', public.notify_trigger_secret(),
        'jobId', new.job_id,
        'kind', 'quote_awaiting_worker_confirm',
        'meta', jsonb_build_object('quoteId', new.id)
      ),
      headers := jsonb_build_object('Content-Type','application/json','apikey','sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz','Authorization','Bearer '||'sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz'),
      timeout_milliseconds := 15000
    );
  end if;
  return new;
end;
$fn$;

-- Not a trigger: called by yaad-inbound over RPC with the service role key
-- once a worker confirms the drafted report. Same secret, same helper.
create or replace function public.relay_confirmed_report(p_job text, p_override_text text, p_ai_summary text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $fn$
    begin
      perform net.http_post(
        url := 'https://leffyisvfvjwzilydlwf.supabase.co/functions/v1/yaad-notify-client',
        body := jsonb_build_object(
          'secret', public.notify_trigger_secret(), 'jobId', p_job, 'kind', 'evidence_report_confirmed',
          'meta', jsonb_build_object('override_text', p_override_text, 'ai_summary', p_ai_summary)
        ),
        headers := jsonb_build_object('Content-Type','application/json','apikey','sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz','Authorization','Bearer '||'sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz'),
        timeout_milliseconds := 28000
      );
    end;
$fn$;

-- ── 5. Prove it: no function that talks to the hub still carries a
--       64-character hex literal, and every one of them now names the
--       helper. A migration that leaves one behind must fail here, loudly.
do $do$
declare
  leftover text;
  missing  text;
begin
  select string_agg(proname, ', ') into leftover
    from pg_proc
   where prosrc like '%yaad-notify-client%'
     and prosrc ~ '''secret'', ''[0-9a-f]{64}''';
  if leftover is not null then
    raise exception 'Still carrying a secret literal: %', leftover;
  end if;

  select string_agg(proname, ', ') into missing
    from pg_proc
   where prosrc like '%yaad-notify-client%'
     and prosrc not like '%public.notify_trigger_secret()%';
  if missing is not null then
    raise exception 'Calls yaad-notify-client without the helper: %', missing;
  end if;
end $do$;

comment on table public.app_settings is
  'Small operational settings. The *_secret_sha256 rows are hashes, never the secret. '
  'notify_trigger_secret_sha256 is the hash of the Vault entry notify_trigger_secret, '
  'read through public.notify_trigger_secret(); see 20260903a. The cron-only secrets '
  '(purge, job_health, followup, evidence_landed_check, kickoff_check, quote_pack_check, '
  'daily_checkin) keep their plaintext in the matching cron.job command only.';
