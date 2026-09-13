-- The one working day promise becomes measurable.
--
-- yaadly.co.uk says, in as many words, "a person replies within one working
-- day". It is on the services page, the business page and the desk pages. It
-- is the most concrete promise the site makes, and nothing in this system has
-- ever measured it. There is no timestamp for when a person first answered, no
-- age on any alert, and no way to say at the end of a week whether the promise
-- held. A promise nobody measures is a promise nobody keeps on purpose.
--
-- THREE COLUMNS, and they are deliberately the fewest that answer the
-- question rather than a general purpose event log.
--
--   first_client_at       when this person first wrote. The clock starts here.
--   first_human_reply_at  when a REAL PERSON first answered. Set once, by
--                         yaad-desk-reply, and never overwritten: the promise
--                         is about the first reply, not the most recent one.
--   awaiting_human_since  set when a thread is handed over, cleared when it is
--                         answered. This is what an alert can be sorted by.
--
-- WHY THE ASSISTANT'S REPLY DOES NOT COUNT. The site says "a PERSON replies".
-- Counting the assistant would make the number beautiful and meaningless, and
-- it would quietly turn the promise into something the site does not make. The
-- assistant answering fast is worth knowing and is measured separately; it is
-- not this.
--
-- WORKING DAYS ARE NOT COMPUTED HERE. Storing the timestamps and deriving the
-- answer in a view keeps the rule in one readable place, and the rule will
-- change (Jamaica public holidays, her own working pattern) more often than
-- the data shape will.

alter table public.intake_threads
  add column if not exists first_client_at      timestamptz,
  add column if not exists first_human_reply_at timestamptz,
  add column if not exists awaiting_human_since timestamptz;

comment on column public.intake_threads.first_client_at is
  'When this person first wrote. The start of the one working day clock.';
comment on column public.intake_threads.first_human_reply_at is
  'When a real person first answered, set once by yaad-desk-reply and never overwritten. The assistant answering does not count: the site promises a PERSON.';
comment on column public.intake_threads.awaiting_human_since is
  'Set when a thread is handed to a person, cleared when one replies. What the desk sorts its queue by.';

-- Backfill what can be honestly recovered. last_at is the only timestamp these
-- rows have ever carried, so it is the best available proxy for a first
-- message on a thread nobody has replied to. Threads that already have a
-- human on them are left null rather than guessed: a made up SLA figure is
-- worse than a missing one, because it would be quoted.
update public.intake_threads
   set first_client_at = last_at
 where first_client_at is null;

update public.intake_threads
   set awaiting_human_since = last_at
 where human_handling = true
   and awaiting_human_since is null
   and first_human_reply_at is null;

create index if not exists intake_threads_awaiting_idx
  on public.intake_threads (awaiting_human_since)
  where awaiting_human_since is not null;

-- ── the rule, in one readable place ──────────────────────────────────────
--
-- "Within one working day" means: if they wrote on a working day, a person
-- answered by the end of the next working day. Saturday and Sunday do not
-- count. Jamaica public holidays are NOT handled, deliberately: adding a
-- holiday table for a metric nobody has yet looked at once would be inventing
-- precision. When it matters, it goes here and nowhere else.
create or replace function public.within_one_working_day(p_from timestamptz, p_to timestamptz)
returns boolean
language sql
immutable
set search_path to 'public'
as $$
  select case
    when p_from is null or p_to is null then null
    else (
      -- Count working days strictly after the day they wrote, up to the day
      -- it was answered. Zero means same day, one means next working day.
      select count(*)
        from generate_series((p_from at time zone 'America/Jamaica')::date + 1,
                             (p_to   at time zone 'America/Jamaica')::date,
                             interval '1 day') d
       where extract(isodow from d) < 6
    ) <= 1
  end;
$$;

comment on function public.within_one_working_day(timestamptz, timestamptz) is
  'Did a reply land inside the promise on yaadly.co.uk? Same day or the next working day. Weekends do not count. Jamaica public holidays are deliberately not handled yet; when they matter they belong here and nowhere else.';

-- ── what the desk reads ──────────────────────────────────────────────────
create or replace view public.sla_first_reply
with (security_invoker = true) as
  select
    t.channel,
    t.from_addr,
    t.job_id,
    t.first_client_at,
    t.first_human_reply_at,
    t.awaiting_human_since,
    public.within_one_working_day(t.first_client_at, t.first_human_reply_at) as met,
    case
      when t.first_human_reply_at is not null
        then extract(epoch from (t.first_human_reply_at - t.first_client_at)) / 3600.0
      when t.awaiting_human_since is not null
        then extract(epoch from (now() - t.awaiting_human_since)) / 3600.0
    end as hours
  from public.intake_threads t;

comment on view public.sla_first_reply is
  'One row per conversation: when they wrote, when a person answered, whether that met the one working day promise on the site, and how many hours it took or has taken so far.';

grant select on public.sla_first_reply to authenticated;
