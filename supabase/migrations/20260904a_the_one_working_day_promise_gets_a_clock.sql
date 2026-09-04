-- The reply clock.
--
-- "A person replies within one working day" appears on index.html,
-- services.html, business.html and marketplace.html. It is the promise Yaadly
-- makes most often, and until now nothing in this database recorded whether it
-- was kept. The desk Overview counts what is waiting; it has never been able to
-- say how long it has been waiting, so an enquiry nine minutes old and one four
-- days old were the same tile.
--
-- This adds the two timestamps that make the promise checkable, and one view
-- the desk reads. It does not change any behaviour: nothing here gates, blocks
-- or notifies. It only records.
--
-- Deliberately not a trigger on intake_threads.human_handling. yaad-inbound
-- sets that flag itself when it hands a conversation over, which is the agent
-- marking a thread FOR a person, not a person having replied. A trigger there
-- would log a reply that never happened, which is worse than no measurement.
-- The desk function sets it instead, at the point the message actually sends.

-- ── 1. The threads: WhatsApp, SMS, email and the website chat ───────────────
alter table public.intake_threads
  add column if not exists first_human_reply_at timestamptz;

comment on column public.intake_threads.first_human_reply_at is
  'When a named person first replied on this thread. Set once, by yaad-desk-reply, never cleared. Null means nobody has answered yet.';

-- ── 2. The contact form ────────────────────────────────────────────────────
alter table public.enquiries
  add column if not exists first_replied_at timestamptz;

comment on column public.enquiries.first_replied_at is
  'When this enquiry was first marked replied or converted. Set once by trg_enquiry_reply_clock, never cleared.';

create or replace function public.enquiry_reply_clock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Set once. A status bouncing replied -> new -> replied must not reset the
  -- clock, because the first answer is the one the promise is about.
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

-- ── 3. What the desk reads ─────────────────────────────────────────────────
-- One row per thing a person has not answered yet, oldest first. A view, so it
-- is read only to the browser (20260903g) and inherits the row level security
-- of the tables underneath it rather than inventing a second access rule.
--
-- One working day is 24 hours here, not a business-hours calculation. Yaadly's
-- clients are in the UK, the United States and Canada and the workers are in
-- Jamaica, so there is no shared working day to measure against, and a simple
-- number nobody has to interpret is worth more than a clever one that needs a
-- footnote. If that changes, change it here and nowhere else.
create or replace view public.v_reply_clock as
  select
    'thread'::text                                as kind,
    t.job_id                                      as ref,
    t.channel                                     as channel,
    t.last_at                                     as waiting_since,
    round(extract(epoch from (now() - t.last_at)) / 3600.0, 1) as hours_waiting,
    (now() - t.last_at) > interval '24 hours'     as breached
  from public.intake_threads t
  where t.first_human_reply_at is null
    and t.last_at is not null
  union all
  select
    'enquiry'::text,
    e.id::text,
    'form'::text,
    e.created_at,
    round(extract(epoch from (now() - e.created_at)) / 3600.0, 1),
    (now() - e.created_at) > interval '24 hours'
  from public.enquiries e
  where e.first_replied_at is null
    and coalesce(e.status, 'new') not in ('replied', 'converted');

comment on view public.v_reply_clock is
  'Everything nobody has answered yet, with how long it has been waiting. Backs the Oldest thing waiting tile on the desk Overview. Records only: nothing reads this to gate anything.';
