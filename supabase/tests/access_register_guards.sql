-- Proof that only the Super Admin can grant or revoke access, that a worker
-- can never be made a checker, that one person holds one staff level at a
-- time, and that my_access_levels() answers only for the person asking.
-- Run with execute_sql once 20261020120000 is applied.
--
-- NOTHING HERE PERSISTS. Every grant happens inside a subtransaction that is
-- thrown away at the end, and the addresses are invented (example.test).
do $$
declare
  v_admin  text := (select email from public.admins order by email limit 1);
  v_worker text := (select lower(worker_email) from public.worker_profiles where worker_email like '%@%' order by worker_email limit 1);
  v_pm     text := 'pm.access.guard@example.test';
  v_lv     text[];
  v_n      int;
  res      text[] := '{}';
  s        text;
begin
  begin
    -- 1. nobody signed in cannot grant
    perform set_config('request.jwt.claims', '{}', true);
    begin
      perform public.grant_access(v_pm, 'project_manager');
      res := res || '1. only the Super Admin can grant: FAIL, it was granted'::text;
    exception when others then
      res := res || ('1. only the Super Admin can grant: ' || case when sqlerrm ilike '%super admin only%' then 'PASS' else 'FAIL, ' || sqlerrm end);
    end;

    -- 2. the Super Admin grants project_manager, and the PM sees it as theirs
    perform set_config('request.jwt.claims', json_build_object('email', v_admin)::text, true);
    perform public.grant_access(v_pm, 'project_manager', 'guard test');
    perform set_config('request.jwt.claims', json_build_object('email', v_pm)::text, true);
    v_lv := public.my_access_levels();
    res := res || ('2. a granted PM holds project_manager: ' || case when v_lv = '{project_manager}' then 'PASS' else 'FAIL, ' || v_lv::text end);

    -- 3. the PM cannot grant anybody anything
    begin
      perform public.grant_access('someone.else@example.test', 'viewer');
      res := res || '3. a PM cannot grant: FAIL, it was granted'::text;
    exception when others then
      res := res || ('3. a PM cannot grant: ' || case when sqlerrm ilike '%super admin only%' then 'PASS' else 'FAIL, ' || sqlerrm end);
    end;

    -- 4. a change of level replaces, one active row per person
    perform set_config('request.jwt.claims', json_build_object('email', v_admin)::text, true);
    perform public.grant_access(v_pm, 'viewer');
    select count(*) into v_n from public.staff_access where email = v_pm and revoked_at is null;
    res := res || ('4. one active level per person: ' || case when v_n = 1 then 'PASS' else 'FAIL, ' || v_n end);

    -- 5. a worker can never be a checker
    if v_worker is null then
      res := res || '5. a worker cannot be a checker: SKIP, no worker profile to borrow'::text;
    else
      begin
        perform public.grant_access(v_worker, 'checker');
        res := res || '5. a worker cannot be a checker: FAIL, it was granted'::text;
      exception when others then
        res := res || ('5. a worker cannot be a checker: ' || case when sqlerrm ilike '%independent%' then 'PASS' else 'FAIL, ' || sqlerrm end);
      end;
    end if;

    -- 6. nobody can be made a Super Admin through the register
    begin
      perform public.grant_access(v_pm, 'super_admin');
      res := res || '6. super_admin cannot be granted here: FAIL, it was granted'::text;
    exception when others then
      res := res || ('6. super_admin cannot be granted here: ' || case when sqlerrm ilike '%unknown access level%' then 'PASS' else 'FAIL, ' || sqlerrm end);
    end;

    -- 7. revoke leaves the person with no staff level
    perform public.revoke_access(v_pm);
    perform set_config('request.jwt.claims', json_build_object('email', v_pm)::text, true);
    v_lv := public.my_access_levels();
    res := res || ('7. revoked means no level: ' || case when v_lv = '{}' then 'PASS' else 'FAIL, ' || v_lv::text end);

    -- 8. the Super Admin shows as super_admin
    perform set_config('request.jwt.claims', json_build_object('email', v_admin)::text, true);
    res := res || ('8. the Super Admin holds super_admin: ' || case when public.has_access('super_admin') then 'PASS' else 'FAIL' end);

    -- 9. the PM release limit is recorded at J$100,000. It was GBP 500 in
    -- 20261020120000 and moved to J$ on the founder's instruction the same
    -- day (20261020140000), because every worker and materials payment is J$.
    res := res || ('9. PM release limit is J$100,000: ' || case when (select value from public.app_settings where key = 'pm_release_limit_jmd') = '100000' then 'PASS' else 'FAIL' end);

    raise exception 'rollback';
  exception when others then
    if sqlerrm <> 'rollback' then res := res || ('ERROR ' || sqlerrm); end if;
  end;

  foreach s in array res loop raise notice '%', s; end loop;
  -- RAISE NOTICE is swallowed by some clients, so the summary is the error text.
  raise exception 'RESULTS: %', array_to_string(res, ' | ');
end $$;
