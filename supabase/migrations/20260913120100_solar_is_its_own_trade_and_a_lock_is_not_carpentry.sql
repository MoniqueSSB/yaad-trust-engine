-- RENAMED 13 September 2026, content unchanged. Written and applied to
-- production on 7 September 2026 as 20260907091500. Main gained nine migrations in the
-- meantime, and scripts/check-migration-order.mjs requires a new file to sort
-- after every migration already on the base branch, so the filename moved and
-- nothing else did. Applying it again is safe: every statement is CREATE OR
-- REPLACE, IF NOT EXISTS, or an idempotent update.

-- Two faults in trade_key(), found on 6 September 2026 while building the job
-- alert list and fixed here on their own, because trade_key decides who hears
-- about a job and changing it is not something to do inside another change.
--
-- The live definition was read back with pg_get_functiondef before this was
-- written, not copied from 20260826_yaad_match.sql, per RUNBOOK section 18. It
-- matched that file exactly.
--
-- FAULT 1, AND IT IS AN ORDERING ACCIDENT RATHER THAN A DECISION. Two of the
-- eighteen published trades are security work: "Locks & Security Doors" and
-- "CCTV & Alarms". They landed on two different keys. The carpentry branch
-- matches the word "door" and sat above the security branch, so locks and
-- security doors were read as carpentry while CCTV and alarms were read as
-- security. Nobody chose that. Security now sits above carpentry and the two
-- published trades land together. Masonry stays above security, which matters:
-- its pattern catches "block" before the security pattern can catch the "lock"
-- inside it, so blockwork is still masonry.
--
-- FAULT 2, AND THIS ONE IS A REAL DECISION. "Solar Install" was read as
-- electrical, because the electrical branch listed solar and inverter among
-- its own words. A solar installer therefore could not ask for solar work
-- alone, and every solar job went to every electrician on the island. Solar is
-- now its own key, and it sits at the top so that "solar water heater" is read
-- as solar rather than being caught by the plumbing branch on the word water.
--
-- THE COST OF FAULT 2's FIX, SAID PLAINLY. worker_profiles still holds ONE
-- trade per worker, so an electrician who also fits solar can only be on one
-- key, and splitting solar out narrows who a solar job reaches until that
-- column becomes an array. The job alert list already holds an array
-- (job_alert_subscribers.trade_keys), so a subscriber can say both today. The
-- alternative was leaving a solar specialist unable to ask for solar work at
-- all, which is worse, and the founding promise of this business is that
-- somebody gets the work they actually do.
--
-- WHAT IS DELIBERATELY NOT CHANGED. "Water Tank & Pump" and "Drainage &
-- Septic" still read as plumbing. Both are plumbing work, a plumber does them,
-- and separating them would narrow matching for nothing. "Fencing" still falls
-- through to its own key, 'fencing', which is self consistent: a job and a
-- worker both go through this function, so both land on the same fallthrough.

create or replace function public.trade_key(p text)
returns text
language sql
immutable
parallel safe
set search_path to 'public'
as $function$
  select case
    when p is null or btrim(p) = '' then null
    -- Above plumbing on purpose: a solar water heater is solar work, and the
    -- plumbing branch would otherwise claim it on the word water.
    when lower(p) ~ '(solar|photovoltaic|pv panel)' then 'solar'
    when lower(p) ~ '(plumb|pipe|drain|septic|soakaway|tank|pump|water)' then 'plumbing'
    when lower(p) ~ '(electric|wiring|rewire|inverter|consumer unit|breaker)' then 'electrical'
    when lower(p) ~ '(roof|zinc|shingle|gutter|purlin)' then 'roofing'
    when lower(p) ~ '(tile|tiling|wet ?room)' then 'tiling'
    -- Above security, so "blockwork" is masonry rather than being caught by
    -- the "lock" inside the word "block".
    when lower(p) ~ '(mason|block|concrete|render|plaster|wall|slab)' then 'masonry'
    when lower(p) ~ '(paint|decorat)' then 'painting'
    when lower(p) ~ '(grille|grill|gate|weld|burglar bar)' then 'grille and gate'
    when lower(p) ~ '(air ?con|a/?c|hvac|split unit)' then 'air conditioning'
    -- Above carpentry, so "Locks & Security Doors" lands on security with
    -- "CCTV & Alarms" instead of on carpentry via the word "door".
    when lower(p) ~ '(lock|security door|cctv|alarm|camera)' then 'security'
    when lower(p) ~ '(carpent|joiner|cabinet|wood|door|shelv)' then 'carpentry'
    when lower(p) ~ '(landscap|garden|yard|tree)' then 'landscaping'
    when lower(p) ~ '(window|glaz|glass)' then 'windows'
    when lower(p) ~ '(handy|general repair|odd job|small repair)' then 'handyman'
    else regexp_replace(lower(btrim(p)), '[^a-z ]+', ' ', 'g')
  end;
$function$;

comment on function public.trade_key(text) is
  'Free-text trade to a trade key. Deliberately generous: "leaking pipe" and "Plumbing & drainage" both land on plumbing. Solar is its own key and sits above plumbing; security sits above carpentry so a lock is not read as joinery. Two expression indexes are built on this function, so redefining it means REINDEXing them in the same migration.';


-- ── the part that is easy to forget, and silent when you do ──────────────
-- wp_match and jobs_match are btree indexes on trade_key(trade). Redefining
-- the function does not rebuild them, and Postgres does not warn: the index
-- keeps the values the OLD function produced, and a query that uses it returns
-- the wrong workers while looking perfectly healthy. Both are rebuilt here.
reindex index public.wp_match;
reindex index public.jobs_match;


-- ── stored keys have to be recomputed too ────────────────────────────────
-- job_alert_subscribers.trade_keys holds the OUTPUT of this function rather
-- than calling it at read time, because the GIN index that matching will use
-- needs a real column. That makes it a cache of a function that just changed.
-- Recomputed from the words each person actually said, which are kept in
-- .trades for exactly this reason.
update public.job_alert_subscribers s
   set trade_keys = (
         select coalesce(array_agg(distinct public.trade_key(w)), '{}')
           from unnest(s.trades) as w
          where public.trade_key(w) is not null
       ),
       updated_at = now()
 where coalesce(array_length(s.trades, 1), 0) > 0;
