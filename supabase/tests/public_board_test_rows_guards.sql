-- Proof that a row a person marked as a test stays off the public board, and
-- that only a signed-in admin can do the marking. Run against the project
-- with execute_sql, or psql. Creates TEST-PB- rows and removes them again.
-- All six passed on 9 September 2026.
--
-- WHAT IS BEING PROVED. open_jobs and public_worker_profiles are granted to
-- anon, so everything they return is published. 20260909150000 added
-- is_test to jobs and worker_profiles and an "and is_test = false" clause to
-- the public views. If a later migration redefines one of those views and
-- forgets the clause, which is exactly how 20260907090000's own clause was
-- nearly lost to 20260905a, tests 1 and 4 go red.
--
-- Tests 3 and 6 run with no JWT, so is_admin() is false and the two marker
-- functions must refuse. If either ever stops refusing, anybody with the
-- publishable key can pull a real job off the board or put a test worker on.

do $$
declare
  cnt int; r record;
begin
  create temp table t(n int generated always as identity, name text, result text) on commit drop;

  delete from public.jobs where id like 'TEST-PB-%';
  delete from public.worker_profiles where worker_email like 'test-pb-%';

  -- a job shaped exactly like a live board row: open, no worker, stage 0
  insert into public.jobs (id, title, parish, client_name, client_email, descr, status, open, stage)
  values ('TEST-PB-1', 'Board fixture', 'Kingston', 'C', 'c@example.invalid', 'fixture', 'open_for_quotes', true, 0);

  select count(*) into cnt from public.open_jobs where id = 'TEST-PB-1';
  insert into t(name,result) values ('0. an unmarked open job is on the board',
    case when cnt = 1 then 'PASS' else 'FAIL, '||cnt end);

  update public.jobs set is_test = true where id = 'TEST-PB-1';
  select count(*) into cnt from public.open_jobs where id = 'TEST-PB-1';
  insert into t(name,result) values ('1. marked as a test, it leaves the board',
    case when cnt = 0 then 'PASS' else 'FAIL, still listed' end);

  update public.jobs set is_test = false where id = 'TEST-PB-1';
  select count(*) into cnt from public.open_jobs where id = 'TEST-PB-1';
  insert into t(name,result) values ('2. marked as real again, it is back',
    case when cnt = 1 then 'PASS' else 'FAIL, '||cnt end);

  begin
    perform public.mark_job_test('TEST-PB-1', true);
    insert into t(name,result) values ('3. mark_job_test refuses without an admin session','FAIL, it ran');
  exception when others then
    insert into t(name,result) values ('3. mark_job_test refuses without an admin session',
      case when SQLERRM like '%signed-in admin%' then 'PASS' else 'FAIL, '||SQLERRM end);
  end;

  -- a worker shaped like a live directory row: active
  insert into public.worker_profiles (worker_email, name, trade, parish, active, slug)
  values ('test-pb-worker@example.invalid', 'Directory fixture', 'plumbing', 'Kingston', true, 'test-pb-fixture');

  update public.worker_profiles set is_test = true where worker_email = 'test-pb-worker@example.invalid';
  select count(*) into cnt from public.public_worker_profiles where slug = 'test-pb-fixture';
  insert into t(name,result) values ('4. a worker marked as a test is out of the directory',
    case when cnt = 0 then 'PASS' else 'FAIL, still listed' end);

  update public.worker_profiles set is_test = false where worker_email = 'test-pb-worker@example.invalid';
  select count(*) into cnt from public.public_worker_profiles where slug = 'test-pb-fixture';
  insert into t(name,result) values ('5. marked as real again, they are back',
    case when cnt = 1 then 'PASS' else 'FAIL, '||cnt end);

  begin
    perform public.mark_worker_test('test-pb-worker@example.invalid', true);
    insert into t(name,result) values ('6. mark_worker_test refuses without an admin session','FAIL, it ran');
  exception when others then
    insert into t(name,result) values ('6. mark_worker_test refuses without an admin session',
      case when SQLERRM like '%signed-in admin%' then 'PASS' else 'FAIL, '||SQLERRM end);
  end;

  delete from public.jobs where id like 'TEST-PB-%';
  delete from public.worker_profiles where worker_email like 'test-pb-%';

  for r in select * from t order by n loop
    raise notice '% : %', r.name, r.result;
  end loop;
end $$;

-- Through the Supabase MCP, which drops notices, run this variant instead.
-- It ends by raising the summary as an exception, so the results come back
-- in the error text and the rollback removes the fixtures a second time:
--
--   ... same body, with the loop replaced by ...
--   for r in select * from t order by n loop
--     summary := summary || r.name || ' : ' || r.result || E'\n';
--   end loop;
--   raise exception E'RESULTS\n%', summary;
