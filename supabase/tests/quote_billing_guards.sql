-- Proof that the in full or by stage guards hold (20260914090641). Run
-- against the project with execute_sql, or psql. Reads only; creates nothing.
--
-- The same line is asserted in web/tests/billing.test.mjs, so the form and the
-- database cannot drift apart on where stage billing starts.
do $$
declare
  t text := E'\n';
  v int;
begin
  -- 1. the line is J$ 100,000.
  t := t || '1. threshold is J$100,000: ' || case when public.quote_billing_threshold_jmd() = 100000 then 'PASS' else 'FAIL' end || E'\n';

  -- 2 and 3. the client total is labour, the 15%, and materials.
  t := t || '2. verandah total J$134,250: ' || case when public.quote_client_total_jmd(75000, 48000) = 134250 then 'PASS' else 'FAIL' end || E'\n';
  t := t || '3. materials carry no fee: ' || case when public.quote_client_total_jmd(0, 50000) = 50000 then 'PASS' else 'FAIL' end || E'\n';

  -- 4. the column only takes the two values.
  select count(*) into v from pg_constraint
   where conrelid = 'public.job_quotes'::regclass and pg_get_constraintdef(oid) ilike '%billing_mode%in_full%by_stage%';
  t := t || '4. billing_mode limited to in_full / by_stage: ' || case when v = 1 then 'PASS' else 'FAIL' end || E'\n';

  -- 5. the trigger is in place.
  select count(*) into v from pg_trigger where tgname = 'trg_quote_billing_mode_allowed' and not tgisinternal;
  t := t || '5. billing trigger present: ' || case when v = 1 then 'PASS' else 'FAIL' end || E'\n';

  -- 6 and 7. the no-sign-in lookup returns the choice and kept its grants.
  t := t || '6. quotes_for_code returns billing_mode: '
       || case when position('billing_mode' in pg_get_function_result('public.quotes_for_code(text,text)'::regprocedure)) > 0 then 'PASS' else 'FAIL' end || E'\n';
  t := t || '7. quotes_for_code still callable without signing in: '
       || case when has_function_privilege('anon', 'public.quotes_for_code(text,text)', 'execute') then 'PASS' else 'FAIL' end || E'\n';

  raise notice '%', t;
end $$;
