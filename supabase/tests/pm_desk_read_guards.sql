-- Proof that a Project Manager reads the job desk and nothing behind it:
-- jobs yes, identity documents, applications, secrets and the access
-- register no, and still no button.
-- Run with execute_sql once 20261020140000 is applied.
--
-- NOTHING HERE PERSISTS. The PM is an invented address granted inside a
-- subtransaction that is thrown away at the end.
do $$
declare
  v_admin text := (select email from public.admins order by email limit 1);
  v_pm    text := 'pm.desk.guard@example.test';
  v_n     bigint;
  v_all   bigint;
  res     text[] := '{}';
  s       text;
begin
  begin
    perform set_config('request.jwt.claims', json_build_object('email', v_admin)::text, true);
    perform public.grant_access(v_pm, 'project_manager', 'guard test');
    select count(*) into v_all from public.jobs;

    -- every read below runs as the authenticated role, so RLS applies
    perform set_config('request.jwt.claims', json_build_object('email', v_pm, 'role', 'authenticated')::text, true);
    set local role authenticated;

    res := res || ('1. the desk opens as project_manager: ' || case when public.desk_role() = 'project_manager' then 'PASS' else 'FAIL, ' || coalesce(public.desk_role(), 'null') end);

    select count(*) into v_n from public.jobs;
    res := res || ('2. a PM reads every job: ' || case when v_n = v_all then 'PASS' else 'FAIL, ' || v_n || ' of ' || v_all end);

    select count(*) into v_n from public.vetting_documents;
    res := res || ('3. a PM reads no identity documents: ' || case when v_n = 0 then 'PASS' else 'FAIL, ' || v_n end);

    select count(*) into v_n from public.applications;
    res := res || ('4. a PM reads no applications: ' || case when v_n = 0 then 'PASS' else 'FAIL, ' || v_n end);

    select count(*) into v_n from public.app_settings where key ilike '%secret%' or key = 'ntfy_topic';
    res := res || ('5. a PM reads no secret settings: ' || case when v_n = 0 then 'PASS' else 'FAIL, ' || v_n end);

    select count(*) into v_n from public.staff_access where email <> v_pm;
    res := res || ('6. a PM reads nobody else on the register: ' || case when v_n = 0 then 'PASS' else 'FAIL, ' || v_n end);

    select count(*) into v_n from storage.objects where bucket_id = 'vetting';
    res := res || ('7. a PM reads nothing in the vetting bucket: ' || case when v_n = 0 then 'PASS' else 'FAIL, ' || v_n end);

    select count(*) into v_n from public.app_settings where key = 'pm_release_limit_jmd' and value = '100000';
    res := res || ('8. the PM limit is J$100,000: ' || case when v_n = 1 then 'PASS' else 'FAIL' end);

    -- 9. still no button: a PM cannot write a job
    begin
      update public.jobs set title = title where id = (select id from public.jobs limit 1);
      get diagnostics v_n = row_count;
      res := res || ('9. a PM cannot write a job: ' || case when v_n = 0 then 'PASS' else 'FAIL, wrote ' || v_n end);
    exception when others then
      res := res || ('9. a PM cannot write a job: PASS (' || sqlerrm || ')');
    end;

    reset role;
    raise exception 'rollback';
  exception when others then
    if sqlerrm <> 'rollback' then res := res || ('ERROR ' || sqlerrm); end if;
  end;

  foreach s in array res loop raise notice '%', s; end loop;
  raise exception 'RESULTS: %', array_to_string(res, ' | ');
end $$;
