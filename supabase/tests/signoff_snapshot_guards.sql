-- Proof that evidence completeness at sign-off cannot be improved after the
-- sign-off. Run against the project with execute_sql, or psql. Creates
-- TEST-SIGNOFF- rows and removes them again. All five passed on 4 September
-- 2026.
--
-- WHAT IS BEING PROVED, and why it is worth a rig rather than a comment. The
-- whole value of this measure is that it describes what the named human had in
-- front of them at the moment they decided. The obvious implementation counts
-- rows in public.evidence for the job, and that version quietly goes up when a
-- worker files a photograph the day after the approval. It would read as a
-- completeness measure and behave as a "what turned up eventually" measure,
-- which is worse than no measure because nobody would know to distrust it.
--
-- evidence_at_signoff reads the stage_approvals.evidence snapshot instead.
-- Tests 2 and 3 are the ones that matter: they file evidence and an arrival
-- AFTER the approval and assert that neither moves the row.

do $$
declare
  cnt int; v_items int; v_fp int; v_arr boolean; v_loc boolean;
  before_items int; before_arr boolean;
begin
  create temp table t(n int generated always as identity, name text, result text) on commit drop;

  delete from public.stage_approvals where job_id like 'TEST-SIGNOFF-%';
  delete from public.arrival_log where job_id like 'TEST-SIGNOFF-%';
  delete from public.work_log_pins where job_id like 'TEST-SIGNOFF-%';
  delete from public.evidence where job_id like 'TEST-SIGNOFF-%';
  delete from public.jobs where id like 'TEST-SIGNOFF-%';

  -- stage_approvals has a foreign key to jobs, so the jobs come first. Only
  -- the not-null columns are set; everything else takes its default.
  insert into public.jobs (id, title) values
    ('TEST-SIGNOFF-1','rig, snapshot is read'),
    ('TEST-SIGNOFF-2','rig, arrival before'),
    ('TEST-SIGNOFF-3','rig, older empty shape');

  -- A sign-off with two items, one of them fingerprinted, approved an hour ago.
  insert into public.stage_approvals (job_id, stage, approved_by, approved_at, evidence, confirmed_method)
  values ('TEST-SIGNOFF-1', 1, 'rig@example.invalid', now() - interval '1 hour',
    jsonb_build_array(
      jsonb_build_object('id','11111111-1111-1111-1111-111111111111','label','before', 'sha256', repeat('a',64)),
      jsonb_build_object('id','22222222-2222-2222-2222-222222222222','label','after',  'sha256', null)
    ), 'whatsapp');

  select items, fingerprinted, arrival_logged into v_items, v_fp, v_arr
    from public.evidence_at_signoff where job_id='TEST-SIGNOFF-1' and stage=1;
  insert into t(name,result) values ('1. the snapshot is read, items and fingerprints counted',
    case when v_items = 2 and v_fp = 1 and v_arr = false then 'PASS'
         else 'FAIL, items '||v_items||' fingerprinted '||v_fp end);

  -- ── the two that matter ────────────────────────────────────────────────
  before_items := v_items;
  insert into public.evidence (job_id, stage, label, kind, sha256)
  values ('TEST-SIGNOFF-1', 1, 'filed a day late', 'work', repeat('b',64));
  select items into v_items from public.evidence_at_signoff where job_id='TEST-SIGNOFF-1' and stage=1;
  insert into t(name,result) values ('2. evidence filed AFTER the sign-off does not count towards it',
    case when v_items = before_items then 'PASS' else 'FAIL, went from '||before_items||' to '||v_items end);

  insert into public.arrival_log (job_id, stage, arrived_by, arrived_at, arrived_on, lat, lon)
  values ('TEST-SIGNOFF-1', 1, 'rig@example.invalid', now(), (now() at time zone 'America/Jamaica')::date, 17.99, -76.79);
  select arrival_logged, located into v_arr, v_loc
    from public.evidence_at_signoff where job_id='TEST-SIGNOFF-1' and stage=1;
  insert into t(name,result) values ('3. an arrival logged AFTER the sign-off does not count towards it',
    case when v_arr = false and v_loc = false then 'PASS' else 'FAIL, arrival '||v_arr||' located '||v_loc end);

  -- An arrival that genuinely preceded the approval must count, or test 3
  -- would pass for the wrong reason: a check that never fires.
  insert into public.stage_approvals (job_id, stage, approved_by, approved_at, evidence, confirmed_method)
  values ('TEST-SIGNOFF-2', 1, 'rig@example.invalid', now(), jsonb_build_array(
    jsonb_build_object('id','33333333-3333-3333-3333-333333333333','label','one','sha256', repeat('c',64))
  ), 'whatsapp');
  insert into public.arrival_log (job_id, stage, arrived_by, arrived_at, arrived_on, lat, lon)
  values ('TEST-SIGNOFF-2', 1, 'rig@example.invalid', now() - interval '3 hours',
          (now() at time zone 'America/Jamaica')::date, 17.99, -76.79);
  select arrival_logged, located into v_arr, v_loc
    from public.evidence_at_signoff where job_id='TEST-SIGNOFF-2' and stage=1;
  insert into t(name,result) values ('4. an arrival BEFORE the sign-off does count, so test 3 is not vacuous',
    case when v_arr = true and v_loc = true then 'PASS' else 'FAIL, arrival '||v_arr||' located '||v_loc end);

  -- The older desk shape wrote {} rather than an array. It means no evidence,
  -- and it must not raise.
  insert into public.stage_approvals (job_id, stage, approved_by, approved_at, evidence, confirmed_method)
  values ('TEST-SIGNOFF-3', 1, 'rig@example.invalid', now(), '{}'::jsonb, 'evidence');
  select items, fingerprinted into v_items, v_fp
    from public.evidence_at_signoff where job_id='TEST-SIGNOFF-3' and stage=1;
  insert into t(name,result) values ('5. the older {} snapshot shape counts as zero and does not raise',
    case when v_items = 0 and v_fp = 0 then 'PASS' else 'FAIL, items '||v_items end);

  create table if not exists public._signoff_out (n int, name text, result text);
  delete from public._signoff_out;
  insert into public._signoff_out select n,name,result from t;

  delete from public.stage_approvals where job_id like 'TEST-SIGNOFF-%';
  delete from public.arrival_log where job_id like 'TEST-SIGNOFF-%';
  delete from public.work_log_pins where job_id like 'TEST-SIGNOFF-%';
  delete from public.evidence where job_id like 'TEST-SIGNOFF-%';
  delete from public.jobs where id like 'TEST-SIGNOFF-%';
end $$;
select name, result from public._signoff_out order by n;
drop table public._signoff_out;
