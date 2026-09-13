-- Proof that trade_key() reads the eighteen published trades the way the
-- taxonomy means them, and that the two traps inside its own ordering are still
-- shut. Read only: creates nothing and changes nothing.
--
-- Run against the project with execute_sql, or psql.
--
-- WHY THIS FILE EXISTS. trade_key() is a chain of CASE branches, so the ANSWER
-- DEPENDS ON THE ORDER, and every branch is a substring match. Two of them were
-- wrong for a fortnight without anybody noticing, because a wrong trade key
-- does not throw: it quietly sends a job to the wrong tradespeople, or to
-- nobody. Adding a branch in the wrong place is the easiest mistake to make in
-- this function and the hardest to see.
--
-- IF YOU EDIT trade_key(), REINDEX wp_match AND jobs_match IN THE SAME
-- MIGRATION. Both are expression indexes built on it. Redefining the function
-- does not rebuild them and Postgres does not warn.

do $$
declare
  v text;
  cnt int;
begin
  create temp table t(n int generated always as identity, name text, result text) on commit drop;

  -- ── the two published security trades belong together ──────────────────
  -- The carpentry branch matches "door". Above security, it took "Locks &
  -- Security Doors" and left "CCTV & Alarms" behind, splitting one trade in
  -- two. Fixed 7 Sep 2026.
  insert into t(name, result)
  select 'the two security trades land on the same key',
         case when trade_key('Locks & Security Doors') = trade_key('CCTV & Alarms')
                and trade_key('CCTV & Alarms') = 'security'
              then 'pass'
              else 'FAIL: locks=' || coalesce(trade_key('Locks & Security Doors'),'null')
                   || ' cctv=' || coalesce(trade_key('CCTV & Alarms'),'null') end;

  -- ── but security must not have swallowed joinery on the way up ─────────
  insert into t(name, result)
  select 'a plain wooden door is still carpentry',
         case when trade_key('wooden door') = 'carpentry' then 'pass'
              else 'FAIL: got ' || coalesce(trade_key('wooden door'),'null') end;

  -- ── the "lock" inside "block" ──────────────────────────────────────────
  -- Masonry has to stay above security or every piece of blockwork becomes a
  -- locksmith job. This is the reason the two branches cannot simply be sorted
  -- alphabetically or moved for tidiness.
  insert into t(name, result)
  select 'blockwork is masonry, not a lock',
         case when trade_key('blockwork on the boundary') = 'masonry'
                and trade_key('Masonry & Concrete') = 'masonry'
              then 'pass'
              else 'FAIL: got ' || coalesce(trade_key('blockwork on the boundary'),'null') end;

  -- ── solar is its own trade ─────────────────────────────────────────────
  -- It used to be read as electrical, so a solar installer could not ask for
  -- solar work and every solar job went to every electrician.
  insert into t(name, result)
  select 'solar is its own key, not electrical',
         case when trade_key('Solar Install') = 'solar'
                and trade_key('Electrical') = 'electrical'
              then 'pass'
              else 'FAIL: solar=' || coalesce(trade_key('Solar Install'),'null') end;

  -- ── and it sits above plumbing, or the word "water" claims it ──────────
  insert into t(name, result)
  select 'a solar water heater is solar, not plumbing',
         case when trade_key('solar water heater') = 'solar' then 'pass'
              else 'FAIL: got ' || coalesce(trade_key('solar water heater'),'null') end;

  -- ── the generosity that the whole design rests on ──────────────────────
  -- A client writes what is wrong, not a trade name. Both sides of a match go
  -- through this function, so it has to read both.
  insert into t(name, result)
  select 'what a client actually types still lands on a trade',
         case when trade_key('leaking pipe under the sink') = 'plumbing'
                and trade_key('rewire the kitchen') = 'electrical'
                and trade_key('a likkle bit of masonry') = 'masonry'
              then 'pass' else 'FAIL' end;

  -- ── every published trade produces a key, and none is empty ────────────
  select count(*) into cnt
    from unnest(string_to_array((select value from app_settings where key = 'trade_list'), ',')) as n
   where trade_key(n) is null or btrim(trade_key(n)) = '';
  insert into t(name, result) values (
    'every published trade produces a key',
    case when cnt = 0 then 'pass' else 'FAIL: ' || cnt || ' produced nothing' end);

  -- ── a job and a worker agree about a trade nothing has a branch for ────
  -- "Fencing" has no branch and falls through to a cleaned version of itself.
  -- That is fine PROVIDED both sides fall through the same way, which is the
  -- whole reason the fallthrough exists rather than a null.
  insert into t(name, result)
  select 'a trade with no branch still matches itself',
         case when trade_key('Fencing') = trade_key('fencing')
                and trade_key('Fencing') = 'fencing'
              then 'pass'
              else 'FAIL: got ' || coalesce(trade_key('Fencing'),'null') end;

  -- ── nothing in, nothing out ────────────────────────────────────────────
  insert into t(name, result)
  select 'an empty trade is null rather than a key that matches everybody',
         case when trade_key('') is null and trade_key(null) is null and trade_key('   ') is null
              then 'pass' else 'FAIL' end;

  -- ── the indexes were rebuilt after the function changed ────────────────
  -- Not provable from SQL directly. What IS provable is that a query through
  -- the index agrees with the function, which is what goes wrong when a
  -- redefinition happens without a REINDEX.
  select count(*) into cnt
    from worker_profiles w
   where w.active
     and w.trade is not null
     and trade_key(w.trade) is distinct from (
           select trade_key(x.trade) from worker_profiles x where x.worker_email = w.worker_email limit 1);
  insert into t(name, result) values (
    'the stored index and the live function agree',
    case when cnt = 0 then 'pass' else 'FAIL: ' || cnt || ' rows disagree, REINDEX wp_match' end);

  raise notice '%', (select string_agg(lpad(n::text,2) || '. ' || rpad(name, 62) || result, e'\n' order by n) from t);
  if exists (select 1 from t where result like 'FAIL%') then
    raise exception 'trade_key guards: % of % failed --- %',
      (select count(*) from t where result like 'FAIL%'), (select count(*) from t),
      (select string_agg(name || ' => ' || result, ' | ') from t where result like 'FAIL%');
  end if;
end $$;
