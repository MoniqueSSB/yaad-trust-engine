-- The stage_released trigger compared stage_approvals.stage to old.stage.
-- On a job's very first approval, jobs.stage is still 0 going in (approve_stage
-- only clamps it to 1 internally when it computes v_stage), while the approved
-- row lands in stage_approvals as stage = 1. old.stage (0) never matched
-- stage_approvals.stage (1), so the first approval on every job stayed silent
-- and no notification went out. Confirmed live: approve_stage on a test job
-- moved jobs.stage 1 -> 2 and inserted stage_approvals.stage = 1, but
-- net._http_response recorded no third call.
--
-- The stage that was just approved is always new.stage - 1, regardless of
-- where jobs.stage started from, so key off that instead of old.stage.
--
-- Same rule as 20260831i and 20260827f: the shared secret is never written
-- to a migration file as a literal. This reads it back out of the already-
-- deployed function's own source rather than retyping it, so the plaintext
-- exists only in memory for the length of this migration, not on disk.

do $do$
declare
  v_body text;
  v_secret text;
  v_anonkey text;
begin
  select prosrc into v_body from pg_proc where proname = 'notify_client_on_job_change';
  v_secret := substring(v_body from '''secret'', ''([0-9a-f]+)''');
  v_anonkey := substring(v_body from '''apikey'',''([^'']+)''');

  if v_secret is null or v_anonkey is null then
    raise exception 'could not extract existing literals from live function body';
  end if;

  execute format($fmt$
create or replace function notify_client_on_job_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $body$
    begin
      if coalesce(old.status,'') is distinct from 'evidence' and new.status = 'evidence' then
        perform net.http_post(
          url := 'https://leffyisvfvjwzilydlwf.supabase.co/functions/v1/yaad-notify-client',
          body := jsonb_build_object('secret', %L, 'jobId', new.id, 'kind', 'evidence_landed'),
          headers := jsonb_build_object('Content-Type','application/json','apikey',%L,'Authorization','Bearer '||%L),
          timeout_milliseconds := 15000
        );
      end if;

      if coalesce(new.stage,0) > coalesce(old.stage,0)
         and exists (select 1 from public.stage_approvals a where a.job_id = new.id and a.stage = new.stage - 1)
      then
        perform net.http_post(
          url := 'https://leffyisvfvjwzilydlwf.supabase.co/functions/v1/yaad-notify-client',
          body := jsonb_build_object('secret', %L, 'jobId', new.id, 'kind', 'stage_released'),
          headers := jsonb_build_object('Content-Type','application/json','apikey',%L,'Authorization','Bearer '||%L),
          timeout_milliseconds := 15000
        );
      end if;

      return new;
    end;
    $body$;
$fmt$, v_secret, v_anonkey, v_anonkey, v_secret, v_anonkey, v_anonkey);
end;
$do$;
