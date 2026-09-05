-- Proof that "which parts of the job are on file" is answered from what was on
-- file at sign-off, and that the answer is a declaration rather than a guess.
-- Run against the project with execute_sql, or psql. Creates TEST-PHASE- rows
-- and removes them again.
--
-- WHAT IS BEING PROVED. terms.html promises the client a before photograph and
-- an after photograph on every stage. 20260905c added the column that records
-- which is which. Three things have to hold for that column to be worth
-- anything, and each is a test below:
--
--   1. It cannot hold a value nobody declared. 'maybe' is refused, and so is
--      any phase on materials evidence, which is its own section read off
--      kind and where the distinction has no meaning.
--   2. The approval snapshot carries it, so the measure reads what the named
--      human had in front of them.
--   3. Declaring a phase AFTER the sign-off does not improve the sign-off.
--      This is the same failure 20260904t exists to prevent, one column along:
--      a worker marking last week's photograph as the before, today, must not
--      make last week's approval look complete.

do $$
declare
  v_before boolean; v_after boolean; v_both boolean; v_during boolean;
  v_issues int;
  v_snapshot jsonb;
  v_refused boolean;
  v_items int;
begin
  create temp table t(n int generated always as identity, name text, result text) on commit drop;

  -- _do_approve_stage fires trg_raise_worker_pay_on_stage_approval, which
  -- swallows its own failures but does write an invoice when it can, so the
  -- rig clears those too rather than leaving money rows behind it.
  delete from public.invoice_lines where invoice_id in
    (select id from public.invoices where job_id like 'TEST-PHASE-%');
  delete from public.invoices where job_id like 'TEST-PHASE-%';
  delete from public.stage_approvals where job_id like 'TEST-PHASE-%';
  delete from public.evidence where job_id like 'TEST-PHASE-%';
  delete from public.jobs where id like 'TEST-PHASE-%';

  insert into public.jobs (id, title, client_email, stage) values
    ('TEST-PHASE-1','rig, the snapshot carries the phase', 'rig@example.invalid', 1),
    ('TEST-PHASE-2','rig, declared after the sign-off', null, 1),
    ('TEST-PHASE-3','rig, the constraint', null, 1);

  -- TEST-PHASE-3 gets a nominated materials store on purpose. Without one,
  -- trg_evidence_materials_needs_store refuses materials evidence first and
  -- also with errcode check_violation, so test 2 below would pass without the
  -- phase constraint existing at all: a check that never fires, which is the
  -- failure test 4 in signoff_snapshot_guards.sql exists to avoid.
  update public.jobs
     set materials_store_type = 'lockable', materials_store = 'the back room'
   where id = 'TEST-PHASE-3';

  -- ── 1. a phase is one of four words, or nothing ────────────────────────
  begin
    v_refused := false;
    insert into public.evidence (job_id, stage, label, kind, phase, sha256)
    values ('TEST-PHASE-3', 1, 'rig, invalid phase', 'work', 'maybe', repeat('a',64));
  exception when check_violation then
    v_refused := true;
  end;
  insert into t(name,result) values ('1. a phase that is not before or after is refused',
    case when v_refused then 'PASS' else 'FAIL, the row went in' end);

  -- Materials evidence is a custody record and its own section, read off kind.
  -- A phase on it would be counted by the measure and mean nothing. The store
  -- is nominated above so that this refusal can only be the phase constraint.
  begin
    v_refused := false;
    insert into public.evidence (job_id, stage, label, kind, phase, sha256)
    values ('TEST-PHASE-3', 1, 'rig, materials with a phase', 'materials', 'before', repeat('b',64));
  exception when check_violation then
    v_refused := true;
  end;
  insert into t(name,result) values ('2. materials evidence cannot carry a phase at all',
    case when v_refused then 'PASS' else 'FAIL, the row went in' end);

  -- Null is an honest third answer and must always be accepted.
  insert into public.evidence (job_id, stage, label, kind, phase, sha256)
  values ('TEST-PHASE-3', 1, 'rig, no phase declared', 'work', null, repeat('c',64));
  insert into t(name,result) values ('3. evidence with no phase declared still files',
    case when found then 'PASS' else 'FAIL' end);

  -- ── 2. the approval snapshot carries it ────────────────────────────────
  insert into public.evidence (job_id, stage, label, kind, phase, sha256) values
    ('TEST-PHASE-1', 1, 'the joint, untouched',      'work', 'before', repeat('d',64)),
    ('TEST-PHASE-1', 1, 'pipe cut back',             'work', 'during', repeat('e',64)),
    ('TEST-PHASE-1', 1, 'rot behind the panel',      'work', 'issue',  repeat('f',64)),
    ('TEST-PHASE-1', 1, 'second one, same wall',     'work', 'issue',  repeat('7',64)),
    ('TEST-PHASE-1', 1, 'the joint, remade',         'work', 'after',  repeat('8',64)),
    ('TEST-PHASE-1', 1, 'the van outside',           'work', null,     repeat('9',64));

  perform public._do_approve_stage('TEST-PHASE-1', 'rig@example.invalid', 'evidence');

  select evidence into v_snapshot from public.stage_approvals
   where job_id = 'TEST-PHASE-1' and stage = 1;
  insert into t(name,result) values ('4. the approval snapshot records each item''s phase',
    case when (select count(*) from jsonb_array_elements(v_snapshot) e
                where e ->> 'phase' in ('before','during','after','issue')) = 5
         then 'PASS' else 'FAIL, snapshot ' || coalesce(v_snapshot::text,'null') end);

  select has_before, has_after, before_and_after, has_during, issues, items
    into v_before, v_after, v_both, v_during, v_issues, v_items
    from public.evidence_at_signoff where job_id = 'TEST-PHASE-1' and stage = 1;
  insert into t(name,result) values ('5. the sign-off reports a before, an after and the pair',
    case when v_before and v_after and v_both and v_items = 6 then 'PASS'
         else 'FAIL, before '||v_before||' after '||v_after||' both '||v_both||' items '||v_items end);

  insert into t(name,result) values ('6. during is reported, and two problems are counted not flagged',
    case when v_during and v_issues = 2 then 'PASS'
         else 'FAIL, during '||v_during||' issues '||v_issues end);

  -- An issue must never stand in for a missing half of the pair, or a stage
  -- where the worker only ever photographed problems would read as complete.
  insert into public.jobs (id, title, client_email, stage)
  values ('TEST-PHASE-4','rig, issues only', 'rig@example.invalid', 1);
  insert into public.evidence (job_id, stage, label, kind, phase, sha256) values
    ('TEST-PHASE-4', 1, 'cracked lintel', 'work', 'issue', repeat('4',64)),
    ('TEST-PHASE-4', 1, 'and another',    'work', 'issue', repeat('5',64));
  perform public._do_approve_stage('TEST-PHASE-4', 'rig@example.invalid', 'evidence');
  select has_before, has_after, before_and_after, issues
    into v_before, v_after, v_both, v_issues
    from public.evidence_at_signoff where job_id = 'TEST-PHASE-4' and stage = 1;
  insert into t(name,result) values ('7. problems never stand in for a before or an after',
    case when v_before = false and v_after = false and v_both = false and v_issues = 2
         then 'PASS' else 'FAIL, before '||v_before||' after '||v_after||' issues '||v_issues end);

  -- ── 3. the one that matters ────────────────────────────────────────────
  --
  -- A sign-off whose snapshot declared nothing, followed by somebody marking
  -- the evidence row as the before afterwards. The sign-off must not move.
  insert into public.stage_approvals (job_id, stage, approved_by, approved_at, evidence, confirmed_method)
  values ('TEST-PHASE-2', 1, 'rig@example.invalid', now() - interval '1 hour',
    jsonb_build_array(
      jsonb_build_object('id','44444444-4444-4444-4444-444444444444','label','one','sha256', repeat('1',64), 'phase', null)
    ), 'whatsapp');

  insert into public.evidence (job_id, stage, label, kind, phase, sha256)
  values ('TEST-PHASE-2', 1, 'marked up a day late', 'work', 'before', repeat('2',64));

  select has_before, before_and_after into v_before, v_both
    from public.evidence_at_signoff where job_id = 'TEST-PHASE-2' and stage = 1;
  insert into t(name,result) values ('8. a phase declared AFTER the sign-off does not count towards it',
    case when v_before = false and v_both = false then 'PASS'
         else 'FAIL, before '||v_before||' both '||v_both end);

  -- An older snapshot, written before the column existed, has no phase key at
  -- all. It must read false rather than null, or every count filtering on it
  -- silently drops those rows instead of counting them as the gaps they are.
  update public.stage_approvals
     set evidence = jsonb_build_array(
           jsonb_build_object('id','55555555-5555-5555-5555-555555555555','label','one','sha256', repeat('3',64))
         )
   where job_id = 'TEST-PHASE-2' and stage = 1;
  select has_before, has_after, before_and_after into v_before, v_after, v_both
    from public.evidence_at_signoff where job_id = 'TEST-PHASE-2' and stage = 1;
  insert into t(name,result) values ('9. a snapshot written before the column existed reads false, not null',
    case when v_before is false and v_after is false and v_both is false then 'PASS'
         else 'FAIL, before '||coalesce(v_before::text,'null')||' both '||coalesce(v_both::text,'null') end);

  raise notice '%', (select string_agg(name || ': ' || result, E'\n' order by n) from t);

  -- _do_approve_stage fires trg_raise_worker_pay_on_stage_approval, which
  -- swallows its own failures but does write an invoice when it can, so the
  -- rig clears those too rather than leaving money rows behind it.
  delete from public.invoice_lines where invoice_id in
    (select id from public.invoices where job_id like 'TEST-PHASE-%');
  delete from public.invoices where job_id like 'TEST-PHASE-%';
  delete from public.stage_approvals where job_id like 'TEST-PHASE-%';
  delete from public.evidence where job_id like 'TEST-PHASE-%';
  delete from public.jobs where id like 'TEST-PHASE-%';
end $$;
