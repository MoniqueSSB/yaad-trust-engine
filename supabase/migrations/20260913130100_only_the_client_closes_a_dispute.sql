-- Who may move a dispute, and the bug that meant nobody could close one.
-- Founder instruction, 13 September 2026 ("fix and update"), on the finding
-- logged in DECISIONS.md the same day.
--
-- TWO FAULTS IN ONE POLICY. "parties move an open dispute" (20260827b, applied
-- by MCP) was FOR UPDATE with a USING clause and no WITH CHECK:
--
--   1. With no WITH CHECK, Postgres applies USING to the NEW row as well. USING
--      says state <> 'resolved', so the client's own "That sorts it" (state to
--      resolved) failed its own policy every time. The page swallowed the
--      error, so it looked like a button that did nothing.
--   2. It let either party change anything: a worker could set a dispute
--      raised against them to resolved, or rewrite what the client said.
--
-- Now: the policy says who may touch the row (a party, while it is open), and
-- a trigger says what each side may change, the same split as the rest of
-- this schema, where the rule lives in Postgres and not in the page.
--
--   client   may close it (resolved) or escalate it, while it is direct
--   worker   may write the one reply, once
--   nobody   rewrites what was raised, reopens it, or moves it once escalated
--   admin    unchanged, through "admin full disputes"
--
-- Resolving a dispute is the client withdrawing their own complaint. It is
-- not a ruling, releases nothing and scores nobody. An escalated dispute is
-- ruled on by a named human at Yaadly, which this does not automate.

begin;

drop policy if exists "parties move an open dispute" on public.disputes;
create policy "parties move an open dispute" on public.disputes
  for update to authenticated
  using (
    state = 'direct'
    and exists (
      select 1 from public.jobs j
      where j.id = disputes.job_id
        and (
          lower(coalesce(j.client_email, '')) = lower(auth.jwt() ->> 'email')
          or lower(coalesce(j.worker_email, '')) = lower(auth.jwt() ->> 'email')
        )
    )
  )
  with check (
    exists (
      select 1 from public.jobs j
      where j.id = disputes.job_id
        and (
          lower(coalesce(j.client_email, '')) = lower(auth.jwt() ->> 'email')
          or lower(coalesce(j.worker_email, '')) = lower(auth.jwt() ->> 'email')
        )
    )
  );

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
  -- No request token means a migration, a cron job or another definer
  -- function, not a person at a page. The admin desk passes is_admin().
  if auth.jwt() is null or public.is_admin() then
    return new;
  end if;

  select lower(coalesce(j.client_email, '')) = me and me <> '',
         lower(coalesce(j.worker_email, '')) = me and me <> ''
    into is_client, is_worker
    from public.jobs j where j.id = old.job_id;

  if new.job_id is distinct from old.job_id
     or new.raised_by is distinct from old.raised_by
     or new.body is distinct from old.body
     or new.kinds is distinct from old.kinds
     or new.created_at is distinct from old.created_at then
    raise exception 'What was raised cannot be changed.';
  end if;

  if new.reply is distinct from old.reply then
    if not coalesce(is_worker, false) then
      raise exception 'Only the worker replies to a dispute.';
    end if;
    if old.reply is not null then
      raise exception 'The reply has been given and stays as it was written.';
    end if;
  end if;

  if new.state is distinct from old.state then
    if not coalesce(is_client, false) then
      raise exception 'Only the client can close or escalate a dispute.';
    end if;
    if old.state <> 'direct' or new.state not in ('resolved', 'escalated') then
      raise exception 'A dispute moves once, from open to sorted or to Yaadly.';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.disputes_each_side_moves_its_own_part() from public, anon, authenticated;

drop trigger if exists trg_disputes_each_side_moves_its_own_part on public.disputes;
create trigger trg_disputes_each_side_moves_its_own_part
  before update on public.disputes
  for each row execute function public.disputes_each_side_moves_its_own_part();

commit;
