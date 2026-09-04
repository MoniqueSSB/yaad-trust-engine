-- Proof that a WhatsApp location pin can only ever log the arrival it should.
-- Run against the project with execute_sql, or psql. Creates TEST-ARR- rows
-- and removes them again. All seven passed on 4 September 2026.
--
-- WHAT IS BEING PROVED. log_arrival_via_whatsapp is reachable from
-- yaad-inbound, which runs with --no-verify-jwt, and it writes to the Arrival
-- Log, which is the first link in the evidence chain both parties read. The
-- only thing identifying the sender is their phone number, so the tests that
-- matter are the two that try to get in with the wrong one.
--
-- Test 7 is the regression guard. The logic moved into _do_log_arrival() so
-- two doors could share it, and the portal's own log_arrival() was rewritten
-- to delegate. If that rewrite ever loses its session check, test 7 goes red
-- and an unsigned caller can write to the evidence chain.

do $$
declare
  cnt int; r record;
  jm text := '+18765700900123';
  uk text := '+447700900123';
begin
  create temp table t(n int generated always as identity, name text, result text) on commit drop;

  delete from public.arrival_log where job_id like 'TEST-ARR-%';
  delete from public.jobs where id like 'TEST-ARR-%';
  delete from public.worker_profiles where worker_email like 'test-arr-%';

  insert into public.worker_profiles (worker_email, name, phone, active)
  values ('test-arr-worker@example.invalid', 'Test Worker', jm, true);
  insert into public.worker_profiles (worker_email, name, phone, active)
  values ('test-arr-other@example.invalid', 'Other Worker', '+18765550001', true);

  insert into public.jobs (id, title, parish, client_name, client_email, client_phone, descr, status, worker_email, stage)
  values ('TEST-ARR-1','Roof, test fixture','Kingston','C','c@example.invalid','+18765559999','fixture','evidence','test-arr-worker@example.invalid',1);
  insert into public.jobs (id, title, parish, client_name, client_email, client_phone, descr, status, worker_email, stage)
  values ('TEST-ARR-2','Someone elses job','Kingston','C','c@example.invalid','+18765559999','fixture','evidence','test-arr-other@example.invalid',1);

  begin
    perform public.log_arrival_via_whatsapp('TEST-ARR-1', uk, 17.97, -76.79);
    insert into t(name,result) values ('1. colliding number refused','FAIL, it logged an arrival');
  exception when others then
    insert into t(name,result) values ('1. colliding number refused',
      case when SQLERRM like '%not the worker on this job%' then 'PASS' else 'FAIL, '||SQLERRM end);
  end;

  begin
    perform public.log_arrival_via_whatsapp('TEST-ARR-2', jm, 17.97, -76.79);
    insert into t(name,result) values ('2. cannot check in on another workers job','FAIL, it logged one');
  exception when others then
    insert into t(name,result) values ('2. cannot check in on another workers job',
      case when SQLERRM like '%not the worker on this job%' then 'PASS' else 'FAIL, '||SQLERRM end);
  end;

  select * into r from public.log_arrival_via_whatsapp('TEST-ARR-1', jm, 17.9714, -76.7931);
  insert into t(name,result) values ('3. the real worker checks in',
    case when r.already_logged_today = false then 'PASS, stage '||r.stage else 'FAIL' end);
  select count(*) into cnt from public.arrival_log
   where job_id='TEST-ARR-1' and lat is not null and far_from_site = false;
  insert into t(name,result) values ('4. coordinates stored, not flagged far from Kingston',
    case when cnt = 1 then 'PASS' else 'FAIL, '||cnt end);

  select * into r from public.log_arrival_via_whatsapp('TEST-ARR-1', jm, 17.9714, -76.7931);
  select count(*) into cnt from public.arrival_log where job_id='TEST-ARR-1';
  insert into t(name,result) values ('5. a second pin the same day adds no row',
    case when r.already_logged_today = true and cnt = 1 then 'PASS' else 'FAIL, logged='||r.already_logged_today||' rows='||cnt end);

  delete from public.arrival_log where job_id='TEST-ARR-1';
  perform public.log_arrival_via_whatsapp('TEST-ARR-1', jm, 18.47, -77.92);
  select count(*) into cnt from public.arrival_log where job_id='TEST-ARR-1' and far_from_site = true;
  insert into t(name,result) values ('6. a pin far from the parish is flagged, not refused',
    case when cnt = 1 then 'PASS' else 'FAIL, '||cnt end);

  begin
    perform public.log_arrival('TEST-ARR-1');
    insert into t(name,result) values ('7. portal door still needs a session','FAIL, it logged one');
  exception when others then
    insert into t(name,result) values ('7. portal door still needs a session',
      case when SQLERRM like '%Not signed in%' then 'PASS' else 'FAIL, '||SQLERRM end);
  end;

  create table if not exists public._arr_out (n int, name text, result text);
  delete from public._arr_out;
  insert into public._arr_out select n,name,result from t;

  delete from public.arrival_log where job_id like 'TEST-ARR-%';
  delete from public.jobs where id like 'TEST-ARR-%';
  delete from public.worker_profiles where worker_email like 'test-arr-%';
end $$;
select name, result from public._arr_out order by n;
drop table public._arr_out;
