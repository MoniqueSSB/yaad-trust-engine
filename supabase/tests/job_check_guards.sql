-- Proof that the independent-check guards hold (20260909180000). Run against
-- the project with execute_sql, or psql. Reads only; creates nothing.
--
-- The session running this has no JWT and is not an admin, which is the
-- point: every write path must refuse a caller who is neither the client
-- nor a signed-in admin. The admin-side happy paths (assign a checker,
-- raise the invoice, refuse the worker's own name) are exercised from the
-- desk with a real session; see RUNBOOK "A client wants an independent
-- check on a job".
do $$
declare
  t   text := E'\n';
  v   int;
  msg text;
begin
  -- 1. the two MARKETPLACE catalogue rows exist and are active, and are not
  --    the professional Visual Check ('eyes-on-it').
  select count(*) into v from public.service_catalogue
   where id in ('job-visual-check','job-technical-check') and active;
  t := t || '1. two job-check catalogue rows, active: ' || case when v = 2 then 'PASS' else 'FAIL, got ' || v end || E'\n';

  -- 2. the level constraint exists: only visual or technical can be stored.
  select count(*) into v from pg_constraint where conname = 'jobs_check_level_chk';
  t := t || '2. jobs_check_level_chk present: ' || case when v = 1 then 'PASS' else 'FAIL' end || E'\n';

  -- 3. an unknown job has one stage and is not locked.
  t := t || '3. unknown job defaults to one stage: '
       || case when public.job_final_stage_count('TEST-NOPE') = 1 then 'PASS' else 'FAIL' end || E'\n';
  t := t || '4. unknown job is not locked: '
       || case when public.job_check_locked('TEST-NOPE') = false then 'PASS' else 'FAIL' end || E'\n';

  -- 5 to 8. every write path refuses a caller with no session and no admin.
  begin
    perform public.choose_job_check('TEST-NOPE', 'visual');
    t := t || '5. choose_job_check without a session: FAIL, allowed' || E'\n';
  exception when others then
    t := t || '5. choose_job_check without a session refused: PASS (' || sqlerrm || ')' || E'\n';
  end;
  begin
    perform public.clear_job_check('TEST-NOPE');
    t := t || '6. clear_job_check without a session: FAIL, allowed' || E'\n';
  exception when others then
    t := t || '6. clear_job_check without a session refused: PASS (' || sqlerrm || ')' || E'\n';
  end;
  begin
    perform public.assign_job_checker('TEST-NOPE', 'Somebody');
    t := t || '7. assign_job_checker without admin: FAIL, allowed' || E'\n';
  exception when others then
    t := t || '7. assign_job_checker without admin refused: PASS (' || sqlerrm || ')' || E'\n';
  end;
  begin
    perform public.raise_job_check_invoice('TEST-NOPE');
    t := t || '8. raise_job_check_invoice without admin: FAIL, allowed' || E'\n';
  exception when others then
    t := t || '8. raise_job_check_invoice without admin refused: PASS (' || sqlerrm || ')' || E'\n';
  end;

  -- 9. the desk's view exists and answers.
  select count(*) into v from public.v_job_checks;
  t := t || '9. v_job_checks answers, rows: ' || v || E'\n';

  -- 10. no check invoice carries a job_id. If one ever does, three live
  --     functions will read it as the agency fee. See the migration header.
  select count(*) into v
    from public.invoices i
    join public.jobs j on j.check_invoice_id = i.id
   where i.job_id is not null;
  t := t || '10. no check invoice carries a job_id: ' || case when v = 0 then 'PASS' else 'FAIL, ' || v || ' do' end || E'\n';

  raise notice '%', t;
end $$;
