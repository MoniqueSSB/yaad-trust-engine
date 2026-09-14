-- Proof that a sent invoice is reissued without an amount ever sitting on two
-- invoices, and that everything which must refuse, refuses. Run with
-- execute_sql once 20260914210000 is applied.
--
-- NOTHING HERE PERSISTS AND NOTHING LEAVES. Same shape as
-- invoice_parts_guards.sql: it borrows a TEST job with an accepted quote and
-- no client bill yet, works inside a subtransaction, and throws it away, so
-- every invoice, line, card payment row and anything queued through pg_net
-- rolls back. The block puts invoice_seq back where it found it, so run it
-- when nobody is invoicing.
do $$
declare
  v_admin  text := (select email from public.admins order by email limit 1);
  v_job    text;
  v_seq    bigint;
  v_called boolean;
  v_bill   text;
  v_new    text;
  v_part   text;
  v_new2   text;
  v_part3  text;
  v_wp     text;
  l_work   bigint;
  l_fee    bigint;
  v        int;
  v2       int;
  b        boolean;
  s        text;
  res      text[] := '{}';
begin
  select last_value, is_called into v_seq, v_called from public.invoice_seq;

  select j.id into v_job from public.jobs j
   where j.is_test and coalesce(j.worker_email, '') <> '' and coalesce(j.client_email, '') <> ''
     and exists (select 1 from public.job_quotes q where q.job_id = j.id and q.status = 'accepted' and q.labour_jmd > 1)
     and not exists (select 1 from public.invoices i where i.job_id = j.id and (i.stage is null or i.stage = 0) and i.status <> 'void')
   order by j.id limit 1;

  if v_job is null then
    res := res || 'SKIP, no TEST job with an accepted quote and no client bill to borrow'::text;
  else
    begin
      -- 1. nobody signed in, refused
      perform set_config('request.jwt.claims', '{}', true);
      begin
        perform public.reissue_invoice('INV-0000-0000');
        res := res || '1. nobody but an admin can reissue: FAIL, it ran'::text;
      exception when others then
        res := res || ('1. nobody but an admin can reissue: ' || case when sqlerrm ilike '%admin only%' then 'PASS' else 'FAIL, ' || sqlerrm end);
      end;

      perform set_config('request.jwt.claims', json_build_object('email', v_admin, 'role', 'authenticated')::text, true);

      select invoice_id into v_bill from public.raise_job_client_invoice(v_job);
      select total_pence into v from public.invoices where id = v_bill;
      select id into l_work from public.invoice_lines where invoice_id = v_bill and sort = 0;
      select id into l_fee  from public.invoice_lines where invoice_id = v_bill and is_fee;

      -- 2. a draft is edited, not reissued
      begin
        perform public.reissue_invoice(v_bill);
        res := res || '2. a draft cannot be reissued: FAIL, it was'::text;
      exception when others then
        res := res || ('2. a draft cannot be reissued: ' || case when sqlerrm ilike '%only a sent invoice%' then 'PASS' else 'FAIL, ' || sqlerrm end);
      end;

      -- 3. a sent bill with a sent part: the copy takes the bill's place and the part follows it
      select invoice_id into v_part from public.request_invoice_part(v_bill, jsonb_build_array(
        jsonb_build_object('line', l_work, 'amount', (select line_total_pence / 2 from public.invoice_lines where id = l_work)),
        jsonb_build_object('line', l_fee)));
      update public.invoices set status = 'sent' where id = v_part;
      update public.invoices set status = 'sent' where id = v_bill;
      select total_pence into v2 from public.invoices where id = v_bill;
      select r.invoice_id into v_new from public.reissue_invoice(v_bill) r;
      select (select status from public.invoices where id = v_bill) = 'void'
         and (select status from public.invoices where id = v_new) = 'draft'
         and (select replaces from public.invoices where id = v_new) = v_bill
         and (select total_pence from public.invoices where id = v_new) = v2
         and (select part_of from public.invoices where id = v_part) = v_new
         and not (select starts_job from public.invoices where id = v_new)
         and (select starts_job from public.invoices where id = v_part)
        into b;
      res := res || ('3. a sent bill is voided, copied as a draft, and its part moves to the copy: ' || case when b then 'PASS' else 'FAIL' end);

      select sum(total_pence) into v2 from public.invoices
       where job_id = v_job and stage is null and payable_to = 'yaadly' and status <> 'void';
      res := res || ('4. after reissuing the bill, every amount is on one live invoice: ' || case when v2 = v then 'PASS' else 'FAIL, ' || v || ' became ' || v2 end);

      -- 5. a sent part of a draft bill: put back and requested again
      select r.invoice_id into v_new2 from public.reissue_invoice(v_part) r;
      select (select status from public.invoices where id = v_part) = 'void'
         and (select status from public.invoices where id = v_new2) = 'draft'
         and (select part_of from public.invoices where id = v_new2) = v_new
         and (select replaces from public.invoices where id = v_new2) = v_part
         and (select total_pence from public.invoices where id = v_new2) = (select total_pence from public.invoices where id = v_part)
         and (select starts_job from public.invoices where id = v_new2)
        into b;
      select sum(total_pence) into v2 from public.invoices
       where job_id = v_job and stage is null and payable_to = 'yaadly' and status <> 'void';
      res := res || ('5. a sent part is reissued as a new part, the fee and the job start with it: ' || case when b and v2 = v then 'PASS' else 'FAIL, total ' || v2 || ' of ' || v end);

      -- 6. a card payment Stripe recorded blocks the reissue
      update public.invoices set status = 'sent' where id = v_new2;
      insert into public.invoice_payments (invoice_id, provider, provider_ref, amount_minor, amount_stored, currency, livemode, status)
      values (v_new2, 'stripe', 'test_reissue_' || v_new2, 0, 0, 'JMD', false, 'succeeded');
      begin
        perform public.reissue_invoice(v_new2);
        res := res || '6. a card-paid invoice cannot be reissued: FAIL, it was'::text;
      exception when others then
        res := res || ('6. a card-paid invoice cannot be reissued: ' || case when sqlerrm ilike '%card payment%' then 'PASS' else 'FAIL, ' || sqlerrm end);
      end;

      -- 7. a paid invoice is money in
      update public.invoices set status = 'paid' where id = v_new2;
      begin
        perform public.reissue_invoice(v_new2);
        res := res || '7. a paid invoice cannot be reissued: FAIL, it was'::text;
      exception when others then
        res := res || ('7. a paid invoice cannot be reissued: ' || case when sqlerrm ilike '%is paid%' then 'PASS' else 'FAIL, ' || sqlerrm end);
      end;

      -- 8. a part whose bill has gone out is refused, and nothing moves
      select id into l_work from public.invoice_lines where invoice_id = v_new and sort = 0 limit 1;
      select invoice_id into v_part3 from public.request_invoice_part(v_new, jsonb_build_array(jsonb_build_object('line', l_work, 'amount', 1)));
      update public.invoices set status = 'sent' where id = v_part3;
      update public.invoices set status = 'sent' where id = v_new;
      begin
        perform public.reissue_invoice(v_part3);
        res := res || '8. a part cannot be reissued once its bill has gone out: FAIL, it was'::text;
      exception when others then
        select status into s from public.invoices where id = v_part3;
        res := res || ('8. a part cannot be reissued once its bill has gone out: ' || case when sqlerrm ilike '%nowhere to go%' and s = 'sent' then 'PASS' else 'FAIL, ' || sqlerrm end);
      end;

      -- 9. what Yaadly owes a tradesperson is not a client invoice
      v_wp := public.new_invoice_number();
      insert into public.invoices (id, client_name, client_email, job_id, stage, currency, payable_to, drafted_by)
      values (v_wp, 'TEST worker', 'test-worker@example.com', v_job, 1, 'JMD', 'worker', 'human');
      insert into public.invoice_lines (invoice_id, description, qty, unit_amount_pence, price_source, sort)
      values (v_wp, 'TEST worker pay', 1, 100, 'manual', 0);
      update public.invoices set status = 'sent' where id = v_wp;
      begin
        perform public.reissue_invoice(v_wp);
        res := res || '9. a worker payable cannot be reissued: FAIL, it was'::text;
      exception when others then
        res := res || ('9. a worker payable cannot be reissued: ' || case when sqlerrm ilike '%owes a tradesperson%' then 'PASS' else 'FAIL, ' || sqlerrm end);
      end;

      raise exception 'undo';
    exception when others then
      if sqlerrm <> 'undo' then
        res := res || ('ERROR, the run stopped early: ' || sqlerrm);
      end if;
    end;
  end if;

  perform setval('public.invoice_seq', v_seq, v_called);

  create table if not exists public._invoice_reissue_test_out (n int, result text);
  delete from public._invoice_reissue_test_out;
  insert into public._invoice_reissue_test_out select ord, r from unnest(res) with ordinality as u(r, ord);
end $$;
select result from public._invoice_reissue_test_out order by n;
drop table public._invoice_reissue_test_out;
