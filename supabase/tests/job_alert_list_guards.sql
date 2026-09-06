-- Proof that the job alert list holds its four promises: nobody can be put on
-- it or taken off it except by the number that sent the message, a stop is a
-- record rather than a deletion, an answer nobody understood writes nothing,
-- and none of the four doors is reachable from the open internet.
--
-- Run against the project with execute_sql, or psql. It creates one row on a
-- reserved fiction number and removes it again.
--
-- WHY THE OPEN INTERNET CHECK IS HERE AND NOT ONLY IN THE MIGRATION. PostgREST
-- publishes every function in the public schema that the caller's role may
-- execute, and Supabase grants EXECUTE to anon and authenticated by default.
-- A SECURITY DEFINER function is therefore live at /rest/v1/rpc/<name> the
-- moment it exists unless something takes it off, and a later CREATE OR
-- REPLACE from a different session can put the default grants back without
-- anybody noticing. Asserting it here means the check survives the migration.

do $$
declare
  r text;
  v boolean;
  cnt int;
  arr text[];
  -- Ofcom's reserved drama range. Never assigned to a real person.
  ph text := '447700900321';
begin
  create temp table t(n int generated always as identity, name text, result text) on commit drop;

  -- ── setting trades for a number nobody has subscribed ──────────────────
  begin
    perform set_job_alert_trades(ph, 'plumbing');
    insert into t(name, result) values ('a stranger cannot be given trades', 'FAIL: it was allowed');
  exception when others then
    insert into t(name, result) values (
      'a stranger cannot be given trades',
      case when sqlerrm like '%not on the alert list%' then 'pass' else 'FAIL: ' || sqlerrm end);
  end;

  -- ── joining ────────────────────────────────────────────────────────────
  perform subscribe_to_job_alerts(ph, 'ALERTS', 'alerts-test');
  select listening into v from job_alert_subscribers where phone = ph;
  insert into t(name, result) values (
    'joining alone does not make somebody listening',
    case when v is false then 'pass' else 'FAIL: listening with no trades and no parishes' end);

  -- ── an answer nobody understood writes nothing ─────────────────────────
  select matched into arr from set_job_alert_trades(ph, 'unicorn wrangling');
  select trade_keys into arr from job_alert_subscribers where phone = ph;
  insert into t(name, result) values (
    'an answer nobody understood leaves the list alone',
    case when coalesce(cardinality(arr), 0) = 0 then 'pass'
         else 'FAIL: wrote ' || array_to_string(arr, ',') end);

  -- ── a real answer, and the normaliser both sides share ─────────────────
  perform set_job_alert_trades(ph, 'plumbing, tiling and a likkle bit of masonry');
  perform set_job_alert_parishes(ph, 'Portmore and Kingston 8');
  select trade_keys into arr from job_alert_subscribers where phone = ph;
  insert into t(name, result) values (
    'what they said is read with the same normaliser the matcher uses',
    case when arr @> array['plumbing','tiling','masonry'] then 'pass'
         else 'FAIL: got ' || array_to_string(arr, ',') end);

  select parish_keys into arr from job_alert_subscribers where phone = ph;
  insert into t(name, result) values (
    'a town becomes its parish, and two towns in one parish become one entry',
    case when arr @> array['st catherine','st andrew'] and cardinality(arr) = 2 then 'pass'
         else 'FAIL: got ' || array_to_string(arr, ',') end);

  select listening into v from job_alert_subscribers where phone = ph;
  insert into t(name, result) values (
    'a trade and a parish together make somebody listening',
    case when v then 'pass' else 'FAIL: still not listening' end);

  -- ── stopping ───────────────────────────────────────────────────────────
  perform stop_job_alerts(ph);
  select count(*) into cnt from job_alert_subscribers where phone = ph;
  select listening into v from job_alert_subscribers where phone = ph;
  insert into t(name, result) values (
    'a stop is recorded, not deleted',
    case when cnt = 1 and v is false then 'pass'
         else 'FAIL: rows ' || cnt || ', listening ' || coalesce(v::text,'null') end);

  -- Somebody who has stopped and then answers a stray question must stay
  -- stopped. This is the one that would quietly resubscribe people.
  perform set_job_alert_parishes(ph, 'anywhere');
  select listening into v from job_alert_subscribers where phone = ph;
  insert into t(name, result) values (
    'answering a question after stopping does not put somebody back on',
    case when v is false then 'pass' else 'FAIL: resubscribed by a stray answer' end);

  -- ── rejoining ──────────────────────────────────────────────────────────
  perform subscribe_to_job_alerts(ph, 'ALERTS', 'alerts-test-2');
  select listening into v from job_alert_subscribers where phone = ph;
  insert into t(name, result) values (
    'rejoining lifts the stop and keeps what they already chose',
    case when v then 'pass' else 'FAIL: still stopped' end);

  select consent_version into r from job_alert_subscribers where phone = ph;
  insert into t(name, result) values (
    'coming back records the wording in force today, not the old one',
    case when r = 'alerts-test-2' then 'pass' else 'FAIL: kept ' || r end);

  -- ── the generated column cannot be written round ───────────────────────
  begin
    update job_alert_subscribers set listening = true where phone = ph;
    insert into t(name, result) values ('listening cannot be set by hand', 'FAIL: it was allowed');
  exception when others then
    insert into t(name, result) values ('listening cannot be set by hand', 'pass');
  end;

  delete from job_alert_subscribers where phone = ph;

  -- ── none of the doors is on the open internet ──────────────────────────
  -- has_function_privilege on the oid, rather than on a name rebuilt from
  -- pg_get_function_identity_arguments: that returns parameter names as well
  -- as types on this server, so casting it to regprocedure fails.
  for r, cnt in
    select p.proname, p.oid::int
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('subscribe_to_job_alerts','set_job_alert_trades',
                         'set_job_alert_parishes','stop_job_alerts',
                         'job_alert_trade_keys','job_alert_parish_keys','job_alert_split')
  loop
    select has_function_privilege('anon', cnt::oid, 'EXECUTE') into v;
    insert into t(name, result) values (
      r || ' is not callable by anon',
      case when v then 'FAIL: reachable at /rest/v1/rpc/' || r else 'pass' end);

    select has_function_privilege('authenticated', cnt::oid, 'EXECUTE') into v;
    insert into t(name, result) values (
      r || ' is not callable by a signed-in stranger',
      case when v then 'FAIL: reachable by authenticated' else 'pass' end);
  end loop;

  -- ── the desk view reads through RLS, it does not go round it ───────────
  select exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'v_job_alert_subscribers'
       and c.reloptions::text like '%security_invoker=true%'
  ) into v;
  insert into t(name, result) values (
    'the desk view is security_invoker, so row level security still applies',
    case when v then 'pass' else 'FAIL: the view runs as its owner and carries phone numbers' end);

  -- ── the table itself ───────────────────────────────────────────────────
  select relrowsecurity into v from pg_class where oid = 'public.job_alert_subscribers'::regclass;
  insert into t(name, result) values (
    'the list has row level security on',
    case when v then 'pass' else 'FAIL: RLS is off' end);

  raise notice '%', (select string_agg(lpad(n::text,2) || '. ' || rpad(name, 68) || result, e'\n' order by n) from t);
  if exists (select 1 from t where result like 'FAIL%') then
    raise exception 'job alert list guards: % of % failed',
      (select count(*) from t where result like 'FAIL%'), (select count(*) from t);
  end if;
end $$;
