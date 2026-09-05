-- Draft acceptance becomes a number.
--
-- WHY THIS METRIC AND NOT THE OBVIOUS ONE. "Percentage resolved without a
-- human" is the wrong headline for this business: the product is that a named
-- person decided, so a metric that improves when the person is removed argues
-- against the thing being sold. Draft acceptance is the honest inverse. It
-- measures whether the AI saved somebody time, and it can only improve by the
-- drafting getting better, never by a gate being taken out.
--
-- WHERE THE MOMENT IS. yaad-inbound drafts a report from a worker's update and
-- sends it to that worker with a plain choice: reply "1" to send it as
-- written, or type your own version and that goes instead. That single reply
-- is the only point at which anybody says whether the draft was good enough,
-- and it was recorded on a trace span and nowhere else. Spans are not
-- queryable, expire, and are off entirely unless an OTLP endpoint is
-- configured, so in practice the number did not exist.
--
-- WHY NOT IN relay_confirmed_report(). Because it cannot tell. yaad-inbound
-- resolves "1" into the stored draft text before calling it, so by the time
-- the RPC runs, an accepted draft and a rewrite that happens to match are the
-- same argument. Only the function that read the worker's reply knows.
--
-- KIND IS HERE FROM THE START so the report drafter can write the same rows
-- when it exists. One table answering "how often is a draft good enough"
-- across every drafter beats one per agent.

create table if not exists public.draft_decisions (
  id            bigint generated always as identity primary key,
  job_id        text        not null default '',
  stage         integer     not null default 0,
  kind          text        not null default 'evidence_report',
  accepted      boolean     not null,
  drafted_chars integer     not null default 0,
  sent_chars    integer     not null default 0,
  drafted_at    timestamptz,
  decided_at    timestamptz not null default now()
);

comment on table public.draft_decisions is
  'One row each time a person accepted or rewrote something an agent drafted. accepted = sent exactly as drafted. The honest measure of time saved, and unlike "resolved without a human" it cannot be improved by removing a gate.';

create index if not exists draft_decisions_kind_idx on public.draft_decisions (kind, decided_at desc);

alter table public.draft_decisions enable row level security;

drop policy if exists "draft_decisions_admin_read" on public.draft_decisions;
create policy "draft_decisions_admin_read" on public.draft_decisions
  for select using (is_admin());

revoke all on public.draft_decisions from anon;
grant select on public.draft_decisions to authenticated;
grant all on public.draft_decisions to service_role;

-- Rolling read, so the desk asks one question rather than doing arithmetic.
-- Thirty days because a lifetime figure stops moving and stops being looked
-- at, and this one is meant to be watched while the drafting is tuned.
create or replace view public.draft_acceptance
with (security_invoker = true) as
  select
    kind,
    count(*)                                                        as decisions,
    count(*) filter (where accepted)                                as accepted,
    round(100.0 * count(*) filter (where accepted) / nullif(count(*), 0)) as pct,
    round(avg(nullif(drafted_chars, 0)))                            as avg_drafted_chars
  from public.draft_decisions
 where decided_at > now() - interval '30 days'
 group by kind;

comment on view public.draft_acceptance is
  'Draft acceptance over the last 30 days, per drafter. Below roughly 60 percent a drafter is costing time rather than saving it and should be paused rather than tuned indefinitely.';

grant select on public.draft_acceptance to authenticated;
