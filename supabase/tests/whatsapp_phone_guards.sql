-- Proof that the WhatsApp money RPCs no longer treat two different numbers as
-- one person. Run against the project with execute_sql, or psql. It creates
-- TEST- rows and removes them again.
--
-- WHAT IS BEING PROVED. Four functions are reachable from yaad-inbound, which
-- runs with --no-verify-jwt, and between the open internet and each of them
-- stand exactly two things: Twilio's signature, and a match between the
-- sender's number and the number on the job. Until 4 September 2026 that
-- second check was the last nine digits of each, which drops the country code.
-- A UK number and a Jamaican number ending in the same nine digits satisfied
-- it. The sharpest case is approve_stage_via_whatsapp, which fires
-- raise_worker_pay_invoice_on_stage_approval.
--
-- HOW THE POSITIVE CASES ARE TESTED WITHOUT MOVING MONEY, which is the part
-- worth reading before changing this file. These functions delegate to _do_
-- functions that raise invoices, book workers and record agreements. A test
-- that let one succeed would leave real rows behind on a production database.
--
-- So the fixture is a job with NO quotes and NO pack. The right number then
-- gets PAST the phone check and fails at the next one, with a different
-- message. Two different refusals is the proof: one says the number is wrong,
-- the other says there is nothing to act on, and only a caller who passed the
-- phone gate can ever see the second. Nothing is ever allowed to succeed.
--
-- The one exception is the Kickoff Pack candidate query, which cannot be told
-- apart by message. Its positive direction is asserted against the predicate
-- itself, and is marked as such below rather than dressed up as more than it
-- is.

do $$
declare
  r text;
  v boolean;
  cnt int;
  -- The collision, and it is a real one. Both end 700900123.
  jm_real  text := '+18765700900123';   -- the number on the job
  uk_fake  text := '+447700900123';     -- a different person, different country
  jm_nocc  text := '8765700900123';     -- the same person, country code dropped
begin
  create temp table t(n int generated always as identity, name text, result text) on commit drop;

  delete from public.intake_threads where job_id like 'TEST-WA-%';
  delete from public.kickoff_packs where job_id like 'TEST-WA-%';
  delete from public.jobs where id like 'TEST-WA-%';

  insert into public.jobs (id, title, parish, client_name, client_email, client_phone, descr, status)
  values ('TEST-WA-1', 'Roof leak, test fixture', 'Kingston', 'Test Client',
          'test-wa@example.invalid', jm_real, 'Test fixture for the phone guards.', 'draft');

  -- ── the collision itself ───────────────────────────────────────────────

  insert into t(name,result) values ('1. the old rule really did collide here',
    case when right(regexp_replace(jm_real,'\D','','g'),9) = right(regexp_replace(uk_fake,'\D','','g'),9)
         then 'PASS, both end ' || right(regexp_replace(jm_real,'\D','','g'),9)
         else 'FAIL, the fixture no longer demonstrates the bug' end);

  select public.same_phone(jm_real, uk_fake) into v;
  insert into t(name,result) values ('2. same_phone refuses the collision',
    case when v = false then 'PASS' else 'FAIL, still one person' end);

  select public.same_phone(jm_real, jm_nocc) into v;
  insert into t(name,result) values ('3. same_phone still accepts a dropped country code',
    case when v = true then 'PASS' else 'FAIL, a real worker would be locked out' end);

  select public.same_phone(jm_real, jm_real) into v;
  insert into t(name,result) values ('4. same_phone accepts an exact match',
    case when v = true then 'PASS' else 'FAIL' end);

  select public.same_phone('8765551234', '8765559999') into v;
  insert into t(name,result) values ('5. a genuinely different number never matches',
    case when v = false then 'PASS' else 'FAIL' end);

  select public.same_phone('12345', '12345') into v;
  insert into t(name,result) values ('6. a fragment does not match, even itself',
    case when v = false then 'PASS' else 'FAIL' end);

  -- ── approve_stage_via_whatsapp, the one that raises a payable ──────────

  begin
    perform public.approve_stage_via_whatsapp('TEST-WA-1', uk_fake);
    insert into t(name,result) values ('7. approve_stage refuses the colliding number', 'FAIL, it was allowed in');
  exception when others then
    insert into t(name,result) values ('7. approve_stage refuses the colliding number',
      case when SQLERRM like '%not on record for this job%' then 'PASS, refused on the number'
           else 'FAIL, refused for another reason: ' || SQLERRM end);
  end;

  begin
    perform public.approve_stage_via_whatsapp('TEST-WA-1', jm_nocc);
    insert into t(name,result) values ('8. approve_stage lets the real client past the number check', 'FAIL, it succeeded and should not have');
  exception when others then
    insert into t(name,result) values ('8. approve_stage lets the real client past the number check',
      case when SQLERRM like '%not on record for this job%' then 'FAIL, the real client was refused on their number'
           else 'PASS, got past the number and stopped at the next check' end);
  end;

  -- ── choose_worker_via_whatsapp ─────────────────────────────────────────

  begin
    perform public.choose_worker_via_whatsapp('TEST-WA-1', uk_fake);
    insert into t(name,result) values ('9. choose_worker refuses the colliding number', 'FAIL, it was allowed in');
  exception when others then
    insert into t(name,result) values ('9. choose_worker refuses the colliding number',
      case when SQLERRM like '%not on record for this job%' then 'PASS, refused on the number'
           else 'FAIL, refused for another reason: ' || SQLERRM end);
  end;

  begin
    perform public.choose_worker_via_whatsapp('TEST-WA-1', jm_nocc);
    insert into t(name,result) values ('10. choose_worker lets the real client past the number check', 'FAIL, it booked somebody');
  exception when others then
    insert into t(name,result) values ('10. choose_worker lets the real client past the number check',
      case when SQLERRM like '%No price is open%' then 'PASS, got past the number and stopped at the next check'
           else 'FAIL, ' || SQLERRM end);
  end;

  -- ── agree_quote_via_whatsapp ───────────────────────────────────────────
  -- The two branches give different messages, which is what makes this
  -- testable: a caller whose number does not match the client falls through to
  -- the worker branch and is told nothing is waiting on THEIR confirmation.

  begin
    perform public.agree_quote_via_whatsapp('TEST-WA-1', uk_fake);
    insert into t(name,result) values ('11. agree_quote does not treat the colliding number as the client', 'FAIL, it was allowed in');
  exception when others then
    insert into t(name,result) values ('11. agree_quote does not treat the colliding number as the client',
      case when SQLERRM like '%waiting on your confirmation%' then 'PASS, fell through to the worker branch and found nothing'
           else 'FAIL, ' || SQLERRM end);
  end;

  begin
    perform public.agree_quote_via_whatsapp('TEST-WA-1', jm_nocc);
    insert into t(name,result) values ('12. agree_quote recognises the real client', 'FAIL, it agreed something');
  exception when others then
    insert into t(name,result) values ('12. agree_quote recognises the real client',
      case when SQLERRM like '%No open price on this job to confirm%' then 'PASS, took the client branch and stopped at the next check'
           else 'FAIL, ' || SQLERRM end);
  end;

  -- ── agree_kickoff_pack_via_whatsapp ────────────────────────────────────
  -- Both branches raise the same sentence, so the message cannot separate
  -- them. The negative direction, which is the security property that
  -- changed, is still tested through the real function. The positive
  -- direction is asserted against the candidate predicate itself, and is
  -- labelled so nobody reads more into it than it says.

  -- project_title and intake are NOT NULL with no default, and
  -- kickoff_guard_approval() refuses an approved pack whose payment stages do
  -- not total exactly 100 percent, and kickoff_approval_attributed refuses one
  -- that does not name who approved it. All three found by running this, which
  -- is the rig earning its keep before it proves anything it was written for:
  -- the fixture was refused twice by guards nobody had told it about, and the
  -- second refusal is the governing rule of this whole project (a named human
  -- confirms every consequential step) enforced in Postgres rather than in a
  -- prompt.
  insert into public.kickoff_packs (id, job_id, project_title, intake, status, rev, docs, approved_by, approved_at)
  values ('TEST-WA-PACK-1', 'TEST-WA-1', 'Roof leak, test fixture', '{}'::jsonb, 'approved', 1,
          '{"payment_schedule": {"stages": [{"stage": "Complete", "proportion_percent": 100}]}}'::jsonb,
          'test-rig@example.invalid', now());

  begin
    perform public.agree_kickoff_pack_via_whatsapp('TEST-WA-1', uk_fake);
    insert into t(name,result) values ('13. agree_kickoff_pack refuses the colliding number', 'FAIL, it agreed the pack');
  exception when others then
    insert into t(name,result) values ('13. agree_kickoff_pack refuses the colliding number',
      case when SQLERRM like '%waiting on your confirmation%' then 'PASS, no candidate found for that number'
           else 'FAIL, ' || SQLERRM end);
  end;

  select count(*) into cnt
    from public.kickoff_packs p
    join public.jobs j on j.id = p.job_id
   where p.job_id = 'TEST-WA-1' and p.status = 'approved'
     and public.same_phone(j.client_phone, jm_nocc);
  insert into t(name,result) values ('14. the client candidate query (predicate only) finds the real client',
    case when cnt = 1 then 'PASS' else 'FAIL, found ' || cnt end);

  select count(*) into cnt
    from public.kickoff_packs p
    join public.jobs j on j.id = p.job_id
   where p.job_id = 'TEST-WA-1' and p.status = 'approved'
     and public.same_phone(j.client_phone, uk_fake);
  insert into t(name,result) values ('15. the client candidate query (predicate only) refuses the collision',
    case when cnt = 0 then 'PASS' else 'FAIL, found ' || cnt end);

  -- ── nothing was left behind ────────────────────────────────────────────

  select count(*) into cnt from public.quote_agreements qa
    join public.job_quotes q on q.id = qa.quote_id where q.job_id = 'TEST-WA-1';
  insert into t(name,result) values ('16. no agreement was recorded by any of the above',
    case when cnt = 0 then 'PASS' else 'FAIL, ' || cnt || ' rows' end);

  select count(*) into cnt from public.invoices where job_id = 'TEST-WA-1';
  insert into t(name,result) values ('17. no invoice was raised by any of the above',
    case when cnt = 0 then 'PASS' else 'FAIL, ' || cnt || ' rows' end);

  create table if not exists public._wa_phone_test_out (n int, name text, result text);
  delete from public._wa_phone_test_out;
  insert into public._wa_phone_test_out select n,name,result from t;

  delete from public.kickoff_pack_agreements where pack_id like 'TEST-WA-%';
  delete from public.kickoff_packs where job_id like 'TEST-WA-%';
  delete from public.intake_threads where job_id like 'TEST-WA-%';
  delete from public.jobs where id like 'TEST-WA-%';
end $$;
select name, result from public._wa_phone_test_out order by n;
drop table public._wa_phone_test_out;
