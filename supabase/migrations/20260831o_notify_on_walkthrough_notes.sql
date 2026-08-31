-- The last piece of the walkthrough loop: telling the client there is
-- something to confirm. The call itself is live, so the client is present
-- for it; the write-up almost never is, since a worker types it up after.
-- Without this the client has no way to know record_walkthrough_notes() was
-- ever called short of opening the job on the chance.
--
-- Extends notify_client_on_job_change() (20260831i, fixed in 20260831j)
-- with a third condition, same function, same reasoning both existing
-- conditions already use: one AFTER UPDATE trigger on jobs, not a second
-- one competing for the same row. Same secret-extraction pattern as every
-- migration that has touched this function: the plaintext is read back out
-- of the live function rather than retyped into this file.

do $do$
declare
  v_body    text;
  v_secret  text;
  v_anonkey text;
begin
  select prosrc into v_body from pg_proc where proname = 'notify_client_on_job_change';
  v_secret  := substring(v_body from '''secret'', ''([0-9a-f]+)''');
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

      if new.walk_call_notes is not null
         and old.walk_call_notes is distinct from new.walk_call_notes
      then
        perform net.http_post(
          url := 'https://leffyisvfvjwzilydlwf.supabase.co/functions/v1/yaad-notify-client',
          body := jsonb_build_object('secret', %L, 'jobId', new.id, 'kind', 'walkthrough_notes_ready'),
          headers := jsonb_build_object('Content-Type','application/json','apikey',%L,'Authorization','Bearer '||%L),
          timeout_milliseconds := 15000
        );
      end if;

      return new;
    end;
    $body$;
$fmt$, v_secret, v_anonkey, v_anonkey, v_secret, v_anonkey, v_anonkey, v_secret, v_anonkey, v_anonkey);
end;
$do$;
