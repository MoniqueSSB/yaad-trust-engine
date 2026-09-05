-- Proof that the materials reconciliation views show money that actually left
-- the account and nothing else. Run against the project with execute_sql, or
-- psql. Creates TEST-MAT- rows and removes them again.
--
-- THE FAILURE THESE PREVENT is a report that flatters. The whole point of
-- materials_open_releases is that it is uncomfortable to read: it is the list
-- of tranches where Yaadly's money went out and nothing yet shows what it
-- bought. Two plausible-looking mistakes would each quietly empty it.
--
-- The first is counting a planned tranche as paid. materials_releases.released_at
-- is nullable, so a row can exist before any money moves. Including those would
-- fill the report with rows that are not a risk and train the reader to ignore
-- it. Test 2.
--
-- The second is the opposite and worse: treating an empty-string receipt_ref as
-- a filed receipt. receipt_ref is `not null default ''`, so every unreceipted
-- row carries '' rather than NULL, and a null check alone would report a clean
-- book while the money is unaccounted for. That is wrong in the direction that
-- flatters, which is the direction that matters. Tests 1 and 3.
--
-- Test 4 pins the roll-up arithmetic, and test 5 pins the thing the founder
-- actually asked for: a job where money is out and nothing is filed has to be
-- visible as a number, not inferred by reading rows.

do $$
declare
  v_open int; v_days int; v_paid numeric; v_open_jmd numeric; v_receipted numeric;
begin
  create temp table t(n int generated always as identity, name text, result text) on commit drop;

  delete from public.materials_releases where job_id like 'TEST-MAT-%';
  delete from public.jobs where id like 'TEST-MAT-%';

  -- A store has to be nominated or the release trigger refuses the insert,
  -- which is itself the guard from 20260828c and is not what is under test here.
  insert into public.jobs (id, title, materials_store, materials_store_type,
                           materials_store_set_at, materials_store_set_by)
  values ('TEST-MAT-1', 'rig, materials reconciliation',
          'Rig store, back room', 'lockable', now(), 'rig@example.invalid');

  -- Paid eight days ago, no receipt. This is the row that must show.
  insert into public.materials_releases (job_id, stage, amount_jmd, receipt_ref, released_at, released_by)
  values ('TEST-MAT-1', 1, 40000, '', now() - interval '8 days', 'rig@example.invalid');

  -- Paid, receipt filed. Money accounted for, must NOT show as open.
  insert into public.materials_releases (job_id, stage, amount_jmd, receipt_ref, released_at, released_by)
  values ('TEST-MAT-1', 2, 25000, 'HW-4471', now() - interval '6 days', 'rig@example.invalid');

  -- Planned, never released. Not a risk, must NOT show at all.
  insert into public.materials_releases (job_id, stage, amount_jmd, receipt_ref, released_at, released_by)
  values ('TEST-MAT-1', 3, 90000, '', null, '');

  select count(*), max(days_outstanding) into v_open, v_days
    from public.materials_open_releases where job_id = 'TEST-MAT-1';

  insert into t(name,result) values ('1. Empty-string receipt_ref counts as UNRECEIPTED, not filed',
    case when v_open = 1 then 'PASS' else 'FAIL, '||v_open||' open rows, expected 1' end);

  insert into t(name,result) values ('2. A tranche with released_at null is not reported as money out',
    case when not exists (select 1 from public.materials_open_releases
                           where job_id = 'TEST-MAT-1' and amount_jmd = 90000)
         then 'PASS' else 'FAIL, a planned tranche is being counted as paid' end);

  insert into t(name,result) values ('3. A receipted tranche drops off the open list',
    case when not exists (select 1 from public.materials_open_releases
                           where job_id = 'TEST-MAT-1' and amount_jmd = 25000)
         then 'PASS' else 'FAIL, a receipted tranche is still showing as open' end);

  insert into t(name,result) values ('4. days_outstanding measures from released_at',
    case when v_days = 8 then 'PASS' else 'FAIL, got '||coalesce(v_days::text,'null')||', expected 8' end);

  select paid_jmd, open_jmd, receipted_jmd into v_paid, v_open_jmd, v_receipted
    from public.materials_reconciliation where job_id = 'TEST-MAT-1';

  insert into t(name,result) values ('5. Roll-up: paid 65000, of which 40000 is unaccounted for',
    case when v_paid = 65000 and v_open_jmd = 40000 and v_receipted = 25000
         then 'PASS'
         else 'FAIL, paid '||coalesce(v_paid::text,'null')
              ||' open '||coalesce(v_open_jmd::text,'null')
              ||' receipted '||coalesce(v_receipted::text,'null') end);

  create table if not exists public._mat_out (n int, name text, result text);
  delete from public._mat_out;
  insert into public._mat_out select n,name,result from t;

  delete from public.materials_releases where job_id like 'TEST-MAT-%';
  delete from public.jobs where id like 'TEST-MAT-%';
end $$;
select name, result from public._mat_out order by n;
drop table public._mat_out;
