-- Found live, 31 Aug 2026, while verifying the vision resize step: a
-- concurrent session's own work on notify_client_on_job_change() (adding
-- the walkthrough_notes_ready condition seen in its current body) replaced
-- the whole function rather than extending it, and the evidence_landed
-- branch, the transition into jobs.status = 'evidence' that fires the
-- entire worker-confirms-first draft/relay loop this session spent today
-- building and fixing, was not carried over. Confirmed by reading
-- notify_client_on_job_change()'s own prosrc back: stage_released and the
-- new walkthrough_notes_ready check were both there; evidence_landed was
-- not, anywhere.
--
-- The same edit also regenerated notify_trigger_secret_sha256 rather than
-- reusing the existing plaintext, the exact mistake RUNBOOK.md already
-- named as having happened twice in one afternoon, now a third and fourth
-- time: notify_client_quote_arrived, notify_client_on_job_change and
-- notify_client_dispute_raised all carry the new secret and agree with the
-- new stored hash; notify_worker_of_portal_comment and
-- relay_confirmed_report still carry the OLD plaintext and were silently
-- failing their own check with a 403 the moment the hash changed under
-- them.
--
-- Fixed the only way this file ever fixes it: extract the secret every
-- OTHER already-correct function agrees on right now
-- (notify_client_quote_arrived) and re-bake that exact value into the two
-- that had fallen out of step, and restore evidence_landed into
-- notify_client_on_job_change ahead of the stage_released and
-- walkthrough_notes_ready conditions already there, left exactly as they
-- were rather than reverted.

do $do$
declare
  s      text;
  fn_url text := 'https://leffyisvfvjwzilydlwf.supabase.co/functions/v1/yaad-notify-client';
  pubkey text := 'sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz';
begin
  select substring(prosrc from '''secret'', ''([0-9a-f]+)''')
    into s
    from pg_proc
   where proname = 'notify_client_quote_arrived';

  if s is null then
    raise exception 'Could not recover the current notify trigger secret from notify_client_quote_arrived().';
  end if;

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
          timeout_milliseconds := 45000
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

  execute format($f$
    create or replace function public.notify_worker_of_portal_comment()
    returns trigger
    language plpgsql
    security definer
    set search_path to 'public'
    as $fn$
    begin
      if new.from_role = 'client' and new.origin = 'portal' then
        perform net.http_post(
          url := %L,
          body := jsonb_build_object('secret', %L, 'jobId', new.job_id, 'kind', 'evidence_comment', 'meta', jsonb_build_object('comment_id', new.id)),
          headers := jsonb_build_object('Content-Type','application/json','apikey',%L,'Authorization','Bearer '||%L),
          timeout_milliseconds := 15000
        );
      end if;
      return new;
    end;
    $fn$;
  $f$, fn_url, s, pubkey, pubkey);

  execute format($f$
    create or replace function public.relay_confirmed_report(p_job text, p_override_text text, p_ai_summary text)
    returns void
    language plpgsql
    security definer
    set search_path to 'public'
    as $fn$
    begin
      perform net.http_post(
        url := %L,
        body := jsonb_build_object(
          'secret', %L, 'jobId', p_job, 'kind', 'evidence_report_confirmed',
          'meta', jsonb_build_object('override_text', p_override_text, 'ai_summary', p_ai_summary)
        ),
        headers := jsonb_build_object('Content-Type','application/json','apikey',%L,'Authorization','Bearer '||%L),
        timeout_milliseconds := 28000
      );
    end;
    $fn$;
  $f$, fn_url, s, pubkey, pubkey);
end
$do$;

revoke all on function public.relay_confirmed_report(text, text, text) from public, anon, authenticated;
