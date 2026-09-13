-- Proof that the quote change request guards hold (20260913230000). Run
-- against the project with execute_sql, or psql. Reads only; creates nothing.
--
-- The session running this has no JWT, which is the point: the only write
-- path must refuse a caller who is not signed in, and the browser roles must
-- have no write privilege on the table at all.
do $$
declare
  t   text := E'\n';
  v   int;
  b   boolean;
begin
  -- 1. the table exists and row level security is on.
  select relrowsecurity into b from pg_class where oid = 'public.quote_change_requests'::regclass;
  t := t || '1. RLS on quote_change_requests: ' || case when b then 'PASS' else 'FAIL' end || E'\n';

  -- 2. the browser roles cannot write to it directly.
  t := t || '2. authenticated has no insert: '
       || case when not has_table_privilege('authenticated', 'public.quote_change_requests', 'insert') then 'PASS' else 'FAIL' end || E'\n';
  t := t || '3. authenticated has no update: '
       || case when not has_table_privilege('authenticated', 'public.quote_change_requests', 'update') then 'PASS' else 'FAIL' end || E'\n';
  t := t || '4. anon cannot read it: '
       || case when not has_table_privilege('anon', 'public.quote_change_requests', 'select') then 'PASS' else 'FAIL' end || E'\n';

  -- 5. anon cannot call the write path; authenticated can.
  t := t || '5. anon cannot execute request_quote_change_as_me: '
       || case when not has_function_privilege('anon', 'public.request_quote_change_as_me(uuid,text)', 'execute') then 'PASS' else 'FAIL' end || E'\n';
  t := t || '6. authenticated can execute request_quote_change_as_me: '
       || case when has_function_privilege('authenticated', 'public.request_quote_change_as_me(uuid,text)', 'execute') then 'PASS' else 'FAIL' end || E'\n';

  -- 7. with no session, the write path refuses before it reads anything.
  begin
    perform public.request_quote_change_as_me(gen_random_uuid(), 'Can the price include the whole rail?');
    t := t || '7. request_quote_change_as_me without a session: FAIL, allowed' || E'\n';
  exception when others then
    t := t || '7. request_quote_change_as_me without a session refused: PASS (' || sqlerrm || ')' || E'\n';
  end;

  -- 8. one open request per quote is enforced by the database, not the page.
  select count(*) into v from pg_indexes
   where tablename = 'quote_change_requests' and indexname = 'quote_change_requests_one_open_per_quote';
  t := t || '8. one open request per quote index present: ' || case when v = 1 then 'PASS' else 'FAIL' end || E'\n';

  raise notice '%', t;
end $$;
