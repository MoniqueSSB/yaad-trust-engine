-- The Arrival Log, CLAUDE.md's own glossary: "timestamped proof the worker
-- was on the correct site at the start." Named there, referenced by
-- yaad-completion's own drafting prompt ("arrival, before, after, video,
-- receipts" as evidence types), and named on the stage rail itself
-- ("Stage 1 · on site") since journey.ts was written. None of the three
-- ever pointed at a real event: "on site" on the rail is only a cosmetic
-- label for jobs.status = 'in_progress', not something a worker ever did.
--
-- This is that missing event, and the reason Stage 5.3's own brief named a
-- notification ("worker on site today") that could not be built: there was
-- nothing to fire it from.
--
-- One row per (job, stage, day), Jamaica-local. "Today" is a real question
-- with a real answer for a worker physically standing on a property in
-- Jamaica; Jamaica carries no daylight-saving shift, so a fixed UTC-5 read
-- is exact, not an approximation. A second check-in the same stage, same
-- day, is not an error: it is the same fact confirmed again, so it is
-- silently absorbed rather than refused, and does not fire a second
-- notification. A new day on the same stage is a genuinely new fact and
-- does.

create table if not exists public.arrival_log (
  id          uuid primary key default gen_random_uuid(),
  job_id      text not null references public.jobs(id) on delete cascade,
  stage       int  not null,
  arrived_at  timestamptz not null default now(),
  arrived_on  date not null default ((now() at time zone 'America/Jamaica')::date),
  arrived_by  text not null,
  created_at  timestamptz not null default now(),
  unique (job_id, stage, arrived_on)
);

comment on table public.arrival_log is
  'The Arrival Log. One row per stage per Jamaica-local day a worker checked in on site, through log_arrival(). Read by both parties, written by neither directly: see 20260830b for the same shape on evidence RLS.';

create index if not exists arrival_log_job_idx on public.arrival_log (job_id, arrived_on desc);

alter table public.arrival_log enable row level security;

drop policy if exists arrival_log_party_read on public.arrival_log;
create policy arrival_log_party_read on public.arrival_log
  for select to authenticated
  using (exists (
    select 1 from public.jobs j
     where j.id = arrival_log.job_id
       and nullif(btrim(lower(auth.jwt() ->> 'email')), '') is not null
       and nullif(btrim(lower(auth.jwt() ->> 'email')), '') in (
             nullif(btrim(lower(coalesce(j.client_email, ''))), ''),
             nullif(btrim(lower(coalesce(j.worker_email, ''))), ''))
  ));

-- No insert policy. log_arrival() is the one door, same reasoning as
-- stage_approvals: a row here is a claim of physical presence, and the
-- worker's own check-in function is what stamps who and when, not
-- whatever a client-side insert happened to send.

create or replace function public.log_arrival(p_job text)
returns table(stage int, arrived_at timestamptz, already_logged_today boolean)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_email text;
  v_stage int;
  v_existing timestamptz;
begin
  v_email := nullif(btrim(lower(auth.jwt() ->> 'email')), '');
  if v_email is null then
    raise exception 'Not signed in.' using errcode = '28000';
  end if;

  select greatest(coalesce(j.stage, 0), 1) into v_stage
    from public.jobs j
   where j.id = p_job
     and lower(coalesce(j.worker_email, '')) = v_email;

  if v_stage is null then
    raise exception 'That is not your job.' using errcode = '28000';
  end if;

  select a.arrived_at into v_existing
    from public.arrival_log a
   where a.job_id = p_job and a.stage = v_stage
     and a.arrived_on = (now() at time zone 'America/Jamaica')::date;

  if v_existing is not null then
    return query select v_stage, v_existing, true;
    return;
  end if;

  insert into public.arrival_log (job_id, stage, arrived_by)
  values (p_job, v_stage, v_email);

  return query select v_stage, now(), false;
end;
$$;

revoke all on function public.log_arrival(text) from public, anon, authenticated;
grant execute on function public.log_arrival(text) to authenticated;

-- ---------------------------------------------- the notification

-- Same shared-secret pattern as 20260831i: the plaintext is read back out
-- of an already-deployed trigger's own source rather than retyped, so it
-- never sits in a migration file as a literal.

do $do$
declare
  v_body   text;
  v_secret text;
  v_anonkey text;
begin
  select prosrc into v_body from pg_proc where proname = 'notify_client_on_job_change';
  v_secret  := substring(v_body from '''secret'', ''([0-9a-f]+)''');
  v_anonkey := substring(v_body from '''apikey'',''([^'']+)''');

  if v_secret is null or v_anonkey is null then
    raise exception 'could not extract existing literals from live function body';
  end if;

  execute format($fmt$
create or replace function notify_client_worker_arrived()
returns trigger
language plpgsql
security definer
set search_path = public
as $body$
    begin
      perform net.http_post(
        url := 'https://leffyisvfvjwzilydlwf.supabase.co/functions/v1/yaad-notify-client',
        body := jsonb_build_object('secret', %L, 'jobId', new.job_id, 'kind', 'worker_on_site'),
        headers := jsonb_build_object('Content-Type','application/json','apikey',%L,'Authorization','Bearer '||%L),
        timeout_milliseconds := 15000
      );
      return new;
    end;
    $body$;
$fmt$, v_secret, v_anonkey, v_anonkey);
end;
$do$;

revoke all on function notify_client_worker_arrived() from public, anon, authenticated;

drop trigger if exists trg_notify_worker_arrived on public.arrival_log;
create trigger trg_notify_worker_arrived
  after insert on public.arrival_log
  for each row execute function notify_client_worker_arrived();
