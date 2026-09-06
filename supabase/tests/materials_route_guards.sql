-- Proof that the materials route is a real decision and that a Route B quote
-- cannot carry a materials figure. Run against the project with execute_sql,
-- or psql. Creates TEST-ROUTE- rows and removes them again.
--
-- THE FAILURE THIS PREVENTS is the one the whole change exists to fix. Before
-- 20260905d, jobs.materials_by was free text nothing read, and the route was
-- decided in practice by whether the worker typed a number into materials_jmd.
-- If the trigger is wrong or missing, that is still true and the form change
-- on top of it is decoration: a hidden field is a suggestion, not a rule.
--
-- Test 3 is the one that matters most and is easiest to get wrong. Hiding the
-- materials input on a Route B quote form is where a reasonable person stops.
-- The gate has to be in Postgres, because a quote can also arrive from the
-- desk, from a fixup, or from a form that regresses.

do $$
declare v_lines int; v_outstanding int; v_id uuid; v_msg text; v_user uuid;
begin
  create temp table t(n int generated always as identity, name text, result text) on commit drop;

  /* job_quotes.worker_user is NOT NULL and references a real auth user, so the
     rig borrows an existing one rather than inventing a uuid an FK rejects.
     Found the hard way on 6 Sep 2026: the first version of this file omitted
     worker_user, worker_name and earliest_start, every quote insert raised,
     and the catch-all handlers recorded PASS for tests that never ran. */
  select worker_user into v_user from public.job_quotes where worker_user is not null limit 1;

  delete from public.price_observations where job_id like 'TEST-ROUTE-%';
  delete from public.quote_materials where quote_id in
    (select id from public.job_quotes where job_id like 'TEST-ROUTE-%');
  delete from public.job_quotes where job_id like 'TEST-ROUTE-%';
  delete from public.jobs where id like 'TEST-ROUTE-%';
  delete from public.worker_profiles where worker_email = 'rig.worker@example.invalid';

  /* A vetted worker, or enforce_vetted_worker_on_quote is the thing refusing
     and test 3 passes for the wrong reason: it also raises check_violation. */
  insert into public.worker_profiles (worker_email, name, active, vetting_state)
  values ('rig.worker@example.invalid', 'Rig Worker', true, 'verified');

  insert into public.jobs (id, title, materials_by)
  values ('TEST-ROUTE-A', 'rig, Yaadly supplies', 'yaadly'),
         ('TEST-ROUTE-B', 'rig, client supplies', 'client');

  -- 1. The route only accepts the two real answers.
  begin
    insert into public.jobs (id, title, materials_by)
    values ('TEST-ROUTE-X', 'rig, bad route', 'Split, agree item by item');
    insert into t(name,result) values ('1. An old free-text route value is refused', 'FAIL, it was accepted');
  exception when check_violation then
    insert into t(name,result) values ('1. An old free-text route value is refused', 'PASS');
  end;

  -- 2. Null is still allowed, because jobs posted before the question exist.
  begin
    insert into public.jobs (id, title, materials_by) values ('TEST-ROUTE-N', 'rig, legacy', null);
    insert into t(name,result) values ('2. A legacy job with no route still inserts', 'PASS');
  exception when others then
    insert into t(name,result) values ('2. A legacy job with no route still inserts', 'FAIL, '||sqlerrm);
  end;

  -- 3. THE ONE THAT MATTERS. A materials figure on a client-supplied job.
  begin
    insert into public.job_quotes (job_id, worker_user, worker_email, worker_name,
                                   labour_jmd, materials_jmd, earliest_start, status)
    values ('TEST-ROUTE-B', v_user, 'rig.worker@example.invalid', 'Rig Worker',
            30000, 15000, 'This week', 'withdrawn');
    insert into t(name,result) values ('3. A Route B quote carrying materials money is refused', 'FAIL, it was accepted');
  exception when check_violation then
    get stacked diagnostics v_msg = message_text;
    insert into t(name,result) values ('3. A Route B quote carrying materials money is refused',
      case when v_msg like '%supplying the materials themselves%' then 'PASS'
           else 'FAIL, refused by something else: '||left(v_msg,80) end);
  end;

  -- 4. Labour only on Route B goes through.
  begin
    insert into public.job_quotes (job_id, worker_user, worker_email, worker_name,
                                   labour_jmd, materials_jmd, earliest_start, status)
    values ('TEST-ROUTE-B', v_user, 'rig.worker@example.invalid', 'Rig Worker',
            30000, 0, 'This week', 'withdrawn')
    returning id into v_id;
    insert into t(name,result) values ('4. A labour only quote on Route B is accepted',
      case when v_id is not null then 'PASS' else 'FAIL, insert returned no row' end);
  exception when others then
    get stacked diagnostics v_msg = message_text;
    insert into t(name,result) values ('4. A labour only quote on Route B is accepted', 'FAIL, '||left(v_msg,120));
  end;

  /* Guarded: without this, one failure above leaves v_id null and the next
     insert dies on a NOT NULL, taking the whole run down and hiding the
     results of the tests that did complete. */
  if v_id is null then
    insert into t(name,result) values ('5. Two lines ordered, one still outstanding', 'SKIPPED, no quote from test 4');
    insert into t(name,result) values ('6. A blank item is refused', 'SKIPPED, no quote from test 4');
  else

  -- 5. The list is the order, and an unsupplied line is outstanding.
  insert into public.quote_materials (quote_id, sort, item, qty, unit)
  values (v_id, 1, '6in concrete block', 120, 'blocks'),
         (v_id, 2, 'cement (42.5kg bag)', 8, 'bags');

  update public.quote_materials set supplied_at = now(), supplied_by = 'rig.client@example.invalid'
   where quote_id = v_id and sort = 1;

  select count(*), count(*) filter (where supplied_at is null)
    into v_lines, v_outstanding
    from public.quote_materials where quote_id = v_id;

  insert into t(name,result) values ('5. Two lines ordered, one still outstanding',
    case when v_lines = 2 and v_outstanding = 1 then 'PASS'
         else 'FAIL, '||v_lines||' lines and '||v_outstanding||' outstanding' end);

  -- 6. A blank item is not a materials line.
  begin
    insert into public.quote_materials (quote_id, item) values (v_id, '   ');
    insert into t(name,result) values ('6. A blank item is refused', 'FAIL, it was accepted');
  exception when check_violation then
    insert into t(name,result) values ('6. A blank item is refused', 'PASS');
  end;
  end if;

  -- 7. Route A quotes are untouched by any of this.
  begin
    insert into public.job_quotes (job_id, worker_user, worker_email, worker_name,
                                   labour_jmd, materials_jmd, earliest_start, status)
    values ('TEST-ROUTE-A', v_user, 'rig.worker@example.invalid', 'Rig Worker',
            30000, 45000, 'This week', 'withdrawn');
    insert into t(name,result) values ('7. A Route A quote still carries materials money', 'PASS');
  exception when others then
    get stacked diagnostics v_msg = message_text;
    insert into t(name,result) values ('7. A Route A quote still carries materials money', 'FAIL, '||left(v_msg,120));
  end;

  create table if not exists public._route_out (n int, name text, result text);
  delete from public._route_out;
  insert into public._route_out select n,name,result from t;

  delete from public.price_observations where job_id like 'TEST-ROUTE-%';
  delete from public.quote_materials where quote_id in
    (select id from public.job_quotes where job_id like 'TEST-ROUTE-%');
  delete from public.job_quotes where job_id like 'TEST-ROUTE-%';
  delete from public.jobs where id like 'TEST-ROUTE-%';
  delete from public.worker_profiles where worker_email = 'rig.worker@example.invalid';
end $$;
select name, result from public._route_out order by n;
drop table public._route_out;
