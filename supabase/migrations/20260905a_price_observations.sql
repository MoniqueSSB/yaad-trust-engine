-- Every quote a worker submits is a real Jamaican price. Keep them all.
--
-- ── Why this is not quote_reviews ──
--
-- 20260904c_quote_reviews holds JUDGEMENTS: Monique looked at a figure, read
-- the band, and formed a view. Those are valuable and there will never be many
-- of them, because they cost her attention.
--
-- This holds OBSERVATIONS: a worker quoted this much, for this trade, in this
-- parish, on this day. No judgement, nobody's attention, and one lands every
-- time somebody quotes.
--
-- Merging the two was the obvious move and it is the wrong one. An automatic
-- row in a reviews table is a review nobody did, which is exactly the defect
-- the agent audit found in the Kickoff Pack on 4 September: a database row
-- reading approved_by "system: auto-issued, guardrail-clean" that stated a
-- judgement no human had made. Two tables, because they are two different
-- claims about the world.
--
-- ── Why it matters more than the panel it feeds ──
--
-- The founding "why", in the founder's own words, is ending the farrin price:
-- pricing work against real costs so a client in London pays what a client in
-- Portmore pays. Four-agent research on 1 August 2026 confirmed there are no
-- public prices in Jamaica for painting, bathrooms, septic or walls anywhere
-- in the country. yaad/benchmarks.py carries bands that say "no public price
-- exists" for exactly that reason, and they are correct answers rather than
-- gaps.
--
-- The only way that stops being true is one real price at a time. Relying on
-- a person to log each one by hand means it fills at the rate of somebody's
-- spare evening. This fills it at the rate the business actually runs.
--
-- ── No verdict column, deliberately ──
--
-- An observation is a fact. Whether it is high, low or sane is DERIVED, by
-- comparing it against a band that will itself be revised as this table grows.
-- Storing a verdict here would freeze today's opinion onto tomorrow's data,
-- and it would need the benchmark lookup, which lives in yaad/benchmarks.py
-- and has no business being reimplemented in a trigger. The desk already
-- computes the comparison at read time from the same generated bands.
--
-- Nothing here is ever shown to a client or a worker. A price observed on
-- somebody else's job is not a quote, and showing it as one would be exactly
-- the estimating Yaadly does not do.

create table if not exists public.price_observations (
  id             uuid primary key default gen_random_uuid(),
  quote_id       uuid not null references public.job_quotes(id) on delete cascade,
  job_id         text not null references public.jobs(id) on delete cascade,

  -- Copied, not joined. A quote can be edited and a job's trade corrected,
  -- and an observation has to stay true to what was quoted on the day.
  trade          text,
  parish         text,
  labour_jmd     integer not null,
  materials_jmd  integer,
  days_estimate  text,

  observed_at    timestamptz not null default now(),

  -- One row per quote. A resubmitted price replaces nothing: the original
  -- observation stays, because what somebody first asked for is itself a fact
  -- about the market.
  unique (quote_id)
);

comment on table public.price_observations is
  'One real quoted price per submitted quote: trade, parish, labour, materials, days. Observations, not judgements; quote_reviews holds those. Never shown to a client or a worker. This is the price database that ending the farrin price depends on, and it fills at the rate the business runs rather than the rate somebody logs things by hand.';

comment on column public.price_observations.labour_jmd is
  'The labour figure as quoted on the day. Copied rather than joined, so a later edit to the quote cannot rewrite history.';

create index if not exists price_observations_trade on public.price_observations (trade, observed_at desc);
create index if not exists price_observations_parish on public.price_observations (parish, observed_at desc);

alter table public.price_observations enable row level security;

-- Admin only, both directions, and no party read policy on purpose. A price
-- observed on another client's job is not this client's quote, and a worker
-- seeing what others charge is a different product with different consequences.
create policy price_observations_admin on public.price_observations
  for all using (public.is_admin()) with check (public.is_admin());

-- ── recorded by the state change, never by the UI ──
--
-- This repository's own rule, set on 31 August 2026 when quote notifications
-- moved off the UI and onto a trigger: state changes fire the follow-on work,
-- never the screen that caused them. A quote submitted from the portal, from
-- the desk, or from anywhere added later all land here identically.
create or replace function public.record_price_observation()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_trade  text;
  v_parish text;
begin
  -- A quote with no labour figure is not a price. The column is NOT NULL, so
  -- this is belt and braces against a future default of 0 meaning "not said".
  if coalesce(new.labour_jmd, 0) <= 0 then
    return new;
  end if;

  select j.trade, j.parish into v_trade, v_parish from public.jobs j where j.id = new.job_id;

  insert into public.price_observations
    (quote_id, job_id, trade, parish, labour_jmd, materials_jmd, days_estimate)
  values
    (new.id, new.job_id, v_trade, v_parish, new.labour_jmd, new.materials_jmd, new.days_estimate)
  on conflict (quote_id) do nothing;

  return new;
end;
$$;

drop trigger if exists trg_record_price_observation on public.job_quotes;
create trigger trg_record_price_observation
  after insert on public.job_quotes
  for each row execute function public.record_price_observation();

revoke all on function public.record_price_observation() from public, anon, authenticated;

-- Backfill what has already been quoted. These are real prices that happened
-- and there is no reason to start the record from today.
insert into public.price_observations (quote_id, job_id, trade, parish, labour_jmd, materials_jmd, days_estimate, observed_at)
select q.id, q.job_id, j.trade, j.parish, q.labour_jmd, q.materials_jmd, q.days_estimate, q.created_at
  from public.job_quotes q
  join public.jobs j on j.id = q.job_id
 where coalesce(q.labour_jmd, 0) > 0
on conflict (quote_id) do nothing;
