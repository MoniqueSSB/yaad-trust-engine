-- RECOVERED 4 September 2026. This migration was applied to production on
-- 3 September (version 20260903083651, name
-- "20260903a_the_notify_secret_lives_in_the_vault_not_the_trigger_body")
-- but the file was never committed. The database and the repository had
-- drifted apart on the one thing this file is about, which meant a rebuild
-- from migrations would have recreated the OLD plaintext trigger bodies
-- carrying a secret that no longer works, and every client notification
-- would have failed a 403 silently. Recovered by reading the live
-- definitions back with pg_get_functiondef and committing them verbatim.
--
-- WHAT IT DOES. Until now the shared secret that trigger functions present
-- to yaad-notify-client was baked into each function body as plaintext.
-- That is readable by anyone who can call pg_get_functiondef, and it has
-- twice ended up in a Claude Code session's tool output and from there into
-- committed migration files in a PUBLIC repository (20260901g line 110 and
-- 20260902c line 353, both still carrying the dead value as history).
--
-- The secret now lives in Supabase Vault. Each trigger calls
-- public.notify_trigger_secret() to fetch it at call time, so no function
-- body contains it and dumping a definition reveals nothing. EXECUTE on
-- that function is granted to service_role only, never to anon or
-- authenticated: it returns the plaintext, so a grant to a browser role
-- would be worse than the problem it fixes.
--
-- ON THE TWO HISTORICAL FILES. They are left exactly as they are. Editing
-- an applied migration is its own hazard and does not remove anything from
-- git history in any case. Rotation was the fix, and it has happened: the
-- published value no longer matches app_settings and is refused. See
-- DECISIONS.md.

-- ── the lookup ────────────────────────────────────────────────────────
create or replace function public.notify_trigger_secret()
returns text
language sql
stable
security definer
set search_path to ''
as $function$
  select decrypted_secret
    from vault.decrypted_secrets
   where name = 'notify_trigger_secret'
   limit 1
$function$;

revoke all on function public.notify_trigger_secret() from public, anon, authenticated;
grant execute on function public.notify_trigger_secret() to service_role;

-- ── bootstrap, for a rebuilt database only ────────────────────────────
-- A no-op against production, where the secret already exists. On a fresh
-- rebuild it mints one and stores its hash, so notifications work without a
-- human having to remember this step. It never overwrites an existing
-- secret, so it cannot silently rotate a live one.
do $do$
declare
  s text;
begin
  if not exists (select 1 from vault.secrets where name = 'notify_trigger_secret') then
    s := encode(extensions.gen_random_bytes(32), 'hex');
    perform vault.create_secret(s, 'notify_trigger_secret',
                                'Shared secret presented by trigger functions to yaad-notify-client.');
    insert into public.app_settings(key, value)
    values ('notify_trigger_secret_sha256', encode(extensions.digest(s, 'sha256'), 'hex'))
    on conflict (key) do update set value = excluded.value;
    raise notice 'Minted a new notify_trigger_secret. YAAD_CRON_SECRET on yaad-job-health must be set to match.';
  end if;
end
$do$;

-- ── the nine callers, verbatim from production ────────────────────────
-- Read back with pg_get_functiondef on 4 Sep 2026. Note that
-- notify_client_on_job_change no longer carries an evidence_landed branch:
-- that moved to the debounce in "evidence_landed_belongs_to_the_debounce_now".

create or replace function public.notify_client_quote_arrived()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
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
$function$;

create or replace function public.notify_client_on_job_change()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
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
$function$;

create or replace function public.notify_client_dispute_raised()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
    begin
      perform net.http_post(
        url := 'https://leffyisvfvjwzilydlwf.supabase.co/functions/v1/yaad-notify-client',
        body := jsonb_build_object('secret', public.notify_trigger_secret(), 'jobId', new.job_id, 'kind', 'dispute_raised'),
        headers := jsonb_build_object('Content-Type','application/json','apikey','sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz','Authorization','Bearer '||'sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz'),
        timeout_milliseconds := 15000
      );
      return new;
    end;
$function$;

create or replace function public.notify_client_worker_arrived()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
    begin
      perform net.http_post(
        url := 'https://leffyisvfvjwzilydlwf.supabase.co/functions/v1/yaad-notify-client',
        body := jsonb_build_object('secret', public.notify_trigger_secret(), 'jobId', new.job_id, 'kind', 'worker_on_site'),
        headers := jsonb_build_object('Content-Type','application/json','apikey','sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz','Authorization','Bearer '||'sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz'),
        timeout_milliseconds := 15000
      );
      return new;
    end;
$function$;

create or replace function public.notify_client_service_change()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
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
$function$;

create or replace function public.notify_worker_kickoff_pack_ready()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
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
$function$;

create or replace function public.notify_worker_of_portal_comment()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
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
$function$;

create or replace function public.notify_worker_quote_awaits_confirm()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
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
$function$;

create or replace function public.relay_confirmed_report(p_job text, p_override_text text, p_ai_summary text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
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
$function$;
