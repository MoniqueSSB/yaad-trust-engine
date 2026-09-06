-- Proof that materials can be invoiced first WITHOUT the client being billed
-- for them twice. Run against the project with execute_sql, or psql.
--
-- THE FAILURE THIS PREVENTS IS A DOUBLE BILL. Two documents can now carry the
-- same materials figure: the stage 0 materials invoice and the whole-job bill.
-- If either forgets the other, a client pays for the same cement twice and
-- finds out from their bank, not from us. Tests 3 and 4 are the pair that
-- matters; the rest is scaffolding around them.
--
-- TWO THINGS THIS RIG DOES THAT LOOK ODD AND ARE DELIBERATE.
--
-- 1. It sets request.jwt.claims to a real admin email for the block. Both
--    functions are admin only and read auth.jwt(), and a psql or service-role
--    connection has no JWT at all, so without this every call raises 28000 and
--    a catch-all handler would record PASS for a test that never ran. Same
--    trap the route guards fell into on 6 Sep 2026.
--
-- 2. It records invoice_seq before the run and rewinds it after. Sequences do
--    not roll back, so testing would otherwise leave permanent gaps in a real
--    business's invoice numbering. The rewind is guarded: it only happens if
--    the invoices table is back to the exact count it started at, meaning
--    nothing else took a number while the test ran.

do $$
declare
  v_admin text; v_user uuid; v_msg text;
  v_seq_before bigint; v_inv_before bigint;
  v_mat_id text; v_mat_total int; v_job_id text; v_job_total int;
  v_lines int;
begin
  create temp table t(n int generated always as identity, name text, result text) on commit drop;

  select last_value into v_seq_before from public.invoice_seq;
  select count(*) into v_inv_before from public.invoices;
  select email into v_admin from public.admins limit 1;
  select worker_user into v_user from public.job_quotes where worker_user is not null limit 1;

  perform set_config('request.jwt.claims', json_build_object('email', v_admin)::text, true);

  delete from public.invoice_lines where invoice_id in (select id from public.invoices where job_id like 'TEST-INV-%');
  delete from public.invoices where job_id like 'TEST-INV-%';
  delete from public.price_observations where job_id like 'TEST-INV-%';
  delete from public.job_quotes where job_id like 'TEST-INV-%';
  delete from public.jobs where id like 'TEST-INV-%';
  delete from public.worker_profiles where worker_email = 'rig.inv@example.invalid';

  insert into public.worker_profiles (worker_email, name, active, vetting_state)
  values ('rig.inv@example.invalid', 'Rig Inv', true, 'verified');

  insert into public.jobs (id, title, client_email, client_name, materials_by)
  values ('TEST-INV-A', 'rig invoice, Yaadly supplies', 'rig.client@example.invalid', 'Rig Client', 'yaadly'),
         ('TEST-INV-B', 'rig invoice, client supplies', 'rig.client@example.invalid', 'Rig Client', 'client');

  insert into public.job_quotes (job_id, worker_user, worker_email, worker_name, labour_jmd, materials_jmd, earliest_start, status)
  values ('TEST-INV-A', v_user, 'rig.inv@example.invalid', 'Rig Inv', 100000, 40000, 'This week', 'accepted'),
         ('TEST-INV-B', v_user, 'rig.inv@example.invalid', 'Rig Inv', 100000, 0, 'This week', 'accepted');

  begin
    select invoice_id, total_jmd into v_mat_id, v_mat_total from public.raise_job_materials_invoice('TEST-INV-A');
    insert into t(name,result) values ('1. Materials invoice raises on Route A, total 40000',
      case when v_mat_id is not null and v_mat_total = 40000 then 'PASS'
           else 'FAIL, id '||coalesce(v_mat_id,'null')||' total '||coalesce(v_mat_total::text,'null') end);
  exception when others then
    get stacked diagnostics v_msg = message_text;
    insert into t(name,result) values ('1. Materials invoice raises on Route A, total 40000','FAIL, '||left(v_msg,110));
  end;

  begin
    perform public.raise_job_materials_invoice('TEST-INV-A');
    insert into t(name,result) values ('2. A second materials invoice is refused','FAIL, it was accepted');
  exception when check_violation then
    insert into t(name,result) values ('2. A second materials invoice is refused','PASS');
  end;

  -- THE DOUBLE BILL, first direction.
  begin
    select invoice_id, total_jmd into v_job_id, v_job_total from public.raise_job_client_invoice('TEST-INV-A');
    select count(*) into v_lines from public.invoice_lines
     where invoice_id = v_job_id and description ilike '%Materials%';
    insert into t(name,result) values ('3. All-in bill after materials omits them, total 115000',
      case when v_job_total = 115000 and v_lines = 0 then 'PASS'
           else 'FAIL, total '||coalesce(v_job_total::text,'null')||' with '||v_lines||' materials lines' end);
  exception when others then
    get stacked diagnostics v_msg = message_text;
    insert into t(name,result) values ('3. All-in bill after materials omits them, total 115000','FAIL, '||left(v_msg,110));
  end;

  -- THE DOUBLE BILL, other direction.
  delete from public.invoice_lines where invoice_id in (select id from public.invoices where job_id = 'TEST-INV-A' and stage = 0);
  delete from public.invoices where job_id = 'TEST-INV-A' and stage = 0;
  begin
    perform public.raise_job_materials_invoice('TEST-INV-A');
    insert into t(name,result) values ('4. Materials invoice after the all-in bill is refused','FAIL, it was accepted');
  exception when check_violation then
    get stacked diagnostics v_msg = message_text;
    insert into t(name,result) values ('4. Materials invoice after the all-in bill is refused',
      case when v_msg like '%already been invoiced%' then 'PASS' else 'FAIL, wrong reason: '||left(v_msg,70) end);
  end;

  begin
    perform public.raise_job_materials_invoice('TEST-INV-B');
    insert into t(name,result) values ('5. A client-supplied job has no materials invoice','FAIL, it was accepted');
  exception when check_violation then
    get stacked diagnostics v_msg = message_text;
    insert into t(name,result) values ('5. A client-supplied job has no materials invoice',
      case when v_msg like '%client is supplying%' then 'PASS' else 'FAIL, wrong reason: '||left(v_msg,70) end);
  end;

  -- A job that never split still behaves exactly as it did before this change.
  insert into public.jobs (id, title, client_email, client_name, materials_by)
  values ('TEST-INV-C', 'rig invoice, no split', 'rig.client@example.invalid', 'Rig Client', 'yaadly');
  insert into public.job_quotes (job_id, worker_user, worker_email, worker_name, labour_jmd, materials_jmd, earliest_start, status)
  values ('TEST-INV-C', v_user, 'rig.inv@example.invalid', 'Rig Inv', 100000, 40000, 'This week', 'accepted');
  begin
    select invoice_id, total_jmd into v_job_id, v_job_total from public.raise_job_client_invoice('TEST-INV-C');
    select count(*) into v_lines from public.invoice_lines
     where invoice_id = v_job_id and description ilike '%Materials%';
    insert into t(name,result) values ('6. Unsplit job still bills all in, total 155000 with a materials line',
      case when v_job_total = 155000 and v_lines = 1 then 'PASS'
           else 'FAIL, total '||coalesce(v_job_total::text,'null')||' with '||v_lines||' materials lines' end);
  exception when others then
    get stacked diagnostics v_msg = message_text;
    insert into t(name,result) values ('6. Unsplit job still bills all in, total 155000 with a materials line','FAIL, '||left(v_msg,110));
  end;

  create table if not exists public._inv_out (n int, name text, result text);
  delete from public._inv_out;
  insert into public._inv_out select n,name,result from t;

  delete from public.invoice_lines where invoice_id in (select id from public.invoices where job_id like 'TEST-INV-%');
  delete from public.invoices where job_id like 'TEST-INV-%';
  delete from public.price_observations where job_id like 'TEST-INV-%';
  delete from public.job_quotes where job_id like 'TEST-INV-%';
  delete from public.jobs where id like 'TEST-INV-%';
  delete from public.worker_profiles where worker_email = 'rig.inv@example.invalid';

  if (select count(*) from public.invoices) = v_inv_before then
    perform setval('public.invoice_seq', v_seq_before, true);
    insert into public._inv_out values (99, '7. Invoice numbering restored', 'PASS, sequence back to '||v_seq_before);
  else
    insert into public._inv_out values (99, '7. Invoice numbering restored',
      'SKIPPED, a real invoice was raised during the test so the sequence was left alone');
  end if;
end $$;
select name, result from public._inv_out order by n;
drop table public._inv_out;
