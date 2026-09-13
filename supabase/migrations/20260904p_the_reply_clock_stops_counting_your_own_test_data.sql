-- A promise clock that counts your own QA is a clock nobody will trust, and it
-- will be ignored on the day it is right.
--
-- The first run of v_reply_clock reported sixteen people waiting and thirteen
-- past one working day. Reading them showed roughly three real people. The rest
-- were rows the founder had created herself while testing, several of which say
-- "TEST JOB, please ignore" in their own text. A number that is eighty percent
-- noise trains you to ignore the tile, and the tile is the only thing that
-- watches a promise made on four public pages.
--
-- Two exclusions, both narrow enough that a real enquiry cannot fall through:
--
--   status = 'test'   set by hand on rows that name themselves tests. A new
--                     status rather than 'replied', because marking an
--                     unanswered thing as answered would corrupt the very
--                     measurement this view exists to produce. 'binned' is
--                     excluded alongside it for the reason it always was on the
--                     intake queue: somebody read it and decided.
--   JOB-TEST%         conversation references minted by the test harness. A
--                     real reference is JOB-WA-, JOB-WEB- or JOB-SMS- followed
--                     by a timestamp, so the pattern cannot collide with one.
--
-- Deliberately NOT a general "looks like a test" heuristic. Guessing which of
-- somebody's clients are real is exactly the wrong place to be clever: a false
-- positive here hides a person who is waiting, which is worse than the noise
-- this is cleaning up.

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
    and coalesce(s.job_id, '') not like 'JOB-TEST%'
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
    and coalesce(e.status, 'new') not in ('replied', 'converted', 'test', 'binned');

comment on view public.v_reply_clock is
  'Everything nobody has answered yet, conversations and contact form enquiries together, excluding rows marked as tests. The clock runs from when the client first wrote, because that is what the promise on the public pages measures, and unanswered rows are measured against now(). Records only: nothing reads this to gate anything.';

grant select on public.v_reply_clock to authenticated;
