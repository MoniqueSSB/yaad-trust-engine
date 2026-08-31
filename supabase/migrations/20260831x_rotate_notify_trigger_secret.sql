-- Rotates the shared secret from 20260831i after its plaintext appeared in a
-- Claude Code session's own tool output (pg_get_functiondef against
-- notify_client_on_job_change, run to read trigger logic, returns the whole
-- function body including the literal). The database still holds nothing
-- usable on its own once this runs; the exposed value stops working.
--
-- Four function bodies carry this secret today, not the three RUNBOOK.md
-- describes: notify_client_quote_arrived (20260831i), notify_client_on_job_change
-- (20260831i, extended in j and o), notify_client_dispute_raised (20260831i),
-- and notify_client_worker_arrived (20260831m), added after RUNBOOK.md's
-- rotation section was written. All four are rewritten together here so none
-- of them go on trusting the old value.
--
-- yaad-job-health also holds a fifth copy, as the Edge Function secret
-- YAAD_CRON_SECRET: it presents this same plaintext to authenticate its own
-- calls into yaad-notify-client for job_delayed. That copy lives outside
-- Postgres, so this migration cannot update it directly. The new plaintext
-- is generated here and only ever leaves this database once, encrypted, via
-- Supabase Vault, for a human to move into YAAD_CRON_SECRET by hand. See
-- RUNBOOK.md's rotation section for the exact steps and why it works this
-- way.

do $do$
declare
  s      text := encode(extensions.gen_random_bytes(32), 'hex');
  fn_url text := 'https://leffyisvfvjwzilydlwf.supabase.co/functions/v1/yaad-notify-client';
  pubkey text := 'sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz';
begin
  insert into public.app_settings(key, value)
  values ('notify_trigger_secret_sha256', encode(extensions.digest(s, 'sha256'), 'hex'))
  on conflict (key) do update set value = excluded.value;

  -- ── quote arrived ────────────────────────────────────────────────────
  execute format($f$
    create or replace function public.notify_client_quote_arrived()
    returns trigger
    language plpgsql
    security definer
    set search_path to 'public'
    as $fn$
    begin
      if new.status = 'submitted' then
        perform net.http_post(
          url := %L,
          body := jsonb_build_object('secret', %L, 'jobId', new.job_id, 'kind', 'quote_arrived'),
          headers := jsonb_build_object('Content-Type','application/json','apikey',%L,'Authorization','Bearer '||%L),
          timeout_milliseconds := 15000
        );
      end if;
      return new;
    end;
    $fn$;
  $f$, fn_url, s, pubkey, pubkey);

  -- ── evidence landed, stage released, walkthrough notes ready ──────────
  -- Current shape, per 20260831o: three transitions on the same jobs row.
  -- stage_released keys off new.stage - 1, the 20260831j fix, not old.stage.
  execute format($f$
    create or replace function public.notify_client_on_job_change()
    returns trigger
    language plpgsql
    security definer
    set search_path to 'public'
    as $fn$
    begin
      if coalesce(old.status,'') is distinct from 'evidence' and new.status = 'evidence' then
        perform net.http_post(
          url := %L,
          body := jsonb_build_object('secret', %L, 'jobId', new.id, 'kind', 'evidence_landed'),
          headers := jsonb_build_object('Content-Type','application/json','apikey',%L,'Authorization','Bearer '||%L),
          timeout_milliseconds := 15000
        );
      end if;

      if coalesce(new.stage,0) > coalesce(old.stage,0)
         and exists (select 1 from public.stage_approvals a where a.job_id = new.id and a.stage = new.stage - 1)
      then
        perform net.http_post(
          url := %L,
          body := jsonb_build_object('secret', %L, 'jobId', new.id, 'kind', 'stage_released'),
          headers := jsonb_build_object('Content-Type','application/json','apikey',%L,'Authorization','Bearer '||%L),
          timeout_milliseconds := 15000
        );
      end if;

      if new.walk_call_notes is not null
         and old.walk_call_notes is distinct from new.walk_call_notes
      then
        perform net.http_post(
          url := %L,
          body := jsonb_build_object('secret', %L, 'jobId', new.id, 'kind', 'walkthrough_notes_ready'),
          headers := jsonb_build_object('Content-Type','application/json','apikey',%L,'Authorization','Bearer '||%L),
          timeout_milliseconds := 15000
        );
      end if;

      return new;
    end;
    $fn$;
  $f$, fn_url, s, pubkey, pubkey, fn_url, s, pubkey, pubkey, fn_url, s, pubkey, pubkey);

  -- ── dispute raised ────────────────────────────────────────────────────
  execute format($f$
    create or replace function public.notify_client_dispute_raised()
    returns trigger
    language plpgsql
    security definer
    set search_path to 'public'
    as $fn$
    begin
      perform net.http_post(
        url := %L,
        body := jsonb_build_object('secret', %L, 'jobId', new.job_id, 'kind', 'dispute_raised'),
        headers := jsonb_build_object('Content-Type','application/json','apikey',%L,'Authorization','Bearer '||%L),
        timeout_milliseconds := 15000
      );
      return new;
    end;
    $fn$;
  $f$, fn_url, s, pubkey, pubkey);

  -- ── worker on site ────────────────────────────────────────────────────
  execute format($f$
    create or replace function public.notify_client_worker_arrived()
    returns trigger
    language plpgsql
    security definer
    set search_path to 'public'
    as $fn$
    begin
      perform net.http_post(
        url := %L,
        body := jsonb_build_object('secret', %L, 'jobId', new.job_id, 'kind', 'worker_on_site'),
        headers := jsonb_build_object('Content-Type','application/json','apikey',%L,'Authorization','Bearer '||%L),
        timeout_milliseconds := 15000
      );
      return new;
    end;
    $fn$;
  $f$, fn_url, s, pubkey, pubkey);

  -- The one and only place the new plaintext leaves this database: encrypted,
  -- for a human to decrypt from Supabase Studio's own SQL editor (a session
  -- this migration has no part in) and move into the yaad-job-health Edge
  -- Function secret by hand. Never selected back out by any migration or
  -- application code.
  perform vault.create_secret(
    s,
    'notify_trigger_secret_plaintext_20260831x',
    'Rotated 31 Aug 2026 after an accidental exposure. Copy into the YAAD_CRON_SECRET Edge Function secret via the Supabase CLI, then delete this Vault entry. See RUNBOOK.md.'
  );
end
$do$;
