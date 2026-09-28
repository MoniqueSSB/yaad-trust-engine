-- Proof that the Completion Report's sign-off chain holds.
-- Run against the project inside a transaction you roll back, or with psql.
-- Creates TEST-CR- rows and removes them again.
--
-- WHAT IS BEING PROVED. The order is worker first, then a named person on the
-- desk, then the client (20260928160000). The tests that matter are the ones
-- that try to skip a step: the client reading before it is issued, somebody
-- other than the worker signing, a stale link signing a changed wording, and
-- the desk issuing what the worker never signed.

do $$
declare
  v_admin text := (select email from public.admins order by email limit 1);
  v_code  text;
  v_old   text;
  cnt     int;
  r       record;
begin
  create temp table t(n int generated always as identity, name text, result text) on commit drop;

  delete from public.portal_contacts where job_id like 'TEST-CR-%';
  delete from public.completion_report_events where job_id like 'TEST-CR-%';
  delete from public.completion_reports where job_id like 'TEST-CR-%';
  delete from public.jobs where id like 'TEST-CR-%';

  -- Fixtures go in with the jobs triggers off for this one statement:
  -- sync_job_status() would rewrite 'complete' to awaiting_payment without a
  -- paid fee invoice, and notify_client_on_job_change() would message the
  -- fixture addresses. Run it inside a transaction; the lock is brief.
  alter table public.jobs disable trigger user;
  insert into public.jobs (id, title, parish, client_name, client_email, descr, status, worker_name, worker_email, stage, is_test)
  values ('TEST-CR-1','Shower wall, test fixture','St Catherine','Test Client','test-cr-client@example.invalid','fixture','complete','Test Worker','test-cr-worker@example.invalid',2,true),
         ('TEST-CR-2','Unfinished, test fixture','St Catherine','Test Client','test-cr-client@example.invalid','fixture','evidence','Test Worker','test-cr-worker@example.invalid',1,true);
  alter table public.jobs enable trigger user;

  -- 1. Only the desk can draft.
  perform set_config('request.jwt.claims', json_build_object('email','test-cr-worker@example.invalid','role','authenticated')::text, true);
  begin
    perform public.save_completion_report('TEST-CR-1', array['Keep it dry'], null, 'test-model');
    insert into t(name,result) values ('1. a worker cannot draft','FAIL, it saved');
  exception when others then
    insert into t(name,result) values ('1. a worker cannot draft', case when SQLERRM like '%Admin only%' then 'PASS' else 'FAIL, '||SQLERRM end);
  end;

  perform set_config('request.jwt.claims', json_build_object('email', v_admin, 'role', 'authenticated')::text, true);

  -- 2. No report for unfinished work.
  begin
    perform public.save_completion_report('TEST-CR-2', array['x'], null, null);
    insert into t(name,result) values ('2. no report for an unfinished job','FAIL, it saved');
  exception when others then
    insert into t(name,result) values ('2. no report for an unfinished job', case when SQLERRM like '%finished job%' then 'PASS' else 'FAIL, '||SQLERRM end);
  end;

  perform public.save_completion_report('TEST-CR-1', array['Leave the shower unused for 48 hours','  ','Wipe down after use'], null, 'test-model');
  select array_length(care_notes,1) into cnt from public.completion_reports where job_id='TEST-CR-1';
  insert into t(name,result) values ('3. the draft saves, blank notes dropped', case when cnt = 2 then 'PASS' else 'FAIL, '||cnt end);

  -- 4. Issuing straight from draft skips the worker.
  begin
    perform public.issue_completion_report('TEST-CR-1', 'Test Admin');
    insert into t(name,result) values ('4. cannot issue what the worker never signed','FAIL, it issued');
  exception when others then
    insert into t(name,result) values ('4. cannot issue what the worker never signed', case when SQLERRM like '%worker has signed%' then 'PASS' else 'FAIL, '||SQLERRM end);
  end;

  -- 5. Accepting needs a name.
  begin
    perform public.accept_completion_report('TEST-CR-1', '');
    insert into t(name,result) values ('5. accepting needs a named person','FAIL, it accepted');
  exception when others then
    insert into t(name,result) values ('5. accepting needs a named person', case when SQLERRM like '%named person%' then 'PASS' else 'FAIL, '||SQLERRM end);
  end;

  select code into v_code from public.accept_completion_report('TEST-CR-1', 'Test Admin');

  -- 6. The client cannot read it yet.
  perform set_config('request.jwt.claims', json_build_object('email','test-cr-client@example.invalid','role','authenticated')::text, true);
  select case when public._completion_report_visible('TEST-CR-1') then 1 else 0 end into cnt;
  insert into t(name,result) values ('6. the client cannot see it before issue', case when cnt = 0 then 'PASS' else 'FAIL, visible' end);

  -- 7. The client cannot sign it.
  begin
    perform public.sign_completion_report('TEST-CR-1', v_code, 'Test Client', array['x'], null);
    insert into t(name,result) values ('7. only the worker can sign','FAIL, it signed');
  exception when others then
    insert into t(name,result) values ('7. only the worker can sign', case when SQLERRM like '%Only the worker%' then 'PASS' else 'FAIL, '||SQLERRM end);
  end;

  perform set_config('request.jwt.claims', json_build_object('email','test-cr-worker@example.invalid','role','authenticated')::text, true);
  select case when public._completion_report_visible('TEST-CR-1') then 1 else 0 end into cnt;
  insert into t(name,result) values ('8. the worker can see it once it is with them', case when cnt = 1 then 'PASS' else 'FAIL, not visible' end);

  -- 9. A wrong code fails closed.
  begin
    perform public.sign_completion_report('TEST-CR-1', 'ZZZZZZ', 'Test Worker', array['x'], null);
    insert into t(name,result) values ('9. a wrong code cannot sign','FAIL, it signed');
  exception when others then
    insert into t(name,result) values ('9. a wrong code cannot sign', case when SQLERRM like '%does not match%' then 'PASS' else 'FAIL, '||SQLERRM end);
  end;

  -- 10. A signature is a full name.
  begin
    perform public.sign_completion_report('TEST-CR-1', v_code, 'TW', array['x'], null);
    insert into t(name,result) values ('10. a signature needs a full name','FAIL, it signed');
  exception when others then
    insert into t(name,result) values ('10. a signature needs a full name', case when SQLERRM like '%full name%' then 'PASS' else 'FAIL, '||SQLERRM end);
  end;

  perform public.sign_completion_report('TEST-CR-1', v_code, 'Test Worker',
    array['Leave the shower unused for 72 hours','Wipe down after use'], 'Retiled the wall and fitted the mixer.');
  select count(*) into cnt from public.completion_reports where job_id='TEST-CR-1' and status='worker_signed' and worker_changed;
  insert into t(name,result) values ('11. the worker signs, and a change is recorded as a change', case when cnt = 1 then 'PASS' else 'FAIL' end);

  -- 12. A desk edit after signing is a new claim: new revision, back to draft, signature gone, old code dead.
  perform set_config('request.jwt.claims', json_build_object('email', v_admin, 'role', 'authenticated')::text, true);
  v_old := v_code;
  perform public.save_completion_report('TEST-CR-1', array['Leave the shower unused for 72 hours'], 'Retiled the wall and fitted the mixer.', null);
  select count(*) into cnt from public.completion_reports
   where job_id='TEST-CR-1' and rev = 2 and status='draft' and worker_signed_at is null and sign_code is null;
  insert into t(name,result) values ('12. a desk edit after signing reopens it as a new revision', case when cnt = 1 then 'PASS' else 'FAIL' end);

  select code into v_code from public.accept_completion_report('TEST-CR-1', 'Test Admin');
  perform set_config('request.jwt.claims', json_build_object('email','test-cr-worker@example.invalid','role','authenticated')::text, true);
  begin
    perform public.sign_completion_report('TEST-CR-1', v_old, 'Test Worker', array['x'], null);
    insert into t(name,result) values ('13. the link from before the edit cannot sign the new wording','FAIL, it signed');
  exception when others then
    insert into t(name,result) values ('13. the link from before the edit cannot sign the new wording', case when SQLERRM like '%does not match%' then 'PASS' else 'FAIL, '||SQLERRM end);
  end;
  perform public.sign_completion_report('TEST-CR-1', v_code, 'Test Worker', array['Leave the shower unused for 72 hours'], 'Retiled the wall and fitted the mixer.');
  select count(*) into cnt from public.completion_reports where job_id='TEST-CR-1' and worker_changed = false;
  insert into t(name,result) values ('14. signing unchanged records no change', case when cnt = 1 then 'PASS' else 'FAIL' end);

  -- 15. The worker cannot issue.
  begin
    perform public.issue_completion_report('TEST-CR-1', 'Test Worker');
    insert into t(name,result) values ('15. the worker cannot issue','FAIL, it issued');
  exception when others then
    insert into t(name,result) values ('15. the worker cannot issue', case when SQLERRM like '%Admin only%' then 'PASS' else 'FAIL, '||SQLERRM end);
  end;

  perform set_config('request.jwt.claims', json_build_object('email', v_admin, 'role', 'authenticated')::text, true);
  perform public.issue_completion_report('TEST-CR-1', 'Test Admin');

  perform set_config('request.jwt.claims', json_build_object('email','test-cr-client@example.invalid','role','authenticated')::text, true);
  select case when public._completion_report_visible('TEST-CR-1') then 1 else 0 end into cnt;
  insert into t(name,result) values ('16. the client sees it once issued', case when cnt = 1 then 'PASS' else 'FAIL' end);

  perform public.flag_completion_report('TEST-CR-1', 'The mixer brand is wrong.');
  select count(*) into cnt from public.portal_contacts where job_id='TEST-CR-1' and sender_role='client';
  insert into t(name,result) values ('17. a client flag lands in the desk inbox', case when cnt = 1 then 'PASS' else 'FAIL, '||cnt end);
  perform public.confirm_completion_report('TEST-CR-1');

  -- 18. The worker cannot confirm on the client's behalf.
  perform set_config('request.jwt.claims', json_build_object('email','test-cr-worker@example.invalid','role','authenticated')::text, true);
  begin
    perform public.confirm_completion_report('TEST-CR-1');
    insert into t(name,result) values ('18. only the client confirms','FAIL, it confirmed');
  exception when others then
    insert into t(name,result) values ('18. only the client confirms', case when SQLERRM like '%Only the client%' then 'PASS' else 'FAIL, '||SQLERRM end);
  end;

  select count(*) into cnt from public.completion_report_events where job_id='TEST-CR-1';
  insert into t(name,result) values ('19. every step is on the trail', case when cnt = 9 then 'PASS' else 'FAIL, '||cnt||' events' end);

  perform set_config('request.jwt.claims', '{}', true);

  create table if not exists public._cr_out (n int, name text, result text);
  delete from public._cr_out;
  insert into public._cr_out select n,name,result from t;

  delete from public.portal_contacts where job_id like 'TEST-CR-%';
  delete from public.completion_report_events where job_id like 'TEST-CR-%';
  delete from public.completion_reports where job_id like 'TEST-CR-%';
  delete from public.jobs where id like 'TEST-CR-%';
end $$;
select name, result from public._cr_out order by n;
drop table public._cr_out;
