-- Proof that desk capacity counts evenings the way a night owl works them, and
-- counts only decisions a person actually made. Run against the project with
-- execute_sql, or psql. Creates TEST-CAP- rows and removes them again. All
-- five passed on 4 September 2026.
--
-- TWO DESIGN CLAIMS, both of which are wrong in a plausible-looking way if
-- nobody checks them.
--
-- The first is the 05:00 roll-over. Grouping decisions by the plain Jamaica
-- date splits a normal evening in half at midnight and reports two thin
-- sessions where there was one real one, which halves the capacity figure
-- while looking perfectly reasonable. Tests 1 to 3 pin the boundary.
--
-- The second is what counts as a decision. kickoff_packs and quote_pack_drafts
-- carry an approved_by that reads 'system: auto-issued, guardrail-clean', and
-- on 4 September 2026 there were 314 such rows against 11 real ones. Counting
-- them would report a desk getting through hundreds of items an evening.
-- Tests 4 and 5 are the guard, and they matter more than the rest: the failure
-- they prevent is a number that is wrong in the direction that flatters.

do $$
declare cnt int; v_sessions int; v_dec int;
begin
  create temp table t(n int generated always as identity, name text, result text) on commit drop;

  delete from public.stage_approvals where job_id like 'TEST-CAP-%';
  delete from public.jobs where id like 'TEST-CAP-%';
  insert into public.jobs (id, title) values ('TEST-CAP-1','rig, capacity');

  -- Two decisions either side of midnight Jamaica time. Same evening.
  insert into public.stage_approvals (job_id, stage, approved_by, approved_at, evidence, confirmed_method)
  values ('TEST-CAP-1', 1, 'rig.person@example.invalid',
          (date '2026-08-20' + time '23:10') at time zone 'America/Jamaica', '[]'::jsonb, 'whatsapp'),
         ('TEST-CAP-1', 2, 'rig.person@example.invalid',
          (date '2026-08-21' + time '00:40') at time zone 'America/Jamaica', '[]'::jsonb, 'whatsapp');

  select count(*), sum(decisions) into v_sessions, v_dec from public.desk_sessions
   where who = 'rig.person@example.invalid';
  insert into t(name,result) values ('1. 23:10 and 00:40 are ONE evening, not two',
    case when v_sessions = 1 and v_dec = 2 then 'PASS' else 'FAIL, '||v_sessions||' sessions holding '||v_dec end);

  -- 04:50 still belongs to the night before; 05:10 starts a new one.
  insert into public.stage_approvals (job_id, stage, approved_by, approved_at, evidence, confirmed_method)
  values ('TEST-CAP-1', 3, 'rig.person@example.invalid',
          (date '2026-08-21' + time '04:50') at time zone 'America/Jamaica', '[]'::jsonb, 'whatsapp');
  select count(*) into v_sessions from public.desk_sessions where who = 'rig.person@example.invalid';
  insert into t(name,result) values ('2. 04:50 is still the same evening',
    case when v_sessions = 1 then 'PASS' else 'FAIL, '||v_sessions||' sessions' end);

  insert into public.stage_approvals (job_id, stage, approved_by, approved_at, evidence, confirmed_method)
  values ('TEST-CAP-1', 4, 'rig.person@example.invalid',
          (date '2026-08-21' + time '05:10') at time zone 'America/Jamaica', '[]'::jsonb, 'whatsapp');
  select count(*) into v_sessions from public.desk_sessions where who = 'rig.person@example.invalid';
  insert into t(name,result) values ('3. 05:10 starts a new evening',
    case when v_sessions = 2 then 'PASS' else 'FAIL, '||v_sessions||' sessions' end);

  -- The one that matters most: an auto-issued row is not a decision.
  insert into public.stage_approvals (job_id, stage, approved_by, approved_at, evidence, confirmed_method)
  values ('TEST-CAP-1', 5, 'system: auto-issued, guardrail-clean',
          (date '2026-08-21' + time '23:00') at time zone 'America/Jamaica', '[]'::jsonb, 'whatsapp');
  select count(*) into cnt from public.desk_decisions where job_id = 'TEST-CAP-1';
  insert into t(name,result) values ('4. a system: row is not counted as somebody deciding',
    case when cnt = 4 then 'PASS' else 'FAIL, counted '||cnt end);

  -- And an empty approver is not a named human either.
  insert into public.stage_approvals (job_id, stage, approved_by, approved_at, evidence, confirmed_method)
  values ('TEST-CAP-1', 6, '', (date '2026-08-21' + time '23:30') at time zone 'America/Jamaica', '[]'::jsonb, 'whatsapp');
  select count(*) into cnt from public.desk_decisions where job_id = 'TEST-CAP-1';
  insert into t(name,result) values ('5. a blank approver is not counted either',
    case when cnt = 4 then 'PASS' else 'FAIL, counted '||cnt end);

  create table if not exists public._cap_out (n int, name text, result text);
  delete from public._cap_out;
  insert into public._cap_out select n,name,result from t;

  delete from public.stage_approvals where job_id like 'TEST-CAP-%';
  delete from public.jobs where id like 'TEST-CAP-%';
end $$;
select name, result from public._cap_out order by n;
drop table public._cap_out;
