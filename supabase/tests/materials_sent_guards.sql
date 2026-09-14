-- Proof that materials money is marked sent by a named person, once, and that
-- the worker is told only then. Run with execute_sql once 20260914190000 is
-- applied.
--
-- NOTHING HERE PERSISTS AND NOTHING LEAVES. It borrows a TEST job with a
-- booked worker, adds two releases inside a subtransaction and throws them
-- away. The WhatsApp the trigger queues sits in pg_net's queue inside the same
-- subtransaction, so it is thrown away with everything else and never sent.
--
-- Test 1 runs with nobody signed in; after it the block acts as the first
-- address on the admins list, local to this transaction.
do $$
declare
  v_admin text := (select email from public.admins order by email limit 1);
  v_job   text;
  v_rel   uuid;
  v_rel2  uuid;
  v_row   public.materials_releases%rowtype;
  v_q     int;
  s       text;
  res     text[] := '{}';
begin
  select j.id into v_job from public.jobs j
   where j.is_test and coalesce(j.worker_email, '') <> ''
   order by j.id limit 1;

  if v_job is null then
    res := res || 'SKIP, no TEST job with a booked worker to borrow'::text;
  else
    begin
      update public.jobs set materials_store_type = 'indoors', materials_store = 'Test store, back room' where id = v_job;
      insert into public.materials_releases (job_id, amount_jmd, receipt_ref, note, released_at, released_by)
      values (v_job, 1, '', 'materials_sent_guards', now(), 'test') returning id into v_rel;
      insert into public.materials_releases (job_id, amount_jmd, receipt_ref, note, released_at, released_by)
      values (v_job, 1, '', 'materials_sent_guards', now(), 'test') returning id into v_rel2;

      -- 1. nobody signed in, refused
      perform set_config('request.jwt.claims', '{}', true);
      begin
        perform public.mark_materials_sent(v_rel, 'bank_transfer', 'FT-1');
        res := res || '1. only an admin can mark materials money sent: FAIL, it was marked'::text;
      exception when others then
        res := res || ('1. only an admin can mark materials money sent: ' || case when sqlerrm ilike '%admin only%' then 'PASS' else 'FAIL, ' || sqlerrm end);
      end;

      perform set_config('request.jwt.claims', json_build_object('email', v_admin, 'role', 'authenticated')::text, true);

      -- 2. a method that is not live yet is refused
      begin
        perform public.mark_materials_sent(v_rel, 'stripe', '');
        res := res || '2. Stripe cannot be recorded before it is set up: FAIL, it was'::text;
      exception when others then
        res := res || ('2. Stripe cannot be recorded before it is set up: ' || case when sqlerrm ilike '%only a bank transfer%' then 'PASS' else 'FAIL, ' || sqlerrm end);
      end;

      -- 3. marked sent, stamped with the person and the time
      select count(*) into v_q from net.http_request_queue where convert_from(body, 'UTF8') ilike '%materials_sent_worker%';
      perform public.mark_materials_sent(v_rel, 'bank_transfer', ' FT-1 ');
      select * into v_row from public.materials_releases where id = v_rel;
      res := res || ('3. marked sent, stamped with who and when: ' || case
        when v_row.sent_at > now() - interval '1 minute' and v_row.sent_by = lower(v_admin)
         and v_row.sent_method = 'bank_transfer' and v_row.sent_ref = 'FT-1' then 'PASS'
        else 'FAIL, ' || coalesce(v_row.sent_by, '?') || ' ' || coalesce(v_row.sent_ref, '?') end);

      -- 4. the worker's WhatsApp is queued, for this release
      select case when (select count(*) from net.http_request_queue where convert_from(body, 'UTF8') ilike '%materials_sent_worker%') = v_q + 1
                   and exists (select 1 from net.http_request_queue where convert_from(body, 'UTF8') ilike '%' || v_rel::text || '%')
             then 'PASS' else 'FAIL' end into s;
      res := res || ('4. marking it sent queues the worker''s message: ' || s);

      -- 5. not twice
      begin
        perform public.mark_materials_sent(v_rel, 'bank_transfer', 'FT-2');
        res := res || '5. money is marked sent once: FAIL, marked again'::text;
      exception when others then
        res := res || ('5. money is marked sent once: ' || case when sqlerrm ilike '%already marked sent%' then 'PASS' else 'FAIL, ' || sqlerrm end);
      end;

      -- 6. a sent record is not edited, even by a direct write
      begin
        update public.materials_releases set sent_ref = 'FT-EDITED' where id = v_rel;
        res := res || '6. a sent record cannot be edited directly: FAIL, it was'::text;
      exception when others then
        res := res || ('6. a sent record cannot be edited directly: ' || case when sqlerrm ilike '%not changed%' then 'PASS' else 'FAIL, ' || sqlerrm end);
      end;

      -- 7. a direct write cannot choose who sent it or when
      update public.materials_releases
         set sent_at = '2000-01-01', sent_method = 'bank_transfer', sent_by = 'forged@example.com'
       where id = v_rel2;
      select * into v_row from public.materials_releases where id = v_rel2;
      res := res || ('7. the database, not the caller, writes who and when: ' || case
        when v_row.sent_by = lower(v_admin) and v_row.sent_at > now() - interval '1 minute' then 'PASS'
        else 'FAIL, ' || v_row.sent_by || ' ' || v_row.sent_at end);

      -- 8. a release cannot be created already sent
      begin
        insert into public.materials_releases (job_id, amount_jmd, receipt_ref, note, released_at, released_by, sent_at, sent_method)
        values (v_job, 1, '', 'materials_sent_guards', now(), 'test', now(), 'bank_transfer');
        res := res || '8. a release is never created already sent: FAIL, it was'::text;
      exception when others then
        res := res || ('8. a release is never created already sent: ' || case when sqlerrm ilike '%after it is released%' then 'PASS' else 'FAIL, ' || sqlerrm end);
      end;

      -- 9. the receipt still comes back after the money is sent
      begin
        perform public.record_materials_receipt(v_rel, 'HW-TEST-1', '');
        select * into v_row from public.materials_releases where id = v_rel;
        res := res || ('9. a receipt can be recorded after the money is sent: ' || case when v_row.receipt_ref = 'HW-TEST-1' and v_row.sent_ref = 'FT-1' then 'PASS' else 'FAIL' end);
      exception when others then
        res := res || ('9. a receipt can be recorded after the money is sent: FAIL, ' || sqlerrm);
      end;

      -- 10. nobody signed in cannot mark it sent even by a direct write
      perform set_config('request.jwt.claims', '{}', true);
      insert into public.materials_releases (job_id, amount_jmd, receipt_ref, note, released_at, released_by)
      values (v_job, 1, '', 'materials_sent_guards', now(), 'test') returning id into v_rel2;
      begin
        update public.materials_releases set sent_at = now(), sent_method = 'bank_transfer' where id = v_rel2;
        res := res || '10. a direct write with nobody signed in is refused: FAIL, it was marked'::text;
      exception when others then
        res := res || ('10. a direct write with nobody signed in is refused: ' || case when sqlerrm ilike '%named person%' then 'PASS' else 'FAIL, ' || sqlerrm end);
      end;

      -- 11. closed to anonymous callers
      select case when not has_function_privilege('anon', 'public.mark_materials_sent(uuid,text,text)', 'execute')
                   and not has_function_privilege('authenticated', 'public.notify_worker_materials_sent()', 'execute')
             then 'PASS' else 'FAIL' end into s;
      res := res || ('11. mark_materials_sent is closed to anonymous callers: ' || s);

      raise exception 'undo';
    exception when others then
      if sqlerrm <> 'undo' then
        res := res || ('ERROR, the run stopped early: ' || sqlerrm);
      end if;
    end;
  end if;

  create table if not exists public._materials_sent_test_out (n int, result text);
  delete from public._materials_sent_test_out;
  insert into public._materials_sent_test_out select ord, r from unnest(res) with ordinality as u(r, ord);
end $$;
select result from public._materials_sent_test_out order by n;
drop table public._materials_sent_test_out;
