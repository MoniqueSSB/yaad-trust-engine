-- Proof that a job bill can be requested in parts without an amount ever
-- sitting on two invoices, and that the job starts on the fee, wherever the
-- fee line is. Run with execute_sql once 20260913233000 is applied.
--
-- NOTHING HERE PERSISTS AND NOTHING LEAVES. It borrows a TEST job that has an
-- accepted quote and no client bill yet, does everything inside a
-- subtransaction, and throws that subtransaction away at the end, so the bill,
-- the parts, the job moving to started and anything a trigger queued through
-- pg_net all roll back. pg_net only sends what commits. The results survive
-- because they are held in a variable, not a table, until the rollback is done.
--
-- Raising takes invoice numbers, and a sequence does not roll back, so the
-- block puts invoice_seq back where it found it. A real invoice raised in the
-- same moment would make that unsafe: run it when nobody is invoicing.
--
-- request_invoice_part and raise_job_client_invoice are admin only. Test 1
-- proves that with nobody signed in; after it, the block acts as the first
-- address on the admins list by setting the JWT claim is_admin() reads, local
-- to this transaction.
do $$
declare
  v_admin   text := (select email from public.admins order by email limit 1);
  v_job     text;
  v_before  text;
  v_seq     bigint;
  v_called  boolean;
  v_bill    text;
  v_part    text;
  v_part2   text;
  v_part3   text;
  l_work    bigint;
  l_fee     bigint;
  l_mat     bigint;
  v         int;
  v2        int;
  b         boolean;
  s         text;
  res       text[] := '{}';
begin
  select last_value, is_called into v_seq, v_called from public.invoice_seq;

  select j.id, j.status into v_job, v_before from public.jobs j
   where j.is_test and coalesce(j.worker_email, '') <> '' and coalesce(j.client_email, '') <> ''
     and exists (select 1 from public.job_quotes q where q.job_id = j.id and q.status = 'accepted' and q.labour_jmd > 0)
     and not exists (select 1 from public.invoices i where i.job_id = j.id and (i.stage is null or i.stage = 0) and i.status <> 'void')
   order by j.id limit 1;

  if v_job is null then
    res := res || 'SKIP, no TEST job with an accepted quote and no client bill to borrow'::text;
  else
    begin
      -- 1. nobody signed in, refused
      perform set_config('request.jwt.claims', '{}', true);
      begin
        perform public.raise_job_client_invoice(v_job);
        res := res || '1. nobody but an admin can raise a bill: FAIL, it raised'::text;
      exception when others then
        res := res || ('1. nobody but an admin can raise a bill: ' || case when sqlerrm ilike '%admin only%' then 'PASS' else 'FAIL, ' || sqlerrm end);
      end;

      perform set_config('request.jwt.claims', json_build_object('email', v_admin, 'role', 'authenticated')::text, true);

      -- 2. the bill marks its own fee line, and paying the bill starts the job
      select invoice_id into v_bill from public.raise_job_client_invoice(v_job);
      select id into l_work from public.invoice_lines where invoice_id = v_bill and sort = 0;
      select id into l_fee  from public.invoice_lines where invoice_id = v_bill and is_fee;
      select id into l_mat  from public.invoice_lines where invoice_id = v_bill and sort = 2;
      select starts_job, total_pence into b, v from public.invoices where id = v_bill;
      res := res || ('2. the bill marks its fee line and starts the job: ' || case when l_fee is not null and b then 'PASS' else 'FAIL' end);

      -- 3. the fee is never split
      begin
        perform public.request_invoice_part(v_bill, jsonb_build_array(jsonb_build_object('line', l_fee, 'amount', 1)));
        res := res || '3. the fee cannot be split: FAIL, it split'::text;
      exception when others then
        res := res || ('3. the fee cannot be split: ' || case when sqlerrm ilike '%requested whole%' then 'PASS' else 'FAIL, ' || sqlerrm end);
      end;

      -- 4. no more than the line
      begin
        perform public.request_invoice_part(v_bill, jsonb_build_array(jsonb_build_object('line', l_work,
          'amount', (select line_total_pence + 1 from public.invoice_lines where id = l_work))));
        res := res || '4. cannot request more than the line holds: FAIL, it did'::text;
      exception when others then
        res := res || ('4. cannot request more than the line holds: ' || case when sqlerrm ilike '%request between%' then 'PASS' else 'FAIL, ' || sqlerrm end);
      end;

      -- 5. half the work and the fee: every amount is on one document
      select invoice_id into v_part from public.request_invoice_part(v_bill, jsonb_build_array(
        jsonb_build_object('line', l_work, 'amount', (select line_total_pence / 2 from public.invoice_lines where id = l_work)),
        jsonb_build_object('line', l_fee)));
      select (select total_pence from public.invoices where id = v_bill)
           + (select total_pence from public.invoices where id = v_part) into v2;
      res := res || ('5. a part takes its amount off the bill, nothing counted twice: ' || case when v2 = v then 'PASS' else 'FAIL, ' || v || ' became ' || v2 end);

      -- 6. starts_job went with the fee
      select (select starts_job from public.invoices where id = v_part)
             and not (select starts_job from public.invoices where id = v_bill) into b;
      res := res || ('6. paying the part with the fee, not the bill, starts the job: ' || case when b then 'PASS' else 'FAIL' end);

      -- 7. a part is not a bill
      begin
        perform public.request_invoice_part(v_part, jsonb_build_array(jsonb_build_object('line',
          (select id from public.invoice_lines where invoice_id = v_part limit 1))));
        res := res || '7. a part cannot itself be split: FAIL, it was'::text;
      exception when others then
        res := res || ('7. a part cannot itself be split: ' || case when sqlerrm ilike '%whole-job bill%' then 'PASS' else 'FAIL, ' || sqlerrm end);
      end;

      -- 8. the bill cannot go while a part is live
      begin
        update public.invoices set status = 'void' where id = v_bill;
        res := res || '8. a bill with a live part cannot be voided: FAIL, it was'::text;
      exception when others then
        res := res || ('8. a bill with a live part cannot be voided: ' || case when sqlerrm ilike '%parts still live%' then 'PASS' else 'FAIL, ' || sqlerrm end);
      end;

      -- 9. voiding the part while the bill is a draft puts everything back
      update public.invoices set status = 'void' where id = v_part;
      select total_pence, starts_job into v2, b from public.invoices where id = v_bill;
      res := res || ('9. voiding a part puts its amount and the fee back on the bill: ' || case when v2 = v and b then 'PASS' else 'FAIL, bill is ' || v2 || ' of ' || v end);

      -- 10. a paid part without the fee does not start the job
      if l_mat is null then
        res := res || '10. a paid part without the fee does not start the job: SKIP, no materials line on this quote'::text;
      else
        select invoice_id into v_part2 from public.request_invoice_part(v_bill, jsonb_build_array(jsonb_build_object('line', l_mat)));
        update public.invoices set status = 'sent' where id = v_part2;
        update public.invoices set status = 'paid' where id = v_part2;
        select status into s from public.jobs where id = v_job;
        res := res || ('10. a paid part without the fee does not start the job: ' || case when v_before <> 'awaiting_payment' then 'SKIP, the TEST job was already ' || v_before when s = 'awaiting_payment' then 'PASS' else 'FAIL, job is ' || s end);
      end if;

      -- 11. the fee alone, paid, starts the job while the rest is still unpaid
      select id into l_fee from public.invoice_lines where invoice_id = v_bill and is_fee;
      select invoice_id into v_part from public.request_invoice_part(v_bill, jsonb_build_array(jsonb_build_object('line', l_fee)));
      update public.invoices set status = 'sent' where id = v_part;
      update public.invoices set status = 'paid' where id = v_part;
      select status into s from public.jobs where id = v_job;
      res := res || ('11. paying the part with the fee starts the job: ' || case when v_before <> 'awaiting_payment' then 'SKIP, the TEST job was already ' || v_before when s <> 'awaiting_payment' then 'PASS, job is ' || s else 'FAIL, still awaiting payment' end);

      -- 12. once the balance has gone out, a sent part cannot be voided
      select invoice_id into v_part3 from public.request_invoice_part(v_bill, jsonb_build_array(jsonb_build_object('line', l_work, 'amount', 1)));
      update public.invoices set status = 'sent' where id = v_part3;
      update public.invoices set status = 'sent' where id = v_bill;
      begin
        update public.invoices set status = 'void' where id = v_part3;
        res := res || '12. a part cannot be voided once the balance has gone out: FAIL, it was'::text;
      exception when others then
        res := res || ('12. a part cannot be voided once the balance has gone out: ' || case when sqlerrm ilike '%nowhere to go%' then 'PASS' else 'FAIL, ' || sqlerrm end);
      end;

      -- 13. nothing more comes off a bill that has gone out
      begin
        perform public.request_invoice_part(v_bill, jsonb_build_array(jsonb_build_object('line', l_work, 'amount', 1)));
        res := res || '13. nothing can be requested from a sent bill: FAIL, it was'::text;
      exception when others then
        res := res || ('13. nothing can be requested from a sent bill: ' || case when sqlerrm ilike '%frozen%' then 'PASS' else 'FAIL, ' || sqlerrm end);
      end;

      raise exception 'undo';
    exception when others then
      if sqlerrm <> 'undo' then
        res := res || ('ERROR, the run stopped early: ' || sqlerrm);
      end if;
    end;
  end if;

  perform setval('public.invoice_seq', v_seq, v_called);

  create table if not exists public._invoice_parts_test_out (n int, result text);
  delete from public._invoice_parts_test_out;
  insert into public._invoice_parts_test_out select ord, r from unnest(res) with ordinality as u(r, ord);
end $$;
select result from public._invoice_parts_test_out order by n;
drop table public._invoice_parts_test_out;
