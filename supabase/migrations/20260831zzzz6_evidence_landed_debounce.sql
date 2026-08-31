-- Burst-photo debounce for evidence_landed.
--
-- The bug: jobs.status flips into 'evidence' on the FIRST evidence photo
-- filed against a stage, and that flip is the only thing that ever fired
-- evidence_landed (confirmed live, 20260831i: "a second evidence insert
-- against a stage that has already flipped jobs.status to evidence does
-- not fire a second evidence_landed"). Correct for one photo. Wrong for a
-- worker sending several photos back to back over WhatsApp: the AI photo
-- review and the report that goes out are built from whatever evidence
-- rows exist at the moment the FIRST photo's trigger fires, which can be
-- one photo out of five, the rest still landing.
--
-- The fix: every evidence insert resets a short quiet timer for its job
-- and stage, 90 seconds, rather than firing straight off the first one.
-- yaad-evidence-landed-check (wired to run once a minute in the next
-- migration) fires evidence_landed once nothing new has landed on that
-- stage for the full 90 seconds. One photo behaves exactly as before,
-- just after a short pause; a burst waits for the burst to finish.
--
-- Same shape as job_followups (20260831zzzz3): a table of pending items,
-- a periodic check against it, upserted-and-reset by real activity rather
-- than invented as a second pattern for "something should happen a
-- little later." What differs is WHAT resets the timer: every evidence
-- insert on the stage, not just relief from a job's own silence.

create table if not exists public.evidence_landed_pending (
  id         uuid primary key default gen_random_uuid(),
  job_id     text not null references public.jobs(id) on delete cascade,
  stage      integer not null,
  created_at timestamptz not null default now(),
  due_at     timestamptz not null,
  fired_at   timestamptz
);

-- One open timer per job and stage. A fresh photo before the old timer is
-- due resets it (the upsert below) rather than queuing a second one.
create unique index if not exists evidence_landed_pending_open_uniq
  on public.evidence_landed_pending (job_id, stage) where fired_at is null;

create index if not exists evidence_landed_pending_due_idx
  on public.evidence_landed_pending (due_at) where fired_at is null;

comment on table public.evidence_landed_pending is
  'A quiet timer per job and stage: reset by every evidence insert, checked by yaad-evidence-landed-check (20260831zzzz7). evidence_landed only actually fires once nothing has landed on the stage for 90s, so a burst of WhatsApp photos gets one notification covering all of them, not one covering whichever photo happened to land first.';

-- No policies, on purpose: every read and write goes through the
-- SECURITY DEFINER functions below, called only from the evidence-insert
-- trigger and yaad-evidence-landed-check on the service role. RLS enabled
-- with nothing granted is the same default-deny shape job_followups uses.
alter table public.evidence_landed_pending enable row level security;

-- Fires on every evidence insert, not only the first for a stage: this is
-- the whole point, the timer has to move every time a new photo lands, not
-- once. Whether the notification actually ends up worth sending is decided
-- later, at check time, by due_evidence_landed_notifies() below, since a
-- job can be disputed, approved or moved on to a new stage in the 90
-- seconds this timer is open.
create or replace function public.schedule_evidence_landed_notify()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  insert into public.evidence_landed_pending (job_id, stage, due_at)
  values (new.job_id, greatest(coalesce(new.stage, 0), 1), now() + interval '90 seconds')
  on conflict (job_id, stage) where fired_at is null
  do update set due_at = excluded.due_at;
  return new;
end;
$$;

drop trigger if exists trg_evidence_schedules_landed_notify on public.evidence;
create trigger trg_evidence_schedules_landed_notify
  after insert on public.evidence
  for each row execute function public.schedule_evidence_landed_notify();

-- should_notify is a live re-check against jobs, not assumed true because
-- the timer existed: the same stage this timer was opened for might have
-- been approved, disputed or moved past in the 90 seconds since, and a
-- stale timer should clear silently, the same way clear_resolved_followups
-- clears a job_followups row that real activity already answered.
create or replace function public.due_evidence_landed_notifies()
returns table(id uuid, job_id text, stage integer, should_notify boolean)
language sql
stable
security definer
set search_path to 'public'
as $$
  select p.id, p.job_id, p.stage,
         (j.status = 'evidence' and greatest(coalesce(j.stage, 0), 1) = p.stage) as should_notify
    from public.evidence_landed_pending p
    join public.jobs j on j.id = p.job_id
   where p.fired_at is null and p.due_at <= now();
$$;

revoke all on function public.due_evidence_landed_notifies() from public, anon, authenticated;

create or replace function public.mark_evidence_landed_fired(p_id uuid)
returns void
language sql
security definer
set search_path to 'public'
as $$
  update public.evidence_landed_pending set fired_at = now() where id = p_id;
$$;

revoke all on function public.mark_evidence_landed_fired(uuid) from public, anon, authenticated;

-- notify_client_on_job_change loses its evidence_landed branch: that kind
-- is now decided by the debounce timer above and fired from
-- yaad-evidence-landed-check, never straight off the jobs UPDATE. The
-- secret is not regenerated, extracted from the already-deployed
-- function's own prosrc, the same discipline every other change to this
-- function has followed since the mismatch this repository hit twice
-- already the same afternoon (20260831z2). stage_released and
-- walkthrough_notes_ready are copied verbatim from the live function,
-- unchanged: this migration touches evidence_landed only.
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
