-- Proof that a delivery status only moves forward, that a sender's kind and
-- job survive the callback landing first, and that following a failure up is
-- one named admin's act. Run with execute_sql once 20260916140000 is applied.
--
-- NOTHING HERE PERSISTS. Every row is written inside a block that ends by
-- raising, which throws the lot away; the results come back as the text of
-- that final error. The SIDs are invented and start TEST-, so nothing real is
-- touched even for the length of the block.
do $$
declare
  v_admin text := (select email from public.admins order by email limit 1);
  v_row   record;
  v_n     int;
  s       text;
  res     text[] := '{}';
begin
  -- 1. a late "sent" does not overwrite "undelivered", and the code stays
  perform public.record_message_delivery('TEST-SM-1', '+447700900001', 'whatsapp', '', '', 'undelivered', '63016');
  perform public.record_message_delivery('TEST-SM-1', '+447700900001', 'whatsapp', '', '', 'sent', '');
  select * into v_row from public.message_deliveries where message_sid = 'TEST-SM-1';
  res := res || ('1. a late sent does not overwrite undelivered: '
    || case when v_row.status = 'undelivered' and v_row.error_code = '63016' then 'PASS' else 'FAIL, ' || v_row.status || '/' || v_row.error_code end);

  -- 2. the sender writing after the callback fills the kind and job, keeps the status and Twilio's number
  perform public.record_message_delivery('TEST-SM-1', 'whatsapp:+44 7700 900001', 'whatsapp', 'quote ready', 'JOB-TEST-1', 'accepted', '');
  select * into v_row from public.message_deliveries where message_sid = 'TEST-SM-1';
  res := res || ('2. a sender after the callback fills kind and job only: '
    || case when v_row.kind = 'quote ready' and v_row.job_id = 'JOB-TEST-1' and v_row.status = 'undelivered' and v_row.to_addr = '+447700900001'
            then 'PASS' else 'FAIL, ' || v_row.kind || '/' || v_row.job_id || '/' || v_row.status || '/' || v_row.to_addr end);

  -- 3. the callback after the sender moves the status forward and keeps the kind
  perform public.record_message_delivery('TEST-SM-2', '+447700900001', 'whatsapp', 'desk reply', 'JOB-TEST-1', 'accepted', '');
  perform public.record_message_delivery('TEST-SM-2', '+447700900001', 'whatsapp', '', '', 'read', '');
  select * into v_row from public.message_deliveries where message_sid = 'TEST-SM-2';
  res := res || ('3. a callback after the sender moves forward and keeps the kind: '
    || case when v_row.status = 'read' and v_row.kind = 'desk reply' then 'PASS' else 'FAIL, ' || v_row.status || '/' || v_row.kind end);

  -- 4. the direct write is closed to the desk and to the public
  select case when not has_function_privilege('anon', 'public.record_message_delivery(text,text,text,text,text,text,text)', 'execute')
               and not has_function_privilege('authenticated', 'public.record_message_delivery(text,text,text,text,text,text,text)', 'execute')
               and not has_function_privilege('anon', 'public.mark_delivery_followed_up(text,text)', 'execute')
         then 'PASS' else 'FAIL' end into s;
  res := res || ('4. record_message_delivery is service only, follow-up closed to anonymous callers: ' || s);

  -- 5. nobody signed in cannot follow up
  perform set_config('request.jwt.claims', '{}', true);
  begin
    perform public.mark_delivery_followed_up('+447700900001', 'Rang them.');
    res := res || '5. only an admin can follow up: FAIL, it was recorded'::text;
  exception when others then
    res := res || ('5. only an admin can follow up: ' || case when sqlerrm ilike '%admin only%' then 'PASS' else 'FAIL, ' || sqlerrm end);
  end;

  if v_admin is null then
    res := res || 'SKIP 6 to 9, nobody on the admins list to act as'::text;
  else
    perform set_config('request.jwt.claims', json_build_object('email', v_admin, 'role', 'authenticated')::text, true);

    -- 6. a note too short to mean anything is refused
    begin
      perform public.mark_delivery_followed_up('+447700900001', 'ok');
      res := res || '6. a follow-up needs a real note: FAIL, it was recorded'::text;
    exception when others then
      res := res || ('6. a follow-up needs a real note: ' || case when sqlerrm ilike '%few words%' then 'PASS' else 'FAIL, ' || sqlerrm end);
    end;

    -- 7. it clears the failure, names the admin, and leaves the read message alone
    v_n := public.mark_delivery_followed_up('+44 7700 900001', 'Rang them, they messaged the Yaadly number.');
    select * into v_row from public.message_deliveries where message_sid = 'TEST-SM-1';
    res := res || ('7. follow-up names the admin and clears only the failure: '
      || case when v_n = 1 and v_row.followed_up_at is not null and v_row.followed_up_by = v_admin
               and (select followed_up_at is null from public.message_deliveries where message_sid = 'TEST-SM-2')
              then 'PASS' else 'FAIL, count ' || v_n end);

    -- 8. following up twice is refused rather than silently rewriting the record
    begin
      perform public.mark_delivery_followed_up('+447700900001', 'Again, just in case.');
      res := res || '8. a second follow-up is refused: FAIL, it was recorded'::text;
    exception when others then
      res := res || ('8. a second follow-up is refused: ' || case when sqlerrm ilike '%nothing to follow up%' then 'PASS' else 'FAIL, ' || sqlerrm end);
    end;

    -- 9. the desk's own record fills in a row the callback wrote first
    perform public.record_message_delivery('TEST-SM-3', '+447700900002', 'whatsapp', '', '', 'sent', '');
    perform public.record_desk_delivery('TEST-SM-3', 'whatsapp:+447700900002', 'whatsapp', 'desk_reply', 'JOB-TEST-2');
    select * into v_row from public.message_deliveries where message_sid = 'TEST-SM-3';
    res := res || ('9. a desk reply recorded after the callback keeps its kind: '
      || case when v_row.kind = 'desk_reply' and v_row.job_id = 'JOB-TEST-2' and v_row.status = 'sent' then 'PASS' else 'FAIL, ' || v_row.kind || '/' || v_row.status end);
  end if;

  -- 10. no row anywhere still reads sent while carrying an error code
  select case when not exists (select 1 from public.message_deliveries where error_code <> '' and status not in ('failed', 'undelivered'))
         then 'PASS' else 'FAIL' end into s;
  res := res || ('10. nothing with an error code reads as on its way: ' || s);

  raise exception E'RESULTS (all rolled back)\n%', array_to_string(res, E'\n');
end $$;
