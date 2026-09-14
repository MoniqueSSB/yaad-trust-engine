-- Proof that materials money goes out only once the client has paid for it,
-- that the receipt comes back afterwards and is never overwritten, and that a
-- worker is never paid for the same materials twice. Run with execute_sql
-- once 20260914112000 is applied.
--
-- NOTHING HERE PERSISTS AND NOTHING LEAVES. Same shape as
-- invoice_parts_guards.sql: it borrows a TEST job with a booked worker, an
-- accepted quote carrying materials and no client bill yet, does everything
-- inside a subtransaction and throws it away, then puts invoice_seq back.
-- Run it when nobody is invoicing.
--
-- Test 1 proves the release is admin only with nobody signed in; after it the
-- block acts as the first address on the admins list, local to this
-- transaction.
do $$
declare
  v_admin  text := (select email from public.admins order by email limit 1);
  v_job    text;
  v_seq    bigint;
  v_called boolean;
  v_bill   text;
  v_mat    int;
  v_rel    uuid;
  v        int;
  s        text;
  res      text[] := '{}';
begin
  select last_value, is_called into v_seq, v_called from public.invoice_seq;

  select j.id into v_job from public.jobs j
   where j.is_test and coalesce(j.worker_email, '') <> '' and coalesce(j.client_email, '') <> ''
     and exists (select 1 from public.job_quotes q where q.job_id = j.id and q.status = 'accepted' and q.materials_jmd > 0)
     and not exists (select 1 from public.invoices i where i.job_id = j.id and (i.stage is null or i.stage = 0) and i.status <> 'void')
     and not exists (select 1 from public.materials_releases r where r.job_id = j.id)
   order by j.id limit 1;

  if v_job is null then
    res := res || 'SKIP, no TEST job with a booked worker, materials on the accepted quote and no client bill to borrow'::text;
  else
    begin
      select round(q.materials_jmd) into v_mat from public.job_quotes q where q.job_id = v_job and q.status = 'accepted';
      update public.jobs set materials_store_type = 'indoors', materials_store = 'Test store, back room' where id = v_job;

      -- 1. nobody signed in, refused
      perform set_config('request.jwt.claims', '{}', true);
      begin
        perform public.release_materials_tranche(v_job, 1, '', null, '');
        res := res || '1. only an admin can release materials money: FAIL, it released'::text;
      exception when others then
        res := res || ('1. only an admin can release materials money: ' || case when sqlerrm ilike '%admin only%' then 'PASS' else 'FAIL, ' || sqlerrm end);
      end;

      perform set_config('request.jwt.claims', json_build_object('email', v_admin, 'role', 'authenticated')::text, true);

      -- 2. nothing goes out before the client has paid for the materials
      begin
        perform public.release_materials_tranche(v_job, 1, '', null, '');
        res := res || '2. refused before the client has paid: FAIL, it released'::text;
      exception when others then
        res := res || ('2. refused before the client has paid: ' || case when sqlerrm ilike '%paid%' then 'PASS' else 'FAIL, ' || sqlerrm end);
      end;

      -- 3. a sent but unpaid bill is not paid
      select invoice_id into v_bill from public.raise_job_client_invoice(v_job);
      update public.invoices set status = 'sent' where id = v_bill;
      begin
        perform public.release_materials_tranche(v_job, 1, '', null, '');
        res := res || '3. a sent, unpaid bill does not allow a release: FAIL, it released'::text;
      exception when others then
        res := res || ('3. a sent, unpaid bill does not allow a release: ' || case when sqlerrm ilike '%paid%' then 'PASS' else 'FAIL, ' || sqlerrm end);
      end;

      -- 4. once paid, it releases with no receipt, and the receipt is marked still to come
      update public.invoices set status = 'paid' where id = v_bill;
      select public.materials_paid_jmd(v_job) into v;
      res := res || ('4a. the paid bill counts its materials line: ' || case when v = v_mat then 'PASS' else 'FAIL, got ' || v || ' of ' || v_mat end);
      select release_id into v_rel from public.release_materials_tranche(v_job, v_mat - 1, '', null, 'test');
      select case when btrim(receipt_ref) = '' and receipt_at is null and released_by = v_admin then 'PASS' else 'FAIL' end
        into s from public.materials_releases where id = v_rel;
      res := res || ('4b. released with no receipt, receipt still to come, named person stamped: ' || s);

      -- 5. never more than quoted and paid
      begin
        perform public.release_materials_tranche(v_job, 2, '', null, '');
        res := res || '5. cannot release beyond what was paid: FAIL, it released'::text;
      exception when others then
        res := res || ('5. cannot release beyond what was paid: ' || case when sqlerrm ilike '%cannot%' then 'PASS' else 'FAIL, ' || sqlerrm end);
      end;

      -- 6. the receipt comes back afterwards and is stamped
      perform public.record_materials_receipt(v_rel, 'HW-TEST-1', 'cement and steel');
      select case when receipt_ref = 'HW-TEST-1' and receipt_at is not null and receipt_by = v_admin then 'PASS' else 'FAIL' end
        into s from public.materials_releases where id = v_rel;
      res := res || ('6. the receipt is recorded afterwards, stamped: ' || s);

      -- 7. and never overwritten
      begin
        perform public.record_materials_receipt(v_rel, 'HW-TEST-2', '');
        res := res || '7. a recorded receipt is not overwritten: FAIL, it was'::text;
      exception when others then
        res := res || ('7. a recorded receipt is not overwritten: ' || case when sqlerrm ilike '%not overwritten%' then 'PASS' else 'FAIL, ' || sqlerrm end);
      end;

      -- 8. what is owed to the worker for materials is what has not been released
      select public.materials_owed_to_worker_jmd(v_job) into v;
      res := res || ('8. materials owed to the worker is quoted less released: ' || case when v = 1 then 'PASS' else 'FAIL, got ' || v end);

      -- 9. both worker payables read that figure, not the whole line
      select case when pg_get_functiondef('public.raise_job_stage_worker_payable(text,integer)'::regprocedure) ilike '%materials_owed_to_worker_jmd%'
                   and pg_get_functiondef('public.raise_job_worker_payable(text)'::regprocedure) ilike '%materials_owed_to_worker_jmd%'
             then 'PASS' else 'FAIL' end into s;
      res := res || ('9. stage and whole-job payables add only materials still owed: ' || s);

      -- 10. the stage payable keeps its hold point
      select case when pg_get_functiondef('public.raise_job_stage_worker_payable(text,integer)'::regprocedure) ilike '%select 1 from stage_approvals s where s.job_id = p_job and s.stage = p_stage%'
             then 'PASS' else 'FAIL' end into s;
      res := res || ('10. a stage payable still needs a recorded approval: ' || s);

      -- 11. the helpers are not callable from the browser
      select case when not has_function_privilege('anon', 'public.materials_paid_jmd(text)', 'execute')
                   and not has_function_privilege('authenticated', 'public.materials_owed_to_worker_jmd(text)', 'execute')
                   and not has_function_privilege('anon', 'public.record_materials_receipt(uuid,text,text)', 'execute')
             then 'PASS' else 'FAIL' end into s;
      res := res || ('11. helpers and the receipt function are closed to the browser roles: ' || s);

      raise exception 'undo';
    exception when others then
      if sqlerrm <> 'undo' then
        res := res || ('ERROR, the run stopped early: ' || sqlerrm);
      end if;
    end;
  end if;

  perform setval('public.invoice_seq', v_seq, v_called);

  create table if not exists public._materials_release_test_out (n int, result text);
  delete from public._materials_release_test_out;
  insert into public._materials_release_test_out select ord, r from unnest(res) with ordinality as u(r, ord);
end $$;
select result from public._materials_release_test_out order by n;
drop table public._materials_release_test_out;
