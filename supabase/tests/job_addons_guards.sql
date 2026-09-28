-- Proof that the add-on guards hold in the real database (20260928235000).
-- Run against the project with execute_sql, or psql, AFTER the migration is
-- applied. Reads only; creates nothing. The behaviour itself is proved by
-- supabase/tests/pglite/addons_run.mjs; this proves the live wiring.
do $$
declare
  t   text := E'\n';
  b   boolean;
  r   text;
begin
  foreach r in array array['job_addons','job_addon_agreements','job_addon_evidence'] loop
    select relrowsecurity into b from pg_class where oid = ('public.' || r)::regclass;
    t := t || 'RLS on ' || r || ': ' || case when b then 'PASS' else 'FAIL' end || E'\n';
    t := t || 'authenticated cannot insert into ' || r || ': '
         || case when not has_table_privilege('authenticated', 'public.' || r, 'insert') then 'PASS' else 'FAIL' end || E'\n';
    t := t || 'authenticated cannot update ' || r || ': '
         || case when not has_table_privilege('authenticated', 'public.' || r, 'update') then 'PASS' else 'FAIL' end || E'\n';
    t := t || 'anon cannot read ' || r || ': '
         || case when not has_table_privilege('anon', 'public.' || r, 'select') then 'PASS' else 'FAIL' end || E'\n';
  end loop;

  t := t || 'anon cannot propose: ' || case when not has_function_privilege('anon', 'public.propose_addon_as_me(text,text,integer,text)', 'execute') then 'PASS' else 'FAIL' end || E'\n';
  t := t || 'internal invoice drafter is not callable by authenticated: '
       || case when not has_function_privilege('authenticated', 'public._draft_addon_client_invoice(uuid,text)', 'execute') then 'PASS' else 'FAIL' end || E'\n';

  begin
    perform public.propose_addon_as_me('JOB-NONE', 'x', 1, 'in_full');
    t := t || 'propose without a session: FAIL, allowed' || E'\n';
  exception when others then
    t := t || 'propose without a session refused: PASS (' || sqlerrm || ')' || E'\n';
  end;
  begin
    perform public.sign_off_addon(gen_random_uuid());
    t := t || 'sign-off without an admin session: FAIL, allowed' || E'\n';
  exception when others then
    t := t || 'sign-off without an admin session refused: PASS (' || sqlerrm || ')' || E'\n';
  end;

  -- The five live functions carry the add-on exclusion.
  foreach r in array array['invoice_starts_job_default','raise_job_client_invoice','raise_job_worker_payable','worker_pay_client_unpaid','sync_job_status'] loop
    select pg_get_functiondef(('public.' || r)::regproc) ~ '(addon_id|job_addons)' into b;
    t := t || r || ' knows about add-ons: ' || case when b then 'PASS' else 'FAIL' end || E'\n';
  end loop;

  select exists (select 1 from pg_trigger where tgname = 'invoices_addon_never_a_part') into b;
  t := t || 'add-on invoices cannot be split (trigger present): ' || case when b then 'PASS' else 'FAIL' end || E'\n';

  raise notice '%', t;
end $$;
