-- A dispute never goes quiet. 1 Oct 2026.
--
-- Founder: "fix this", on four gaps in 20260930130000, and "the check should
-- say 48 hours and be 48 hours":
--   1. a dispute the worker left unanswered moved to Yaadly and neither the
--      client nor the worker was told;
--   2. the desk alert said the client had escalated when the timer had;
--   3. the check ran once a day, so two days meant two to three;
--   4. a dispute the worker had answered and the client never closed stayed
--      open for good, blocking approval, with nobody following it up.
--
-- Now:
--   1. replied_at records when the worker answered; escalated_by records
--      that Yaadly stepped in on its own and why ('no_reply' or
--      'client_silent'). Nothing but this file's own functions writes them.
--   2. 48 hours with no worker reply: Yaadly steps in ('no_reply').
--      48 hours after the reply with no word from the client: the client is
--      chased once (client_chased_at). 48 hours after that: Yaadly steps in
--      ('client_silent').
--   3. the check runs every five minutes, so 48 hours means 48 hours.
--   4. when Yaadly steps in on its own, the client and the worker are each
--      told why (dispute_stepped_in, dispute_stepped_in_worker), and the
--      desk alert says the timer moved it, not the client.
--
-- Nothing here approves, releases or rules. Closing a dispute stays the
-- client's alone (20260913130100); this only ever moves one to a person.

alter table public.disputes
  add column if not exists replied_at timestamptz,
  add column if not exists client_chased_at timestamptz,
  add column if not exists escalated_by text;

do $do$
begin
  if not exists (select 1 from pg_constraint where conname = 'disputes_escalated_by_check') then
    alter table public.disputes add constraint disputes_escalated_by_check
      check (escalated_by is null or escalated_by in ('no_reply', 'client_silent'));
  end if;
end
$do$;

update public.disputes set replied_at = updated_at where reply is not null and replied_at is null;

-- The guard: the three new columns are Yaadly's to set, never a party's.
create or replace function public.disputes_each_side_moves_its_own_part()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  is_client boolean;
  is_worker boolean;
begin
  if auth.jwt() is null or public.is_admin() then
    return new;
  end if;
  select lower(coalesce(j.client_email, '')) = me and me <> '',
         lower(coalesce(j.worker_email, '')) = me and me <> ''
    into is_client, is_worker
    from public.jobs j where j.id = old.job_id;
  if new.job_id is distinct from old.job_id or new.raised_by is distinct from old.raised_by
     or new.body is distinct from old.body or new.kinds is distinct from old.kinds
     or new.created_at is distinct from old.created_at then
    raise exception 'What was raised cannot be changed.';
  end if;
  if new.client_chased_at is distinct from old.client_chased_at
     or new.escalated_by is distinct from old.escalated_by then
    raise exception 'That is set by Yaadly.';
  end if;
  if new.reply is distinct from old.reply then
    if not coalesce(is_worker, false) then raise exception 'Only the worker replies to a dispute.'; end if;
    if old.reply is not null then raise exception 'The reply has been given and stays as it was written.'; end if;
  end if;
  if new.state is distinct from old.state then
    if not coalesce(is_client, false) then raise exception 'Only the client can close or escalate a dispute.'; end if;
    if old.state <> 'direct' or new.state not in ('resolved', 'escalated') then
      raise exception 'A dispute moves once, from open to sorted or to Yaadly.';
    end if;
  end if;
  return new;
end;
$$;

-- replied_at, stamped by the database whichever door the reply came through.
-- Named to run after the guard (BEFORE triggers fire in name order), so the
-- guard never sees it as a party's change.
create or replace function public.disputes_stamp_reply()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  -- Stamped at the reply, and never set by hand at any other time.
  if new.reply is not null and old.reply is null then
    new.replied_at := now();
  else
    new.replied_at := old.replied_at;
  end if;
  return new;
end;
$$;
revoke all on function public.disputes_stamp_reply() from public, anon, authenticated;
drop trigger if exists trg_disputes_stamp_reply on public.disputes;
create trigger trg_disputes_stamp_reply
  before update on public.disputes
  for each row execute function public.disputes_stamp_reply();

-- The timer and the chase.
create or replace function public.escalate_stale_disputes()
returns int
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  n int := 0;
  m int;
begin
  -- 48 hours, no reply from the worker.
  update public.disputes
     set state = 'escalated', escalated_by = 'no_reply', updated_at = now()
   where state = 'direct'
     and reply is null
     and created_at < now() - interval '48 hours';
  get diagnostics m = row_count; n := n + m;

  -- 48 hours after the client was chased, still no word: Yaadly steps in.
  update public.disputes
     set state = 'escalated', escalated_by = 'client_silent', updated_at = now()
   where state = 'direct'
     and reply is not null
     and client_chased_at is not null
     and client_chased_at < now() - interval '48 hours';
  get diagnostics m = row_count; n := n + m;

  -- 48 hours after the reply, no word from the client: chase them once.
  update public.disputes
     set client_chased_at = now(), updated_at = now()
   where state = 'direct'
     and reply is not null
     and client_chased_at is null
     and coalesce(replied_at, updated_at) < now() - interval '48 hours';
  get diagnostics m = row_count; n := n + m;

  return n;
end;
$$;
revoke all on function public.escalate_stale_disputes() from public, anon, authenticated;

do $do$
begin
  if exists (select 1 from cron.job where jobname = 'yaad-dispute-escalation') then
    perform cron.unschedule('yaad-dispute-escalation');
  end if;
  -- Every five minutes, so 48 hours means 48 hours.
  perform cron.schedule('yaad-dispute-escalation', '*/5 * * * *', 'select public.escalate_stale_disputes();');
end
$do$;

-- Both parties hear when Yaadly steps in on its own, and the client hears the
-- chase. The desk keeps its own trigger (notify_desk_dispute_escalated),
-- which now reads escalated_by for its wording.
create or replace function public.notify_parties_dispute_moved()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  kinds text[] := '{}';
  k text;
begin
  if new.state = 'escalated' and old.state = 'direct' and new.escalated_by is not null then
    kinds := array['dispute_stepped_in', 'dispute_stepped_in_worker'];
  elsif new.client_chased_at is not null and old.client_chased_at is null and new.state = 'direct' then
    kinds := array['dispute_chase_client'];
  end if;
  foreach k in array kinds loop
    perform net.http_post(
      url := 'https://leffyisvfvjwzilydlwf.supabase.co/functions/v1/yaad-notify-client',
      body := jsonb_build_object('secret', public.notify_trigger_secret(), 'jobId', new.job_id,
        'kind', k, 'meta', jsonb_build_object('id', new.id)),
      headers := jsonb_build_object('Content-Type','application/json','apikey','sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz','Authorization','Bearer '||'sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz'),
      timeout_milliseconds := 15000
    );
  end loop;
  return new;
end;
$$;
revoke all on function public.notify_parties_dispute_moved() from public, anon, authenticated;
drop trigger if exists trg_notify_parties_dispute_moved on public.disputes;
create trigger trg_notify_parties_dispute_moved
  after update on public.disputes
  for each row execute function public.notify_parties_dispute_moved();
