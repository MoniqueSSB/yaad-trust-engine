-- Proof that three SECURITY DEFINER functions answer only their own caller
-- (20260913230100). Run against the project with execute_sql, or psql.
-- Reads only; creates nothing. No email is ever printed.
--
-- The session running this has no JWT. Tests that need one set
-- request.jwt.claims for the current transaction only, which is what
-- auth.jwt() reads, and clear it again. The emails used are real rows found
-- at run time, so a test SKIPs rather than guesses when production has no
-- suitable row.
do $$
declare
  v_job     text;
  v_client  text;
  v_empty   text;
  v_cleared text;
  v_ok      boolean;
begin
  create temp table t(n int generated always as identity, name text, result text) on commit drop;

  -- 1 and 2. nobody but the service role lists workers
  insert into t(name,result) values ('1. anon cannot list workers for a job',
    case when has_function_privilege('anon', 'public.match_workers_for_job(text, integer)', 'EXECUTE')
         then 'FAIL, anon holds EXECUTE' else 'PASS' end);
  insert into t(name,result) values ('2. a signed-in user cannot list workers for a job',
    case when has_function_privilege('authenticated', 'public.match_workers_for_job(text, integer)', 'EXECUTE')
         then 'FAIL, authenticated holds EXECUTE' else 'PASS' end);

  -- 3. may_use_agents is not open to a caller with no session
  insert into t(name,result) values ('3. anon cannot ask may_use_agents',
    case when has_function_privilege('anon', 'public.may_use_agents(text)', 'EXECUTE')
         then 'FAIL, anon holds EXECUTE' else 'PASS' end);

  -- 4 to 6. job_client_email_matches answers only about your own email
  select j.id, j.client_email into v_job, v_client from public.jobs j
   where j.id like 'JOB-TEST-%' and coalesce(btrim(j.client_email), '') <> ''
   order by j.id limit 1;
  if v_job is null then
    insert into t(name,result) values ('4 to 6. job_client_email_matches', 'SKIP, no TEST job with a client email');
  else
    perform set_config('request.jwt.claims', '', true);
    v_ok := public.job_client_email_matches(v_job, v_client);
    insert into t(name,result) values ('4. no session, right email: no answer',
      case when v_ok then 'FAIL, it confirmed the client' else 'PASS' end);

    perform set_config('request.jwt.claims', json_build_object('email', 'someone.else@example.com')::text, true);
    v_ok := public.job_client_email_matches(v_job, v_client);
    insert into t(name,result) values ('5. signed in as somebody else, right email: no answer',
      case when v_ok then 'FAIL, it confirmed the client' else 'PASS' end);

    perform set_config('request.jwt.claims', json_build_object('email', v_client)::text, true);
    v_ok := public.job_client_email_matches(v_job, v_client);
    insert into t(name,result) values ('6. signed in as the client: still recognised',
      case when v_ok then 'PASS' else 'FAIL, the client lost access to their own quotes' end);
    perform set_config('request.jwt.claims', '', true);
  end if;

  -- 7. no email matches no job, even a job with no client email yet
  select j.id into v_empty from public.jobs j
   where coalesce(btrim(j.client_email), '') = '' order by j.id limit 1;
  if v_empty is null then
    insert into t(name,result) values ('7. empty email matches an unclaimed job', 'SKIP, no unclaimed job');
  else
    v_ok := public.job_client_email_matches(v_empty, '');
    insert into t(name,result) values ('7. empty email matches an unclaimed job',
      case when v_ok then 'FAIL, an empty email passed as the client' else 'PASS' end);
  end if;

  -- 8 to 10. may_use_agents answers only about your own email
  select c.email into v_cleared from public.client_profiles c
   where coalesce(c.email, '') <> '' and public.client_cleared_for_golive(c.email)
   order by c.email limit 1;
  if v_cleared is null then
    insert into t(name,result) values ('8 to 10. may_use_agents', 'SKIP, no client cleared for go-live');
  else
    perform set_config('request.jwt.claims', '', true);
    v_ok := public.may_use_agents(v_cleared);
    insert into t(name,result) values ('8. no session, cleared email: no answer',
      case when v_ok then 'FAIL, it confirmed the client' else 'PASS' end);

    perform set_config('request.jwt.claims', json_build_object('email', 'someone.else@example.com')::text, true);
    v_ok := public.may_use_agents(v_cleared);
    insert into t(name,result) values ('9. signed in as somebody else, cleared email: no answer',
      case when v_ok then 'FAIL, it confirmed the client' else 'PASS' end);

    perform set_config('request.jwt.claims', json_build_object('email', v_cleared)::text, true);
    v_ok := public.may_use_agents(v_cleared);
    insert into t(name,result) values ('10. signed in as the cleared client: still allowed',
      case when v_ok then 'PASS' else 'FAIL, the client lost the assistant' end);
    perform set_config('request.jwt.claims', '', true);
  end if;

  create table if not exists public._open_fn_test_out (n int, name text, result text);
  delete from public._open_fn_test_out;
  insert into public._open_fn_test_out select n, name, result from t;
end $$;
select name, result from public._open_fn_test_out order by n;
drop table public._open_fn_test_out;
