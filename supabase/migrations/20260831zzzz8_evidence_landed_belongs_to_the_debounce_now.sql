-- A concurrent session's own fix (20260831zzzz5) restored evidence_landed's
-- net.http_post into notify_client_on_job_change(), reading its absence as
-- an accidental drop from an earlier secret-resync edit. It was not
-- accidental: 20260831zzzz6, the same afternoon, removed it on purpose,
-- because evidence_landed no longer fires off the jobs UPDATE at all. Every
-- evidence insert now resets a 90-second quiet timer instead
-- (evidence_landed_pending), and yaad-evidence-landed-check
-- (20260831zzzz7, cron once a minute) is what actually fires it, once a
-- burst of photos has finished landing rather than off whichever one
-- landed first. Two sessions in the same working tree, the exact hazard
-- CLAUDE.md's own §12 names; confirmed live, not assumed: reading
-- notify_client_on_job_change()'s prosrc back after zzzz5 ran showed the
-- evidence_landed branch present again, ahead of stage_released and
-- walkthrough_notes_ready, both left correctly alone.
--
-- Removed a second time, same way as the first: stage_released and
-- walkthrough_notes_ready copied verbatim from the live function, nothing
-- else about them touched. The secret is not regenerated here either;
-- zzzz5's own secret resync (notify_client_quote_arrived,
-- notify_client_on_job_change, notify_client_dispute_raised,
-- notify_worker_of_portal_comment and relay_confirmed_report all now
-- agreeing on one value, confirmed live) was itself correct and stays.
--
-- Left as a standing note for whichever session reads this function next:
-- evidence_landed's absence from notify_client_on_job_change is not a gap.
-- It is owned by evidence_landed_pending / yaad-evidence-landed-check now.
-- Before touching this function again, check trg_evidence_schedules_landed_notify
-- on the evidence table exists and cron.job has yaad-evidence-landed-check
-- scheduled; if either is missing, that is the actual regression to fix,
-- not putting this branch back.

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
  $f$, fn_url, s, pubkey, pubkey, fn_url, s, pubkey, pubkey);
end
$do$;
