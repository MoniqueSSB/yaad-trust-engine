-- Proof that the Completion Report stays the worker's document.
-- Run it INSIDE a transaction you roll back:
--   begin; <this file>; rollback;
-- It switches the user triggers on jobs, completion_reports and disputes off
-- for its own run, so nothing is messaged, and switches them back on.
-- Creates TEST-CR- rows (and a test-cr- worker profile) and removes them again.
--
-- WHAT IS BEING PROVED (20260928200000, 20260928210000). The report starts on
-- its own and goes to the worker. Only the worker writes and signs the words.
-- The automatic screen can hold a report but never change it. Nobody at
-- Yaadly can edit the words, only release a held report unchanged or send it
-- back with a reason. The client never sees it before it is issued, and their
-- "something is wrong" is a dispute.

do $$
declare
  v_admin text := (select email from public.admins order by email limit 1);
  v_code  text;
  v_old   text;
  v_out   text;
  cnt     int;
begin
  create temp table t(n int generated always as identity, name text, result text) on commit drop;

  alter table public.jobs disable trigger user;
  alter table public.completion_reports disable trigger user;
  alter table public.disputes disable trigger user;

  delete from public.disputes where job_id like 'TEST-CR-%';
  delete from public.completion_report_events where job_id like 'TEST-CR-%';
  delete from public.completion_reports where job_id like 'TEST-CR-%';
  delete from public.jobs where id like 'TEST-CR-%';
  delete from public.worker_profiles where worker_email like 'test-cr-%';

  insert into public.worker_profiles (worker_email, name, phone, active)
  values ('test-cr-worker@example.invalid', 'Test Worker', '+18765700900777', true);

  insert into public.jobs (id, title, parish, client_name, client_email, descr, status, worker_name, worker_email, stage, is_test)
  values ('TEST-CR-1','Shower wall, test fixture','St Catherine','Test Client','test-cr-client@example.invalid','fixture','complete','Test Worker','test-cr-worker@example.invalid',2,true),
         ('TEST-CR-2','Unfinished, test fixture','St Catherine','Test Client','test-cr-client@example.invalid','fixture','evidence','Test Worker','test-cr-worker@example.invalid',1,true);

  insert into t(name,result) values ('1. no signed-in person can start or screen a report',
    case when not has_function_privilege('authenticated','public._start_completion_report(text,text[],text)','execute')
          and not has_function_privilege('authenticated','public._screen_completion_report(text,int,jsonb)','execute')
         then 'PASS' else 'FAIL, callable' end);

  insert into t(name,result) values ('2. the desk has no way to write the words',
    case when to_regprocedure('public.save_completion_report(text,text[],text,text)') is null
          and to_regprocedure('public.accept_completion_report(text,text)') is null
          and to_regprocedure('public.issue_completion_report(text,text)') is null
         then 'PASS' else 'FAIL, an edit function exists' end);

  select public._start_completion_report('TEST-CR-2', array['x'], 'test-model') into v_out;
  insert into t(name,result) values ('3. no report for an unfinished job', case when v_out = 'not_complete' then 'PASS' else 'FAIL, '||v_out end);

  select public._start_completion_report('TEST-CR-1', array['Leave the shower unused for 48 hours','  ','Wipe down after use'], 'test-model') into v_out;
  select count(*) into cnt from public.completion_reports
   where job_id='TEST-CR-1' and status='with_worker' and array_length(care_notes,1)=2 and sign_code is not null;
  insert into t(name,result) values ('4. a finished job starts with the worker', case when v_out='started' and cnt=1 then 'PASS' else 'FAIL, '||v_out end);

  select public._start_completion_report('TEST-CR-1', array['again'], 'test-model') into v_out;
  insert into t(name,result) values ('5. starting twice does nothing', case when v_out = 'exists' then 'PASS' else 'FAIL, '||v_out end);
  select sign_code into v_code from public.completion_reports where job_id='TEST-CR-1';

  perform set_config('request.jwt.claims', json_build_object('email','test-cr-client@example.invalid','role','authenticated')::text, true);
  insert into t(name,result) values ('6. the client cannot see it while it is with the worker',
    case when not public._completion_report_visible('TEST-CR-1') then 'PASS' else 'FAIL, visible' end);
  begin
    perform public.sign_completion_report('TEST-CR-1', v_code, array['x'], null);
    insert into t(name,result) values ('7. only the worker can sign','FAIL, it signed');
  exception when others then
    insert into t(name,result) values ('7. only the worker can sign', case when SQLERRM like '%Only the worker%' then 'PASS' else 'FAIL, '||SQLERRM end);
  end;

  perform set_config('request.jwt.claims', json_build_object('email','test-cr-worker@example.invalid','role','authenticated')::text, true);
  begin
    perform public.sign_completion_report('TEST-CR-1', 'ZZZZZZ', array['x'], null);
    insert into t(name,result) values ('8. a wrong code cannot sign','FAIL, it signed');
  exception when others then
    insert into t(name,result) values ('8. a wrong code cannot sign', case when SQLERRM like '%out of date%' then 'PASS' else 'FAIL, '||SQLERRM end);
  end;
  perform set_config('request.jwt.claims', '{}', true);
  begin
    perform public.sign_completion_report_via_whatsapp('TEST-CR-1', '+447700900999');
    insert into t(name,result) values ('9. the WhatsApp button from another number cannot sign','FAIL, it signed');
  exception when others then
    insert into t(name,result) values ('9. the WhatsApp button from another number cannot sign', case when SQLERRM like '%from this number%' then 'PASS' else 'FAIL, '||SQLERRM end);
  end;
  perform set_config('request.jwt.claims', json_build_object('email','test-cr-worker@example.invalid','role','authenticated')::text, true);
  perform public.sign_completion_report('TEST-CR-1', v_code,
    array['Leave the shower unused for 72 hours'], 'Retiled the wall. Materials cost J$45,000.');
  select count(*) into cnt from public.completion_reports
   where job_id='TEST-CR-1' and status='worker_signed' and worker_changed and worker_signed_name='Test Worker';
  insert into t(name,result) values ('10. the portal button signs, with the name on their profile', case when cnt = 1 then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims', '{}', true);
  select public._screen_completion_report('TEST-CR-1', 99, '[]'::jsonb) into v_out;
  insert into t(name,result) values ('11. a screen for another revision cannot release it', case when v_out = 'not_waiting' then 'PASS' else 'FAIL, '||v_out end);
  select public._screen_completion_report('TEST-CR-1', 1, '[{"kind":"money","text":"money: J$45,000"}]'::jsonb) into v_out;
  select count(*) into cnt from public.completion_reports
   where job_id='TEST-CR-1' and status='held' and worker_account like '%J$45,000%' and hold_reason like '%J$45,000%';
  insert into t(name,result) values ('12. the screen holds a price, and changes no word', case when v_out='held' and cnt=1 then 'PASS' else 'FAIL, '||v_out end);

  perform set_config('request.jwt.claims', json_build_object('email','test-cr-client@example.invalid','role','authenticated')::text, true);
  insert into t(name,result) values ('13. the client cannot see a held report',
    case when not public._completion_report_visible('TEST-CR-1') then 'PASS' else 'FAIL, visible' end);

  perform set_config('request.jwt.claims', json_build_object('email','test-cr-worker@example.invalid','role','authenticated')::text, true);
  begin
    perform public.release_completion_report('TEST-CR-1', 'Test Worker');
    insert into t(name,result) values ('14. the worker cannot release a held report','FAIL, released');
  exception when others then
    insert into t(name,result) values ('14. the worker cannot release a held report', case when SQLERRM like '%Admin only%' then 'PASS' else 'FAIL, '||SQLERRM end);
  end;

  -- Monique steps in: sends it back with a reason.
  perform set_config('request.jwt.claims', json_build_object('email', v_admin, 'role', 'authenticated')::text, true);
  begin
    perform public.return_completion_report('TEST-CR-1', 'no', 'Test Admin');
    insert into t(name,result) values ('15. sending it back needs a real reason','FAIL, returned');
  exception when others then
    insert into t(name,result) values ('15. sending it back needs a real reason', case when SQLERRM like '%needs to change%' then 'PASS' else 'FAIL, '||SQLERRM end);
  end;
  v_old := v_code;
  select public.return_completion_report('TEST-CR-1', 'Please take the materials figure out of your account.', 'Test Admin') into v_code;
  select count(*) into cnt from public.completion_reports
   where job_id='TEST-CR-1' and status='with_worker' and rev=2 and worker_signed_at is null and return_reason like 'Please take%';
  insert into t(name,result) values ('16. sent back: a new revision with her reason, signature cleared', case when cnt = 1 and v_code <> v_old then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims', json_build_object('email','test-cr-worker@example.invalid','role','authenticated')::text, true);
  begin
    perform public.sign_completion_report('TEST-CR-1', v_old, array['x'], null);
    insert into t(name,result) values ('17. the old link cannot sign the new revision','FAIL, it signed');
  exception when others then
    insert into t(name,result) values ('17. the old link cannot sign the new revision', case when SQLERRM like '%out of date%' then 'PASS' else 'FAIL, '||SQLERRM end);
  end;
  -- The worker corrects their words in the portal, then taps Sign on WhatsApp.
  update public.completion_reports set worker_account = 'Retiled the wall and fitted the mixer.' where job_id = 'TEST-CR-1';
  perform set_config('request.jwt.claims', '{}', true);
  perform public.sign_completion_report_via_whatsapp('TEST-CR-1', '+18765700900777');
  select count(*) into cnt from public.completion_report_events where job_id='TEST-CR-1' and step='signed' and detail->>'via'='whatsapp';
  insert into t(name,result) values ('17b. the WhatsApp button signs from the worker''s own number', case when cnt = 1 then 'PASS' else 'FAIL, '||cnt end);

  perform set_config('request.jwt.claims', '{}', true);
  select public._screen_completion_report('TEST-CR-1', 2, '[]'::jsonb) into v_out;
  select count(*) into cnt from public.completion_reports where job_id='TEST-CR-1' and status='issued' and issued_name is null;
  insert into t(name,result) values ('18. clean words go to the client with no name claiming a review', case when v_out='issued' and cnt=1 then 'PASS' else 'FAIL, '||v_out end);

  perform set_config('request.jwt.claims', json_build_object('email','test-cr-client@example.invalid','role','authenticated')::text, true);
  insert into t(name,result) values ('19. the client sees it once issued',
    case when public._completion_report_visible('TEST-CR-1') then 'PASS' else 'FAIL, not visible' end);
  perform public.flag_completion_report('TEST-CR-1', 'The mixer brand is wrong.');
  select count(*) into cnt from public.disputes where job_id='TEST-CR-1' and state='direct' and body like 'About the Completion Report:%';
  insert into t(name,result) values ('20. the client''s flag is a dispute', case when cnt = 1 then 'PASS' else 'FAIL, '||cnt end);

  perform set_config('request.jwt.claims', json_build_object('email','test-cr-worker@example.invalid','role','authenticated')::text, true);
  begin
    perform public.confirm_completion_report('TEST-CR-1');
    insert into t(name,result) values ('21. only the client confirms','FAIL, it confirmed');
  exception when others then
    insert into t(name,result) values ('21. only the client confirms', case when SQLERRM like '%Only the client%' then 'PASS' else 'FAIL, '||SQLERRM end);
  end;

  select count(*) into cnt from public.completion_report_events where job_id='TEST-CR-1';
  -- drafted, sent_to_worker, signed, held, returned, signed, released, client_flagged
  insert into t(name,result) values ('22. every step is on the trail', case when cnt = 8 then 'PASS' else 'FAIL, '||cnt||' events' end);

  perform set_config('request.jwt.claims', '{}', true);

  create table if not exists public._cr_out (n int, name text, result text);
  delete from public._cr_out;
  insert into public._cr_out select n,name,result from t;

  delete from public.disputes where job_id like 'TEST-CR-%';
  delete from public.completion_report_events where job_id like 'TEST-CR-%';
  delete from public.completion_reports where job_id like 'TEST-CR-%';
  delete from public.jobs where id like 'TEST-CR-%';
  delete from public.worker_profiles where worker_email like 'test-cr-%';

  alter table public.jobs enable trigger user;
  alter table public.completion_reports enable trigger user;
  alter table public.disputes enable trigger user;
end $$;
select name, result from public._cr_out order by n;
drop table public._cr_out;
