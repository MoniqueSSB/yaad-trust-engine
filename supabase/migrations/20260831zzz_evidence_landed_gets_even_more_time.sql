-- STALE, not applied, do not run as written: superseded by
-- 20260831zzzz6_evidence_landed_debounce.sql, applied live 31 Aug 2026.
-- That migration removes evidence_landed's net.http_post from
-- notify_client_on_job_change() entirely (it now fires from a 90-second
-- debounce timer instead, checked by yaad-evidence-landed-check, not
-- straight off this trigger), which makes the timeout bump below moot: the
-- call this migration was widening room for no longer happens on this code
-- path. Applying this file now would also silently drop the live
-- walkthrough_notes_ready branch, which post-dates whatever base version
-- this file was written against and was never in this file's body at all.
-- If evidence_landed's Edge Function call ever needs more timeout room
-- again, apply it to yaad-evidence-landed-check's own fetch() and the
-- pg_cron job's own net.http_post timeout instead, not here.
--
-- The AI photo review's fix (yaad-notify-client, 31 Aug 2026) swaps the
-- vision model and adds one bounded retry on a timeout, since NVIDIA's
-- hosted latency for it varies a lot call to call: one single-photo
-- request came back in about fifteen seconds, the next of the same shape
-- ran past thirty five. Worst case is now two 20s attempts back to back,
-- on top of the reporting agent's own call running alongside it. 28
-- seconds, set in 20260831y for the previous single-attempt design, is no
-- longer enough room: pg_net would give up and log a false timeout in
-- net._http_response for a request that goes on to complete normally, the
-- exact "nothing told the desk anything went wrong" failure that
-- migration was written to fix in the first place.
--
-- Only evidence_landed's own timeout moves. stage_released, quote_arrived
-- and dispute_raised each still fire at most one lightweight thing and
-- have no reason to need more room.
--
-- The secret is not regenerated: extracted from the already-deployed
-- notify_client_quote_arrived()'s own prosrc, the same way every other
-- change to this function has done it since the mismatch this repository
-- hit twice already the same afternoon.

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
          timeout_milliseconds := 45000
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
