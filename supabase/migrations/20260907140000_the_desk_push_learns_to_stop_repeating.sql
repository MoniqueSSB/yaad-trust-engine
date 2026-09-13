-- Two crons were pushing the same reminder to Monique's phone every single
-- minute, for days.
--
-- yaad-kickoff-check and yaad-quote-pack-check both end by counting what is
-- sitting in their approval queue and pushing to ntfy if the count is above
-- zero. Neither had any memory of having already said so, so the condition
-- was not "something new arrived", it was "something is still waiting". On
-- 4 September (cb315b0) both packs correctly stopped issuing themselves off
-- a word scan and started waiting for a person instead, which is right and
-- stays. But that turned the queue from something that normally drained
-- itself into something that is normally not empty, and the same line then
-- fired every 60 seconds. Two pushes a minute, about 2,880 a day, against
-- four items, three of them August test rows that will never be approved.
--
-- The fix is memory, not silence. The approval gate is the product
-- (CLAUDE.md §2 and §3) and nothing here touches it: the packs still wait
-- for a named human, and this only changes how often the phone says so.
--
-- One SQL function rather than the same comparison written into two Deno
-- files, for the reason five copies of the ntfy push were collapsed into
-- pushToDesk() in yaad-inbound: copies drift, and the ones here would drift
-- in a direction nobody notices, because the failure mode of a notifier is
-- silence. It is also atomic, which two ticks landing together are not.

create table if not exists public.desk_push_state (
  notice_key   text primary key,
  last_count   integer not null default 0,
  last_push_at timestamptz,
  updated_at   timestamptz not null default now()
);

comment on table public.desk_push_state is
  'One row per recurring desk reminder, so a queue that is still waiting does not push on every poll. Written only by should_push_desk_notice(). Holds a count and two timestamps, never anything about a job, a client or a worker.';

alter table public.desk_push_state enable row level security;

-- Same shape as job_stall_state (20260831t): admin-only select, no insert or
-- update policy at all, because the only writer is a SECURITY DEFINER
-- function running as the service role, which RLS does not apply to.
drop policy if exists desk_push_state_admin_only on public.desk_push_state;
create policy desk_push_state_admin_only on public.desk_push_state
  for select to authenticated
  using (public.is_admin());

-- Returns true when the phone should actually be told, and records the
-- decision in the same statement.
--
-- Pushes when the queue GREW (something new arrived and she has not seen it)
-- or when p_repeat_hours have passed since the last push and the queue is
-- still not empty, so a forgotten item is still a standing reminder rather
-- than a thing that goes quiet after one message.
--
-- The observed count is stored on every call, including calls that do not
-- push. That is deliberate: approving two of three and then a new one
-- arriving takes the count 3 to 1 to 2, and only a stored 1 makes that
-- final 2 read as growth. Storing the count only on a push would leave the
-- high-water mark at 3 and the new arrival silent for a whole day.
--
-- An empty queue clears the row, so the clock genuinely resets rather than a
-- stale flag lingering, the same reason clear_resolved_job_stalls exists.
create or replace function public.should_push_desk_notice(
  p_key          text,
  p_count        integer,
  p_repeat_hours numeric default 24
)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  prev_count integer;
  prev_push  timestamptz;
  do_push    boolean;
begin
  if p_count is null or p_count <= 0 then
    delete from public.desk_push_state where notice_key = p_key;
    return false;
  end if;

  select last_count, last_push_at into prev_count, prev_push
    from public.desk_push_state where notice_key = p_key
    for update;

  do_push := prev_count is null
          or p_count > prev_count
          or prev_push is null
          or prev_push < now() - make_interval(secs => p_repeat_hours * 3600);

  insert into public.desk_push_state(notice_key, last_count, last_push_at, updated_at)
  values (p_key, p_count, case when do_push then now() else prev_push end, now())
  on conflict (notice_key) do update
    set last_count   = excluded.last_count,
        last_push_at = excluded.last_push_at,
        updated_at   = now();

  return do_push;
end;
$$;

revoke all on function public.should_push_desk_notice(text, integer, numeric) from public, anon, authenticated;
grant execute on function public.should_push_desk_notice(text, integer, numeric) to service_role;

comment on function public.should_push_desk_notice(text, integer, numeric) is
  'Should this recurring desk reminder actually go to the phone right now? True when the queue grew or when the repeat interval has passed and it is still not empty. Records the decision atomically. Callers: yaad-kickoff-check, yaad-quote-pack-check.';

-- Every minute was never needed for either of these, and it is what made a
-- standing queue feel like spam. Fifteen minutes is invisible on both paths:
-- a Kickoff Pack then waits on a human approval that takes minutes to hours
-- anyway, and a worker with no approved quote pack can still quote (RLS,
-- 20260901r), so the delay is a courtesy arriving slightly later.
--
-- alter_job rather than unschedule and reschedule, so the plaintext cron
-- secret living in the job's own command survives untouched. Regenerating it
-- would mean rewriting the hash in app_settings for no reason.
--
-- yaad-evidence-landed-check is deliberately left at every minute. It pushes
-- nothing to the phone and it sits on a client-facing path.
do $do$
declare
  j bigint;
  n text;
begin
  foreach n in array array['yaad-kickoff-check', 'yaad-quote-pack-check'] loop
    select jobid into j from cron.job where jobname = n;
    if j is not null then
      perform cron.alter_job(j, schedule => '*/15 * * * *');
    end if;
  end loop;
end
$do$;
