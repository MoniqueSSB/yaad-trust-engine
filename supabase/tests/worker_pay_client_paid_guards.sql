-- Proof that a worker is paid only after the client has paid for the work.
-- Run with execute_sql once 20260917180000 is applied.
--
-- NOTHING HERE PERSISTS AND NOTHING LEAVES. It reads TEST jobs that already
-- exist, adds throwaway draft pay invoices inside a subtransaction, and
-- throws everything away. mark_worker_paid is only ever called where it must
-- refuse, so no WhatsApp is queued; if one ever were, it is rolled back with
-- the rest.
--
-- WHAT IS BEING PROVED. The desk greys the buttons, but the desk is not the
-- control. Tests 3 to 6 are the rule itself; test 7 is the one that matters
-- most: mark_worker_paid refuses a pay invoice whose client money is unpaid,
-- even for an admin whose worker's bank details have been checked.
do $$
declare
  v_admin text := (select email from public.admins order by email limit 1);
  v_inv   text;
  s       text;
  res     text[] := '{}';
begin
  begin
    -- 1. closed to anonymous callers
    select case when not has_function_privilege('anon', 'public.worker_pay_client_unpaid(text)', 'execute')
           then 'PASS' else 'FAIL' end into s;
    res := res || ('1. the check is closed to anonymous callers: ' || s);

    -- 2. nobody signed in, refused
    perform set_config('request.jwt.claims', '{}', true);
    begin
      perform public.worker_pay_client_unpaid('INV-2026-0016');
      res := res || '2. only an admin can run the check: FAIL, it ran'::text;
    exception when others then
      res := res || ('2. only an admin can run the check: ' || case when sqlerrm ilike '%admin only%' then 'PASS' else 'FAIL, ' || sqlerrm end);
    end;

    perform set_config('request.jwt.claims', json_build_object('email', v_admin, 'role', 'authenticated')::text, true);

    -- 3. by stage, stage 2 not billed or paid: refused, and says stage 2
    s := public.worker_pay_client_unpaid('INV-2026-0016');
    res := res || ('3. stage 2 pay is refused while the client has not paid stage 2: ' ||
      case when s ilike '%stage 2%' then 'PASS' else 'FAIL, ' || coalesce(s, 'it was allowed') end);

    -- 4. by stage, stage 1 paid, but the whole-job bill and its part are not: refused, naming them
    insert into public.invoices (id, client_name, client_email, job_id, payable_to, stage, currency, total_pence)
    values ('TEST-WPCU-1', 'Test', 'test@example.invalid', 'JOB-TEST-KICKOFF-1', 'worker', 1, 'JMD', 100);
    s := public.worker_pay_client_unpaid('TEST-WPCU-1');
    res := res || ('4. stage 1 is paid but the fee bill is not, so still refused: ' ||
      case when s ilike '%INV-2026-0025%' then 'PASS' else 'FAIL, ' || coalesce(s, 'it was allowed') end);

    -- 5. in full, whole-job bill paid, nothing else owed: allowed
    insert into public.invoices (id, client_name, client_email, job_id, payable_to, stage, currency, total_pence)
    values ('TEST-WPCU-2', 'Test', 'test@example.invalid', 'JOB-TEST-WAPAY-3', 'worker', 1, 'JMD', 100);
    s := public.worker_pay_client_unpaid('TEST-WPCU-2');
    res := res || ('5. in full and the client bill is paid, so allowed: ' ||
      case when s is null then 'PASS' else 'FAIL, ' || s end);

    -- 6. in full, part sent but not paid: refused
    insert into public.invoices (id, client_name, client_email, job_id, payable_to, stage, currency, total_pence)
    values ('TEST-WPCU-3', 'Test', 'test@example.invalid', 'JOB-TEST-WA-CONFIRM', 'worker', 1, 'JMD', 100);
    s := public.worker_pay_client_unpaid('TEST-WPCU-3');
    res := res || ('6. in full and the client has not paid, so refused: ' ||
      case when s is not null then 'PASS' else 'FAIL, it was allowed' end);

    -- 7. mark_worker_paid refuses it, after the call-back gate is cleared
    perform public.confirm_bank_callback(i.worker_email) from public.invoices i
     where i.id = 'INV-2026-0016'
       and exists (select 1 from public.worker_profiles w where lower(w.worker_email) = lower(i.worker_email));
    begin
      perform public.mark_worker_paid('INV-2026-0016', 'bank_transfer', 'FT-TEST');
      res := res || '7. Mark as sent is refused while the client has not paid: FAIL, it was marked'::text;
    exception when others then
      res := res || ('7. Mark as sent is refused while the client has not paid: ' ||
        case when sqlerrm ilike '%client has not paid%' then 'PASS' else 'FAIL, ' || sqlerrm end);
    end;

    -- 8. a client bill cannot stand in for a worker's pay
    s := public.worker_pay_client_unpaid('INV-2026-0007');
    res := res || ('8. a client bill is not treated as a worker''s pay: ' ||
      case when s ilike '%client''s bill%' then 'PASS' else 'FAIL, ' || coalesce(s, 'it was allowed') end);

    raise exception 'undo';
  exception when others then
    if sqlerrm <> 'undo' then
      res := res || ('ERROR, the run stopped early: ' || sqlerrm);
    end if;
  end;

  create table if not exists public._wpcu_test_out (n int, result text);
  delete from public._wpcu_test_out;
  insert into public._wpcu_test_out select ord, r from unnest(res) with ordinality as u(r, ord);
end $$;
select result from public._wpcu_test_out order by n;
drop table public._wpcu_test_out;
