-- Founder's own requirement, 31 Aug 2026: the AI's composed report should
-- not go straight to the client. It goes to the worker first, framed
-- honestly as a draft, with a simple choice: send it as written, or write
-- their own version instead. The worker confirmed this is theirs to
-- decide, not the founder's, since she is not the one who did the work.
--
-- relay_confirmed_report() is the one door back into yaad-notify-client
-- from a worker's WhatsApp reply. Same shared-secret pattern as every
-- trigger in this repository: the secret is never given to an Edge
-- Function directly, only ever baked into a Postgres function's own body,
-- extracted here from an already-deployed one rather than regenerated,
-- learned the hard way earlier the same day that regenerating it breaks
-- every other trigger sharing it.
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
    raise exception 'Could not recover the notify trigger secret.';
  end if;

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

-- Service role only, same as every function in this file that a Twilio
-- webhook needs to call without a user session behind it.
revoke all on function public.relay_confirmed_report(text, text, text) from public, anon, authenticated;
