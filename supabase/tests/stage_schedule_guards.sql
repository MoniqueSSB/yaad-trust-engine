-- Proof that the stage schedule guards hold (20260913222130). Run against the
-- project with execute_sql, or psql. Reads only; creates nothing.
--
-- The same verandah quote is asserted in web/tests/payment-stages.test.mjs,
-- so the database reader and the web reader cannot drift apart unnoticed.
do $$
declare
  t  text := E'\n';
  s  jsonb;
  v  int;
begin
  -- 1 to 3. the verandah quote reads as 30, 40, 30.
  s := public.parse_payment_stages(
    E'Materials on site: 30%: photo of the materials delivered\r\n'
    'Posts and rails fitted: 40%: photos of the new posts\r\n'
    'Painted and cleared: 30%: photos of the finish');
  t := t || '1. verandah reads as 3 stages: ' || case when jsonb_array_length(s) = 3 then 'PASS' else 'FAIL' end || E'\n';
  t := t || '2. stage 2 is "Posts and rails fitted": ' || case when s->1->>'stage' = 'Posts and rails fitted' then 'PASS' else 'FAIL, ' || coalesce(s->1->>'stage', 'null') end || E'\n';
  t := t || '3. percentages 30, 40, 30: ' || case when (s->0->>'proportion_percent')::numeric = 30 and (s->1->>'proportion_percent')::numeric = 40 and (s->2->>'proportion_percent')::numeric = 30 then 'PASS' else 'FAIL' end || E'\n';

  -- 4 to 7. what must be refused.
  t := t || '4. stages totalling 90 refused: ' || case when public.parse_payment_stages(E'A: 30%: x\nB: 60%: y') is null then 'PASS' else 'FAIL' end || E'\n';
  t := t || '5. a line without the shape refused: ' || case when public.parse_payment_stages(E'A: 50%: x\nthe rest when done') is null then 'PASS' else 'FAIL' end || E'\n';
  t := t || '6. a zero stage refused: ' || case when public.parse_payment_stages(E'A: 0%: x\nB: 100%: y') is null then 'PASS' else 'FAIL' end || E'\n';
  t := t || '7. nothing written reads as nothing: ' || case when public.parse_payment_stages('  ') is null then 'PASS' else 'FAIL' end || E'\n';

  -- 8. the proof may contain a colon.
  t := t || '8. a colon in the proof is kept: ' || case when public.parse_payment_stages('Whole job: 100%: photos: before and after')->0->>'evidence_note' = 'photos: before and after' then 'PASS' else 'FAIL' end || E'\n';

  -- 9. an unknown job has one stage.
  t := t || '9. no schedule means one stage: ' || case when public.job_final_stage_count('TEST-NOPE') = 1 then 'PASS' else 'FAIL' end || E'\n';

  -- 10 and 11. the triggers are in place.
  select count(*) into v from pg_trigger where tgname in ('trg_accepted_quote_writes_schedule', 'trg_quote_payment_stages_readable') and not tgisinternal;
  t := t || '10. both job_quotes triggers present: ' || case when v = 2 then 'PASS' else 'FAIL, ' || v end || E'\n';
  t := t || '11. the browser cannot write a schedule directly: '
       || case when not has_function_privilege('authenticated', 'public.write_stage_schedule_from_quote(uuid,text)', 'execute') then 'PASS' else 'FAIL' end || E'\n';

  -- 12. sync_job_status reads the shared stage count, not Kickoff Packs alone.
  t := t || '12. sync_job_status uses job_final_stage_count: '
       || case when position('job_final_stage_count' in pg_get_functiondef('public.sync_job_status()'::regprocedure)) > 0 then 'PASS' else 'FAIL' end || E'\n';

  raise notice '%', t;
end $$;
