-- notify_client_on_job_change() now triggers a second, independent model
-- call (the AI photo review, ported into yaad-notify-client the same
-- afternoon), run concurrently with the first rather than after it, but
-- even in parallel the combined round trip came close enough to the
-- original 15 second budget to time out twice in testing:
-- net._http_response recorded no response at all for those two calls,
-- not a clean failure, which is worse, because nothing told the desk
-- anything went wrong.
--
-- Only this one function's timeout moves. The other three trigger
-- functions this file defines (quote_arrived, dispute_raised) each fire
-- at most one lightweight thing and have no reason to need more room.
--
-- The secret is not regenerated: extracted from the already-deployed
-- notify_client_quote_arrived()'s own prosrc, the same way every other
-- regeneration in this repository has done it, never retyped, never
-- written here as plaintext.

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
    raise exception 'Could not recover the existing notify trigger secret from notify_client_quote_arrived().';
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
          timeout_milliseconds := 28000
        );
      end if;

      if coalesce(new.stage,0) > coalesce(old.stage,0)
         and exists (select 1 from public.stage_approvals a where a.job_id = new.id and a.stage = old.stage)
      then
        perform net.http_post(
          url := %L,
          body := jsonb_build_object('secret', %L, 'jobId', new.id, 'kind', 'stage_released'),
          headers := jsonb_build_object('Content-Type','application/json','apikey',%L,'Authorization','Bearer '||%L),
          timeout_milliseconds := 15000
        );
      end if;

      return new;
    end;
    $fn$;
  $f$, fn_url, s, pubkey, pubkey, fn_url, s, pubkey, pubkey);
end
$do$;
