-- The previous migration in this same batch generated a NEW secret for
-- the new comment-notify trigger instead of reusing the existing one,
-- which overwrote notify_trigger_secret_sha256 and broke every other
-- trigger sharing it: quote_arrived, evidence_landed, stage_released and
-- dispute_raised would all now fail their own secret check against
-- yaad-notify-client, since their baked-in plaintext no longer matches
-- the hash just stored. Caught immediately by checking, not assumed fine.
--
-- Fixed by extracting the NEW secret (already live, already the one
-- app_settings now holds the hash of) from the function that has it, and
-- re-baking that same value into the other three, rather than generating
-- yet another one and repeating the mistake.

do $do$
declare
  s      text;
  fn_url_quote  text := 'https://leffyisvfvjwzilydlwf.supabase.co/functions/v1/yaad-notify-client';
  pubkey text := 'sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz';
begin
  select substring(prosrc from '''secret'', ''([0-9a-f]+)''')
    into s
    from pg_proc
   where proname = 'notify_worker_of_portal_comment';

  if s is null then
    raise exception 'Could not recover the new secret from notify_worker_of_portal_comment().';
  end if;

  -- quote_arrived
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
  $f$, fn_url_quote, s, pubkey, pubkey);

  -- evidence_landed / stage_released (28s budget on evidence_landed, unchanged from 20260831y)
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
  $f$, fn_url_quote, s, pubkey, pubkey, fn_url_quote, s, pubkey, pubkey);

  -- dispute_raised
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
  $f$, fn_url_quote, s, pubkey, pubkey);
end
$do$;
