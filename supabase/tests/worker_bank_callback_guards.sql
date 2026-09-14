-- Proof that nobody is paid on bank details nobody has checked by phone, and
-- that new details always need a fresh call-back. Run with execute_sql once
-- 20260914240000 is applied.
--
-- NOTHING HERE PERSISTS AND NOTHING LEAVES: one subtransaction, thrown away.
-- No Wise call is made; a Wise reference is written by hand to stand for the
-- one yaad-wise-recipient would record.
do $$
declare
  v_admin text := (select email from public.admins order by email limit 1);
  v_job   text;
  v_email text;
  v_rel   uuid;
  v_row   public.worker_profiles%rowtype;
  s       text;
  res     text[] := '{}';
begin
  select j.id, lower(j.worker_email) into v_job, v_email from public.jobs j
   where j.is_test and coalesce(j.worker_email, '') <> ''
     and exists (select 1 from public.worker_profiles w where lower(w.worker_email) = lower(j.worker_email))
   order by j.id limit 1;

  if v_job is null then
    res := res || 'SKIP, no TEST job whose worker has a profile'::text;
  else
    begin
      update public.jobs set materials_store_type = 'indoors', materials_store = 'Test store' where id = v_job;
      insert into public.materials_releases (job_id, amount_jmd, receipt_ref, note, released_at, released_by)
      values (v_job, 1, '', 'worker_bank_callback_guards', now(), 'test') returning id into v_rel;
      perform set_config('request.jwt.claims', json_build_object('email', v_admin, 'role', 'authenticated')::text, true);
      update public.worker_profiles set bank_callback_at = null where lower(worker_email) = v_email;

      -- 1. no call-back, no Mark as sent
      begin
        perform public.mark_materials_sent(v_rel, 'bank_transfer', 'FT-1');
        res := res || '1. money is not marked sent before a call-back: FAIL, it was'::text;
      exception when others then
        res := res || ('1. money is not marked sent before a call-back: ' || case when sqlerrm ilike '%call-back done%' then 'PASS' else 'FAIL, ' || sqlerrm end);
      end;

      -- 2. only an admin records a call-back
      perform set_config('request.jwt.claims', '{}', true);
      begin
        perform public.confirm_bank_callback(v_email);
        res := res || '2. only an admin records a call-back: FAIL, it was recorded'::text;
      exception when others then
        res := res || ('2. only an admin records a call-back: ' || case when sqlerrm ilike '%admin only%' then 'PASS' else 'FAIL, ' || sqlerrm end);
      end;
      perform set_config('request.jwt.claims', json_build_object('email', v_admin, 'role', 'authenticated')::text, true);

      -- 3. the call-back is stamped with the person, whatever the caller writes
      update public.worker_profiles set bank_callback_at = '2000-01-01', bank_callback_by = 'forged@example.com' where lower(worker_email) = v_email;
      select * into v_row from public.worker_profiles where lower(worker_email) = v_email limit 1;
      res := res || ('3. the database stamps who and when: ' || case when v_row.bank_callback_by = lower(v_admin) and v_row.bank_callback_at > now() - interval '1 minute' then 'PASS' else 'FAIL, ' || v_row.bank_callback_by end);

      -- 4. new details clear the call-back
      update public.worker_profiles set wise_recipient_id = 'TEST-RECIPIENT-1' where lower(worker_email) = v_email;
      select * into v_row from public.worker_profiles where lower(worker_email) = v_email limit 1;
      res := res || ('4. new bank details cancel the old call-back: ' || case when v_row.bank_callback_at is null and v_row.wise_recipient_set_at is not null then 'PASS' else 'FAIL' end);

      -- 5. and money cannot go on them until checked again
      begin
        perform public.mark_materials_sent(v_rel, 'bank_transfer', 'FT-1');
        res := res || '5. changed details are not paid unchecked: FAIL, it was'::text;
      exception when others then
        res := res || ('5. changed details are not paid unchecked: ' || case when sqlerrm ilike '%call-back done%' then 'PASS' else 'FAIL, ' || sqlerrm end);
      end;

      -- 6. after the call-back, it goes through
      perform public.confirm_bank_callback(v_email);
      perform public.mark_materials_sent(v_rel, 'bank_transfer', 'FT-1');
      res := res || ('6. after the call-back, money can be marked sent: ' || case when (select sent_at is not null from public.materials_releases where id = v_rel) then 'PASS' else 'FAIL' end);

      -- 7. the Pay workers step has the same gate
      select case when pg_get_functiondef('public.mark_worker_paid(text,text,text)'::regprocedure) ilike '%worker_bank_checked%'
             then 'PASS' else 'FAIL' end into s;
      res := res || ('7. Pay workers refuses unchecked details too: ' || s);

      -- 8. closed to anonymous callers
      select case when not has_function_privilege('anon', 'public.confirm_bank_callback(text)', 'execute')
                   and not has_function_privilege('authenticated', 'public.worker_bank_checked(text)', 'execute')
             then 'PASS' else 'FAIL' end into s;
      res := res || ('8. the call-back functions are closed to anonymous callers: ' || s);

      raise exception 'undo';
    exception when others then
      if sqlerrm <> 'undo' then res := res || ('ERROR, the run stopped early: ' || sqlerrm); end if;
    end;
  end if;

  create table if not exists public._worker_bank_callback_test_out (n int, result text);
  delete from public._worker_bank_callback_test_out;
  insert into public._worker_bank_callback_test_out select ord, r from unnest(res) with ordinality as u(r, ord);
end $$;
select result from public._worker_bank_callback_test_out order by n;
drop table public._worker_bank_callback_test_out;
