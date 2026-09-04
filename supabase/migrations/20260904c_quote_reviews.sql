-- Every quote reviewed, kept.
--
-- The agent audit's roadmap item 9. The Pricing agent has existed since the
-- engine was written and ran nowhere: `yaad/agents/pricing.py` was imported by
-- `run_demo.py` and `tests/` and by nothing a client or the desk ever touched.
-- Its `review_quote()` is the Deposit Protection Check in miniature, and the
-- Deposit Protection Check is £149 on the published price list.
--
-- ── Why the log matters more than the panel ──
--
-- Yaadly's founding "why", in the founder's own words, is ending the farrin
-- price: pricing work against real costs so a client in London pays what a
-- client in Portmore pays. Four-agent research on 1 August 2026 confirmed
-- there are no public prices in Jamaica for painting, bathrooms, septic or
-- walls anywhere in the country. That gap is the reason the product exists,
-- and it is why `benchmarks.py` carries bands that say "no public price
-- exists" rather than a guess.
--
-- The only way that gap closes is one reviewed quote at a time. This table is
-- where they go. It is the proprietary price database the plan describes as
-- both a future product feature and an investor asset, and it starts empty.
--
-- ── What this is NOT ──
--
-- Not an estimate, and nothing here is shown to a client or a worker. CLAUDE.md
-- §5: pricing is a lookup, never a model, and Yaadly guarantees project
-- management and oversight judgment, not price estimation, which is QS work.
-- A band read next to a quote is a REFERENCE against completed jobs, with its
-- source and confidence attached, for a person to argue with. The audit flagged
-- the risk plainly: a band shown beside a worker's price reads as an estimate,
-- so this stays internal until the founder settles the wording.

create table if not exists public.quote_reviews (
  id            uuid primary key default gen_random_uuid(),
  -- The taxonomy trade as the desk knows it ("Grille & Gate Welding"), kept
  -- verbatim rather than mapped down, so a later regrouping of the benchmark
  -- families can be redone against what was actually reviewed.
  trade         text not null,
  variant       text,
  parish        text,
  job_id        text references public.jobs(id) on delete set null,
  quoted_jmd    numeric not null check (quoted_jmd > 0),

  -- What the lookup said AT THE TIME. Copied rather than referenced on
  -- purpose: benchmarks get revised, and a review has to stay readable as the
  -- judgement somebody actually made, against the numbers they actually saw.
  band_low_jmd  numeric,
  band_high_jmd numeric,
  confidence    text,
  source        text,
  verdict       text not null,

  -- The half that cannot be computed. A quote is high because access is bad,
  -- or because the spec changed, or because somebody is trying it on, and only
  -- a person knows which.
  notes         text,
  reviewed_by   text not null,
  created_at    timestamptz not null default now()
);

comment on table public.quote_reviews is
  'One reviewed quote, with the benchmark band as it read at the time. Internal only: never shown to a client or a worker. This is the seed of the price database that ending the farrin price depends on.';

comment on column public.quote_reviews.band_low_jmd is
  'The band at the moment of review, copied not referenced. Benchmarks get revised; a past judgement must stay readable against the numbers it was actually made against.';

create index if not exists quote_reviews_trade_created on public.quote_reviews (trade, created_at desc);

alter table public.quote_reviews enable row level security;

-- Admin only, both directions. There is no client or worker read policy here
-- and there should not be one: a band beside somebody's price reads as an
-- estimate, and estimating is the one thing Yaadly does not guarantee.
create policy quote_reviews_admin on public.quote_reviews
  for all using (public.is_admin()) with check (public.is_admin());
