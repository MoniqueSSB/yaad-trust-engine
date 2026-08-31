-- Kickoff Pack dual agreement, step 3 of 5: the worker is actually told a
-- pack exists. Until now nothing did; the portal page already rendered
-- correctly for a worker (parties_read_approved_packs covers both emails)
-- but nobody was ever pointed at it. Fires the moment a pack's status
-- transitions into 'approved' (the same moment choose_worker() sets it, and
-- the same moment 20260831zzzz10's confirm code becomes the current one to
-- share). Same shared-secret pattern as every trigger in this repository:
-- extracted from an already-deployed function, never regenerated, the
-- lesson from 20260831z2 the hard way.
--
-- Requires "kickoff_pack_ready" added to yaad-notify-client's own KINDS
-- whitelist (supabase/functions/yaad-notify-client/index.ts) and that
-- function redeployed, or every one of these calls 400s with "secret,
-- jobId and a valid kind are required" - caught live the first time this
-- ran, not assumed from reading the trigger alone.
do $do$
declare
  s      text;
  fn_url text := 'https://leffyisvfvjwzilydlwf.supabase.co/functions/v1/yaad-notify-client';
  pubkey text := 'sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz';
begin
  select substring(prosrc from '''secret'', ''([0-9a-f]+)''')
    into s
    from pg_proc
   where proname = 'notify_worker_of_portal_comment';

  if s is null then
    raise exception 'Could not recover the shared secret from notify_worker_of_portal_comment().';
  end if;

  execute format($f$
    create or replace function public.notify_worker_kickoff_pack_ready()
    returns trigger
    language plpgsql
    security definer
    set search_path to 'public'
    as $fn$
    begin
      if coalesce(old.status,'') is distinct from 'approved' and new.status = 'approved' then
        perform net.http_post(
          url := %L,
          body := jsonb_build_object('secret', %L, 'jobId', new.job_id, 'kind', 'kickoff_pack_ready'),
          headers := jsonb_build_object('Content-Type','application/json','apikey',%L,'Authorization','Bearer '||%L),
          timeout_milliseconds := 15000
        );
      end if;
      return new;
    end;
    $fn$;
  $f$, fn_url, s, pubkey, pubkey);

  drop trigger if exists trg_notify_kickoff_pack_ready on public.kickoff_packs;
  create trigger trg_notify_kickoff_pack_ready
    after update on public.kickoff_packs
    for each row execute function public.notify_worker_kickoff_pack_ready();
end
$do$;
