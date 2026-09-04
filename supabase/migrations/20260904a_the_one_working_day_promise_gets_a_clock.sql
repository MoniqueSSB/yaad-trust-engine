-- The reply clock, the enquiries half.
--
-- REWRITTEN 4 September 2026, after reading the live database rather than
-- assuming. A parallel session had already shipped
-- `20260904105323_the_one_working_day_promise_becomes_measurable`, which added
-- first_client_at, first_human_reply_at and awaiting_human_since to
-- intake_threads, plus within_one_working_day() and the sla_first_reply view.
--
-- Theirs is better than what this file originally contained. It counts actual
-- working days in Jamaica time and skips weekends, where this file had a flat
-- 24 hour interval with a paragraph justifying it. Two clocks measuring the
-- same published promise by different rules is worse than either one alone, so
-- this file no longer defines a rule. It does two things their migration did
-- not:
--
--   1. The contact form. sla_first_reply covers conversations. An enquiry from
--      yaadly.co.uk is not a conversation and was not counted anywhere, and it
--      is the door a business client comes through.
--   2. One view the desk reads, over both, using THEIR working day rule.
--
-- Nothing here gates, blocks or notifies. It records.

-- ── the contact form ───────────────────────────────────────────────────────
alter table public.enquiries
  add column if not exists first_replied_at timestamptz;

comment on column public.enquiries.first_replied_at is
  'When this enquiry was first marked replied or converted. Set once by trg_enquiry_reply_clock, never cleared, because the promise is about the first answer and not the most recent one.';

create or replace function public.enquiry_reply_clock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Set once. A status bouncing replied, new, replied must not restart the
  -- clock and flatter the number.
  if new.first_replied_at is null
     and new.status is distinct from old.status
     and new.status in ('replied', 'converted')
  then
    new.first_replied_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enquiry_reply_clock on public.enquiries;
create trigger trg_enquiry_reply_clock
  before update on public.enquiries
  for each row execute function public.enquiry_reply_clock();

-- ── one view the desk reads ────────────────────────────────────────────────
-- Deliberately built ON TOP of sla_first_reply and within_one_working_day
-- rather than beside them. If the definition of the promise ever changes, it
-- changes in their function and this follows, which is the only arrangement
-- where the site, the desk and the database cannot drift apart.
--
-- security_invoker so it is read with the caller's own rights, matching
-- 20260903g and their own view.
-- Two things this deliberately does NOT take from sla_first_reply, found by
-- reading the live rows on 4 Sep 2026 rather than trusting the query:
--
--   `met`   is null while nobody has replied, because within_one_working_day()
--           needs two timestamps. Reading breached off it meant a thread that
--           had NEVER been answered came back breached = false, which is the
--           exact opposite of the truth and the one row this view exists to
--           surface. Unanswered rows are measured against now() instead.
--   `hours` is null unless the thread was formally handed over, so a client
--           the assistant is still talking to showed no elapsed time at all.
--
-- The clock runs from when the CLIENT FIRST WROTE, not from when the thread
-- became a person's problem. The promise on four public pages is "a person
-- replies within one working day", and that person's day starts when somebody
-- writes in, not when an assistant gives up. This over-reports rather than
-- under-reports, which is the right direction for a promise you have published.
create or replace view public.v_reply_clock
with (security_invoker = true) as
  select
    'thread'::text                              as kind,
    coalesce(s.job_id, s.from_addr)             as ref,
    s.channel                                   as channel,
    coalesce(s.first_client_at, s.awaiting_human_since) as waiting_since,
    round((extract(epoch from (now() - coalesce(s.first_client_at, s.awaiting_human_since))) / 3600.0)::numeric, 1) as hours_waiting,
    coalesce(public.within_one_working_day(
      coalesce(s.first_client_at, s.awaiting_human_since), now()), true) = false as breached
  from public.sla_first_reply s
  where s.first_human_reply_at is null
    and coalesce(s.first_client_at, s.awaiting_human_since) is not null
  union all
  select
    'enquiry'::text,
    e.id::text,
    'form'::text,
    e.created_at,
    round((extract(epoch from (now() - e.created_at)) / 3600.0)::numeric, 1),
    coalesce(public.within_one_working_day(e.created_at, now()), true) = false
  from public.enquiries e
  where e.first_replied_at is null
    and coalesce(e.status, 'new') not in ('replied', 'converted');

comment on view public.v_reply_clock is
  'Everything nobody has answered yet, conversations and contact form enquiries together, with how long it has been waiting and whether the one working day promise on yaadly.co.uk has been missed. Uses within_one_working_day() so there is exactly one definition of the promise. Records only: nothing reads this to gate anything.';

grant select on public.v_reply_clock to authenticated;
