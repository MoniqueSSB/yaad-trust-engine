-- The report_confirm lane. AI drafts a client-facing evidence report,
-- Monique confirms it on WhatsApp before it reaches the client, the same
-- shape as the Kickoff Pack approval built earlier the same day.
--
-- yaad-notify-client's evidence_landed now holds a composed digest in
-- wa_intake_sessions and messages this phone instead of the client, when
-- one is set. A reply matching the job's own code (checked in yaad-inbound)
-- calls confirm_evidence_report() below, which tells yaad-notify-client to
-- send exactly what was drafted, kind 'evidence_report_confirmed'.
--
-- Founder's own number, reused from invoice_issuer_phone where it already
-- serves as her contact number in this system. Kept as its own named
-- setting, not a second use of that one, because the two mean different
-- things and a change to one should never silently change the other.
insert into public.app_settings (key, value)
select 'report_confirm_phone', value from public.app_settings where key = 'invoice_issuer_phone'
on conflict (key) do nothing;

-- confirm_evidence_report() calls yaad-notify-client the same way every
-- trigger in 20260831i does, proving itself with the same shared secret.
-- Recovered from an existing trigger function's own source rather than
-- generated fresh (the pattern 20260831j already established), so the
-- app_settings hash never has to change and every function that already
-- trusts it keeps working.
do $do$
declare
  v_body     text;
  v_secret   text;
  v_anonkey  text := 'sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz';
  fn_url     text := 'https://leffyisvfvjwzilydlwf.supabase.co/functions/v1/yaad-notify-client';
begin
  select prosrc into v_body from pg_proc where proname = 'notify_client_on_job_change';
  if v_body is null then
    raise exception 'Could not find notify_client_on_job_change() to recover the notify secret from.';
  end if;
  v_secret := substring(v_body from '''secret'', ''([0-9a-f]+)''');
  if v_secret is null then
    raise exception 'Could not recover the notify secret from notify_client_on_job_change().';
  end if;

  execute format($f$
    create or replace function public.confirm_evidence_report(p_job_id text)
    returns void
    language plpgsql
    security definer
    set search_path to 'public'
    as $fn$
    begin
      perform net.http_post(
        url := %L,
        body := jsonb_build_object('secret', %L, 'jobId', p_job_id, 'kind', 'evidence_report_confirmed'),
        headers := jsonb_build_object('Content-Type','application/json','apikey',%L,'Authorization','Bearer '||%L),
        timeout_milliseconds := 15000
      );
    end;
    $fn$;
  $f$, fn_url, v_secret, v_anonkey, v_anonkey);
end
$do$;

-- Same access shape as approve_stage_via_whatsapp(): no grant to anon or
-- authenticated at all. This is reachable only by a caller holding the
-- service role key, which is what yaad-inbound runs as, and by nobody a
-- browser session could ever be.
revoke execute on function public.confirm_evidence_report(text) from anon, authenticated, public;
grant  execute on function public.confirm_evidence_report(text) to service_role;
