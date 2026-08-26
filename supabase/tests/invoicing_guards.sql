-- Proof that the invoicing guards hold. Run against the project with
-- execute_sql, or psql. It creates TEST- rows and removes them again.
--
-- The session running this has no admin JWT, which is the point: tests 8 and 9
-- prove that a caller who is not a signed-in admin cannot move money.
do $$
declare r text; v int;
begin
  create temp table t(n int generated always as identity, name text, result text) on commit drop;
  delete from public.invoices where id like 'TEST-%';

  insert into public.invoices (id, client_name, client_email, drafted_by, period_label)
  values ('TEST-AI-1', 'Marcia Brown', 'marcia@example.com', 'ai', 'August 2026');

  -- 1. the agent claims the retainer costs 1p. Postgres overwrites it.
  insert into public.invoice_lines (invoice_id, catalogue_id, description, qty, unit_amount_pence, price_source)
  values ('TEST-AI-1','retainer','Oversight Retainer, August 2026', 1, 1, 'catalogue_founding');
  select unit_amount_pence into v from public.invoice_lines where invoice_id='TEST-AI-1' and catalogue_id='retainer';
  insert into t(name,result) values ('1. model-supplied price is overwritten',
    case when v = 39500 then 'PASS' else 'FAIL, got '||v end);

  -- 2. totals come from the trigger, not the caller
  insert into public.invoice_lines (invoice_id, catalogue_id, description, qty, unit_amount_pence, price_source)
  values ('TEST-AI-1','eyes-on-it','Extra site visit, Portmore', 2, 999999, 'catalogue_founding');
  select total_pence into v from public.invoices where id='TEST-AI-1';
  insert into t(name,result) values ('2. totals computed from lines',
    case when v = 39500 + 2*9500 then 'PASS' else 'FAIL, got '||v end);

  -- 3. a manual price on an AI-drafted invoice is refused
  begin
    insert into public.invoice_lines (invoice_id, description, qty, unit_amount_pence, price_source)
    values ('TEST-AI-1','Made up extra', 1, 25000, 'manual');
    insert into t(name,result) values ('3. manual price on an AI invoice', 'FAIL, it was allowed');
  exception when others then
    insert into t(name,result) values ('3. manual price on an AI invoice', 'PASS, refused');
  end;

  -- 4. work not in the catalogue lands unpriced
  insert into public.invoice_lines (invoice_id, description, qty, unit_amount_pence, price_source)
  values ('TEST-AI-1','Drone survey of the roof', 1, 40000, 'needs_price');
  select unit_amount_pence into v from public.invoice_lines where invoice_id='TEST-AI-1' and price_source='needs_price';
  insert into t(name,result) values ('4. unmapped work is zeroed, never guessed',
    case when v = 0 then 'PASS' else 'FAIL, got '||v end);

  -- 5. cannot send while a line is unpriced
  begin
    update public.invoices set status='sent' where id='TEST-AI-1';
    insert into t(name,result) values ('5. send blocked by unpriced line', 'FAIL, it sent');
  exception when others then
    insert into t(name,result) values ('5. send blocked by unpriced line', 'PASS, refused');
  end;

  -- 6. remove the unpriced line, now it sends
  delete from public.invoice_lines where invoice_id='TEST-AI-1' and price_source='needs_price';
  update public.invoices set status='sent' where id='TEST-AI-1';
  select case when status='sent' and sent_at is not null then 'PASS' else 'FAIL' end
    into r from public.invoices where id='TEST-AI-1';
  insert into t(name,result) values ('6. sends once every line is priced', r);

  -- 7. a sent invoice is frozen
  begin
    update public.invoice_lines set qty = 99 where invoice_id='TEST-AI-1' and catalogue_id='retainer';
    insert into t(name,result) values ('7. sent invoice lines are frozen', 'FAIL, edited after sending');
  exception when others then
    insert into t(name,result) values ('7. sent invoice lines are frozen', 'PASS, refused');
  end;

  -- 8. nobody without an admin session marks it paid
  begin
    update public.invoices set status='paid' where id='TEST-AI-1';
    insert into t(name,result) values ('8. only an admin marks paid', 'FAIL, marked paid with no admin');
  exception when others then
    insert into t(name,result) values ('8. only an admin marks paid', 'PASS, refused');
  end;

  -- 9. no skipping straight from draft to paid
  insert into public.invoices (id, client_name, client_email) values ('TEST-H-2','Test','t@example.com');
  begin
    update public.invoices set status='paid' where id='TEST-H-2';
    insert into t(name,result) values ('9. draft cannot jump to paid', 'FAIL, it jumped');
  exception when others then
    insert into t(name,result) values ('9. draft cannot jump to paid', 'PASS, refused');
  end;

  -- 10. a human-drafted invoice may carry a bespoke price
  insert into public.invoice_lines (invoice_id, description, qty, unit_amount_pence, price_source)
  values ('TEST-H-2','Agreed bespoke scope', 1, 27500, 'manual');
  select total_pence into v from public.invoices where id='TEST-H-2';
  insert into t(name,result) values ('10. a human may set a bespoke price',
    case when v = 27500 then 'PASS' else 'FAIL, got '||v end);

  -- 11. an empty invoice cannot be sent
  insert into public.invoices (id, client_name, client_email) values ('TEST-H-3','Test','t@example.com');
  begin
    update public.invoices set status='sent' where id='TEST-H-3';
    insert into t(name,result) values ('11. empty invoice cannot be sent', 'FAIL, it sent');
  exception when others then
    insert into t(name,result) values ('11. empty invoice cannot be sent', 'PASS, refused');
  end;

  create table if not exists public._invoice_test_out (n int, name text, result text);
  delete from public._invoice_test_out;
  insert into public._invoice_test_out select n,name,result from t;
  delete from public.invoices where id like 'TEST-%';
end $$;
select name, result from public._invoice_test_out order by n;
drop table public._invoice_test_out;
