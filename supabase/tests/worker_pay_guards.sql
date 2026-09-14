-- Proof that a worker's pay is marked sent by a named person, once, that the
-- worker is told only then, and that client bills still mark paid as before.
-- Run with execute_sql once 20260914230000 is applied.
--
-- NOTHING HERE PERSISTS AND NOTHING LEAVES. It borrows sent invoices on TEST
-- jobs, marks them paid inside a subtransaction and throws it all away. The
-- WhatsApp the trigger queues sits in pg_net's queue inside the same
-- subtransaction, so it is thrown away with everything else and never sent.
--
-- Test 1 runs with nobody signed in; after it the block acts as the first
-- address on the admins list, local to this transaction.
do $$
declare
  v_admin text := (select email from public.admins order by email limit 1);
  v_w1    text;
  v_w2    text;
  v_c1    text;
  v_row   public.invoices%rowtype;
  v_q     int;
  s       text;
  res     text[] := '{}';
begin
  select i.id into v_w1 from public.invoices i join public.jobs j on j.id = i.job_id
   where j.is_test and i.payable_to = 'worker' and i.status = 'sent' order by i.id limit 1;
  select i.id into v_w2 from public.invoices i join public.jobs j on j.id = i.job_id
   where j.is_test and i.payable_to = 'worker' and i.status = 'sent' and i.id <> v_w1 order by i.id limit 1;
  select i.id into v_c1 from public.invoices i join public.jobs j on j.id = i.job_id
   where j.is_test and i.payable_to is distinct from 'worker' and i.status = 'sent' order by i.id limit 1;

  if v_w1 is null then
    res := res || 'SKIP, no sent worker pay invoice on a TEST job to borrow'::text;
  else
    begin
      -- 1. nobody signed in, refused
      perform set_config('request.jwt.claims', '{}', true);
      begin
        perform public.mark_worker_paid(v_w1, 'bank_transfer', 'FT-1');
        res := res || '1. only an admin can mark a worker paid: FAIL, it was marked'::text;
      exception when others then
        res := res || ('1. only an admin can mark a worker paid: ' || case when sqlerrm ilike '%admin only%' then 'PASS' else 'FAIL, ' || sqlerrm end);
      end;

      perform set_config('request.jwt.claims', json_build_object('email', v_admin, 'role', 'authenticated')::text, true);
      -- 20260914240000: nobody is paid before a call-back, so the borrowed
      -- workers get one first, inside this same throwaway transaction.
      perform public.confirm_bank_callback(i.worker_email) from public.invoices i
       where i.id in (v_w1, v_w2)
         and exists (select 1 from public.worker_profiles w where lower(w.worker_email) = lower(i.worker_email));

      -- 2. a method that is not live yet is refused
      begin
        perform public.mark_worker_paid(v_w1, 'stripe', '');
        res := res || '2. Stripe cannot be recorded before it is set up: FAIL, it was'::text;
      exception when others then
        res := res || ('2. Stripe cannot be recorded before it is set up: ' || case when sqlerrm ilike '%only a bank transfer%' then 'PASS' else 'FAIL, ' || sqlerrm end);
      end;

      -- 3. a client's bill is not a worker's pay
      if v_c1 is null then
        res := res || '3. a client bill cannot go through the worker step: SKIP, no sent client bill on a TEST job'::text;
      else
        begin
          perform public.mark_worker_paid(v_c1, 'bank_transfer', '');
          res := res || '3. a client bill cannot go through the worker step: FAIL, it was'::text;
        exception when others then
          res := res || ('3. a client bill cannot go through the worker step: ' || case when sqlerrm ilike '%not a worker%' then 'PASS' else 'FAIL, ' || sqlerrm end);
        end;
      end if;

      -- 4. marked paid, stamped with the person, the method and the time
      select count(*) into v_q from net.http_request_queue where convert_from(body, 'UTF8') ilike '%worker_paid%';
      perform public.mark_worker_paid(v_w1, 'bank_transfer', ' FT-1 ');
      select * into v_row from public.invoices where id = v_w1;
      res := res || ('4. marked paid, stamped with who, how and when: ' || case
        when v_row.status = 'paid' and v_row.paid_at > now() - interval '1 minute' and v_row.paid_by = lower(v_admin)
         and v_row.paid_method = 'bank_transfer' and v_row.paid_reference = 'FT-1' then 'PASS'
        else 'FAIL, ' || coalesce(v_row.status, '?') || ' ' || coalesce(v_row.paid_by, '?') || ' ' || coalesce(v_row.paid_reference, '?') end);

      -- 5. the worker's WhatsApp is queued, for this invoice
      select case when (select count(*) from net.http_request_queue where convert_from(body, 'UTF8') ilike '%worker_paid%') = v_q + 1
                   and exists (select 1 from net.http_request_queue where convert_from(body, 'UTF8') ilike '%' || v_w1 || '%')
             then 'PASS' else 'FAIL' end into s;
      res := res || ('5. marking it paid queues the worker''s message: ' || s);

      -- 6. not twice
      begin
        perform public.mark_worker_paid(v_w1, 'bank_transfer', 'FT-2');
        res := res || '6. a worker is marked paid once: FAIL, marked again'::text;
      exception when others then
        res := res || ('6. a worker is marked paid once: ' || case when sqlerrm ilike '%already marked paid%' then 'PASS' else 'FAIL, ' || sqlerrm end);
      end;

      -- 7. a paid record is not edited, even by a direct write
      begin
        update public.invoices set paid_reference = 'FT-EDITED' where id = v_w1;
        res := res || '7. a paid record cannot be edited directly: FAIL, it was'::text;
      exception when others then
        res := res || ('7. a paid record cannot be edited directly: ' || case when sqlerrm ilike '%not changed%' then 'PASS' else 'FAIL, ' || sqlerrm end);
      end;

      -- 8. the old generic "Mark as paid" cannot skip the record on a worker's pay
      if v_w2 is null then
        res := res || '8. a worker''s pay cannot be marked paid without saying how: SKIP, only one sent worker invoice on TEST jobs'::text;
      else
        begin
          update public.invoices set status = 'paid', paid_reference = 'x' where id = v_w2;
          res := res || '8. a worker''s pay cannot be marked paid without saying how: FAIL, it was'::text;
        exception when others then
          res := res || ('8. a worker''s pay cannot be marked paid without saying how: ' || case when sqlerrm ilike '%Pay workers%' then 'PASS' else 'FAIL, ' || sqlerrm end);
        end;
      end if;

      -- 9. a client bill still marks paid the old way, now stamped, and tells no worker
      if v_c1 is null then
        res := res || '9. a client bill still marks paid as before: SKIP, no sent client bill on a TEST job'::text;
      else
        select count(*) into v_q from net.http_request_queue where convert_from(body, 'UTF8') ilike '%worker_paid%';
        update public.invoices set status = 'paid', paid_reference = 'CLIENT-REF' where id = v_c1;
        select * into v_row from public.invoices where id = v_c1;
        res := res || ('9. a client bill still marks paid as before, stamped, no worker message: ' || case
          when v_row.status = 'paid' and v_row.paid_by = lower(v_admin) and v_row.paid_method is null
           and (select count(*) from net.http_request_queue where convert_from(body, 'UTF8') ilike '%worker_paid%') = v_q
          then 'PASS' else 'FAIL, ' || coalesce(v_row.status, '?') || ' ' || coalesce(v_row.paid_by, '?') end);
      end if;

      -- 10. how it was paid cannot be written on an unpaid invoice
      if v_w2 is null then
        res := res || '10. a method cannot be written before the invoice is paid: SKIP, only one sent worker invoice on TEST jobs'::text;
      else
        begin
          update public.invoices set paid_method = 'bank_transfer' where id = v_w2;
          res := res || '10. a method cannot be written before the invoice is paid: FAIL, it was'::text;
        exception when others then
          res := res || ('10. a method cannot be written before the invoice is paid: ' || case when sqlerrm ilike '%not before%' then 'PASS' else 'FAIL, ' || sqlerrm end);
        end;
      end if;

      -- 11. closed to anonymous callers
      select case when not has_function_privilege('anon', 'public.mark_worker_paid(text,text,text)', 'execute')
                   and not has_function_privilege('authenticated', 'public.notify_worker_paid()', 'execute')
             then 'PASS' else 'FAIL' end into s;
      res := res || ('11. mark_worker_paid is closed to anonymous callers: ' || s);

      raise exception 'undo';
    exception when others then
      if sqlerrm <> 'undo' then
        res := res || ('ERROR, the run stopped early: ' || sqlerrm);
      end if;
    end;
  end if;

  create table if not exists public._worker_pay_test_out (n int, result text);
  delete from public._worker_pay_test_out;
  insert into public._worker_pay_test_out select ord, r from unnest(res) with ordinality as u(r, ord);
end $$;
select result from public._worker_pay_test_out order by n;
drop table public._worker_pay_test_out;
