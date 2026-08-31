-- Client notifications, fired from the writes that actually change state,
-- never from the UI. Stage 5.3.
--
-- Same secret pattern as yaad-vetting-purge's cron job (20260827f): a trigger
-- has no user session and cannot read an Edge Function's environment, so it
-- proves itself with a secret generated once and stored here only as its
-- SHA-256 hash. The plaintext is baked into the trigger function bodies
-- below and lives nowhere else.
create extension if not exists pg_net with schema extensions;

do $do$
declare
  s      text := encode(extensions.gen_random_bytes(32), 'hex');
  fn_url text := 'https://leffyisvfvjwzilydlwf.supabase.co/functions/v1/yaad-notify-client';
  pubkey text := 'sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz';
begin
  insert into public.app_settings(key, value)
  values ('notify_trigger_secret_sha256', encode(extensions.digest(s, 'sha256'), 'hex'))
  on conflict (key) do update set value = excluded.value;

  -- ── quote arrived ────────────────────────────────────────────────────
  -- A worker's action, and the client would otherwise have to think to come
  -- back and look. Moved here from yaad-quote-landed, which was called
  -- directly by the submitQuote server action: exactly the UI-fired path
  -- this stage exists to remove, since a second insert path (Stage 6's
  -- WhatsApp quote reply, still to come) would otherwise need to remember to
  -- call it too.
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
  $f$, fn_url, s, pubkey, pubkey);

  drop trigger if exists trg_notify_quote_arrived on public.job_quotes;
  create trigger trg_notify_quote_arrived
    after insert on public.job_quotes
    for each row execute function public.notify_client_quote_arrived();

  -- ── evidence landed, and stage released ──────────────────────────────
  -- One trigger on jobs, because both are state TRANSITIONS on this same
  -- row and the AFTER UPDATE moment is where old and new can be compared
  -- directly, rather than guessed at from the table that caused the write.
  --
  -- evidence_landed fires on the transition INTO 'evidence', not on every
  -- row sync_job_status happens to touch: a worker filing five photos for
  -- one stage must not send five messages.
  --
  -- stage_released fires only when a stage_approvals row now exists for the
  -- OLD stage, which only approve_stage() ever writes. A stage number can in
  -- principle move for other reasons; this only reports the ones that were
  -- genuinely approved.
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
          timeout_milliseconds := 15000
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

  drop trigger if exists trg_notify_job_change on public.jobs;
  create trigger trg_notify_job_change
    after update on public.jobs
    for each row execute function public.notify_client_on_job_change();

  -- ── dispute raised ────────────────────────────────────────────────────
  -- A receipt, not a report of somebody else's action: only the client may
  -- insert into disputes (see "client raises a dispute" in RLS), so this
  -- confirms it landed and is being read, the same shape as an enquiry
  -- receipt rather than a notification about a stranger's move.
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
  $f$, fn_url, s, pubkey, pubkey);

  drop trigger if exists trg_notify_dispute_raised on public.disputes;
  create trigger trg_notify_dispute_raised
    after insert on public.disputes
    for each row execute function public.notify_client_dispute_raised();
end
$do$;

comment on table public.app_settings is
  'Small operational settings. purge_cron_secret_sha256 and notify_trigger_secret_sha256 are hashes, never the secret: see 20260827f and 20260831i.';
