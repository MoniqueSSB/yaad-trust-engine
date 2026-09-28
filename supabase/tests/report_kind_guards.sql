-- Proof of the rules 20260928235000 added for a report on every service.
--
-- WHAT IS BEING PROVED.
--   * The three new kinds exist, and a made-up kind is refused.
--   * reports.human, where a person types a result, a status or money, can
--     only be written through set_report_human(): not at insert, and not by a
--     direct update, even from a session that could otherwise update the row.
--   * set_report_human() refuses anybody who is not a signed-in admin.
--   * The Visual Check and Property Care are the two unrated kinds, and only
--     those two.
--
-- The session running this has no admin JWT, so the admin-only paths are
-- proved by their refusal, the same approach report_guards.sql takes. The
-- rating refusal on an unrated kind sits behind the admin check in
-- report_stamp_rater; it is proved here through report_kind_is_rated(),
-- which is the whole of its condition.
--
-- Run with execute_sql or psql once the migration is applied. Creates rows
-- whose property starts TEST-RKG and removes them again.
do $$
declare ok boolean; msg text;
begin
  create temp table if not exists t(n int generated always as identity, name text, result text);
  delete from t;
  delete from public.reports where property like 'TEST-RKG%';

  -- 1. The three new kinds can be drafted.
  begin
    insert into public.reports (kind, client_name, property) values
      ('property_care', 'Test', 'TEST-RKG care'), ('oversight', 'Test', 'TEST-RKG oversight'), ('pm_stage', 'Test', 'TEST-RKG stage');
    insert into t(name,result) values ('1. the three new kinds are accepted', 'PASS');
  exception when others then
    insert into t(name,result) values ('1. the three new kinds are accepted', 'FAIL: '||SQLERRM);
  end;

  -- 2. A kind nobody sells is refused.
  begin
    insert into public.reports (kind, client_name, property) values ('valuation', 'Test', 'TEST-RKG valuation');
    insert into t(name,result) values ('2. an unknown kind is refused', 'FAIL: it was accepted');
  exception when check_violation then
    insert into t(name,result) values ('2. an unknown kind is refused', 'PASS');
  end;

  -- 3. A new report cannot arrive with a result or money already typed.
  begin
    insert into public.reports (kind, client_name, property, human)
    values ('pm_stage', 'Test', 'TEST-RKG pre-filled', '{"result":"complete"}'::jsonb);
    insert into t(name,result) values ('3. human cannot be set at insert', 'FAIL: it was accepted');
  exception when others then
    insert into t(name,result) values ('3. human cannot be set at insert',
      case when SQLERRM like '%starts with nothing typed by a person%' then 'PASS' else 'FAIL: '||SQLERRM end);
  end;

  -- 4. A direct update of human is refused. This is the one that matters:
  -- without it, any path that can update a report could type a result.
  begin
    update public.reports set human = '{"result":"complete"}'::jsonb where property = 'TEST-RKG stage';
    insert into t(name,result) values ('4. human cannot be updated directly', 'FAIL: it was written');
  exception when others then
    insert into t(name,result) values ('4. human cannot be updated directly',
      case when SQLERRM like '%typed at the desk, through set_report_human()%' then 'PASS' else 'FAIL: '||SQLERRM end);
  end;

  -- 5. set_report_human() refuses a session that is not an admin.
  begin
    perform public.set_report_human((select id from public.reports where property = 'TEST-RKG stage'), 'result', '"complete"'::jsonb);
    insert into t(name,result) values ('5. set_report_human needs an admin', 'FAIL: it wrote');
  exception when others then
    insert into t(name,result) values ('5. set_report_human needs an admin',
      case when SQLERRM like '%Only a signed-in Yaadly admin%' then 'PASS' else 'FAIL: '||SQLERRM end);
  end;

  -- 6. Exactly the two record-only kinds are unrated.
  select not public.report_kind_is_rated('visual_check') and not public.report_kind_is_rated('property_care')
     and public.report_kind_is_rated('condition') and public.report_kind_is_rated('technical_signoff')
     and public.report_kind_is_rated('deposit_check') and public.report_kind_is_rated('oversight')
     and public.report_kind_is_rated('pm_stage') into ok;
  insert into t(name,result) values ('6. only Visual Check and Property Care are unrated',
    case when ok then 'PASS' else 'FAIL: the list of unrated kinds is wrong' end);

  -- 7. The desk's list knows which reports still need a person's decision.
  select bool_and(needs_decision) into ok from public.v_reports_open where property in ('TEST-RKG stage', 'TEST-RKG oversight');
  insert into t(name,result) values ('7. a stage record and an oversight report start needing a decision',
    case when ok then 'PASS' else 'FAIL: needs_decision is not set' end);

  delete from public.reports where property like 'TEST-RKG%';
end $$;

select n, name, result from t order by n;
