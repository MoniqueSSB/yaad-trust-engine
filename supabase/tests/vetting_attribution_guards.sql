-- Proof that a vetting decision cannot be recorded without saying who made it.
-- Run against the project with execute_sql, or psql. Creates TEST-VET- rows
-- and removes them again. All six passed on 5 September 2026.
--
-- WHAT IS BEING PROVED. Passing or blocking an application decides whether
-- somebody can earn on this platform, which is exactly the kind of step
-- CLAUDE.md section 2 says a named human confirms. It was confirmed by a named
-- human and there was no way to show that afterwards: the desk wrote
-- applications.status directly and nobody's name went with it.
--
-- Tests 1 to 3 are the guard. Test 3 matters more than it looks: 'approved'
-- and 'declined' are legacy spellings still present in the data, and a guard
-- listing only the three current words would be walked round by using an old
-- one. Test 4 exists so the guard cannot pass by refusing everything, which is
-- the easy way to look strict and break the desk. Test 6 asserts the eleven
-- historical rows are still NULL: backfilling a plausible name into the column
-- that exists to be trustworthy would be worse than leaving it empty.

do $$
declare v_id uuid; cnt int;
begin
  create temp table t(n int generated always as identity, name text, result text) on commit drop;
  delete from public.applications where app_id like 'TEST-VET-%';
  insert into public.applications (app_id, name, email, status)
  values ('TEST-VET-1','Rig Applicant','rig-vet@example.invalid','received') returning id into v_id;

  begin
    update public.applications set status='passed' where id=v_id;
    insert into t(name,result) values ('1. a direct pass with no name is refused','FAIL, it went through');
  exception when others then
    insert into t(name,result) values ('1. a direct pass with no name is refused',
      case when SQLERRM like '%has to say who made it%' then 'PASS' else 'FAIL, '||SQLERRM end);
  end;

  begin
    update public.applications set status='blocked', decided_by='system' where id=v_id;
    insert into t(name,result) values ('2. "system" is not a named human','FAIL, it went through');
  exception when others then
    insert into t(name,result) values ('2. "system" is not a named human',
      case when SQLERRM like '%not a named human%' then 'PASS' else 'FAIL, '||SQLERRM end);
  end;

  begin
    update public.applications set status='declined', decided_by='' where id=v_id;
    insert into t(name,result) values ('3. the legacy spelling is guarded too','FAIL, it went through');
  exception when others then
    insert into t(name,result) values ('3. the legacy spelling is guarded too',
      case when SQLERRM like '%has to say who made it%' then 'PASS' else 'FAIL, '||SQLERRM end);
  end;

  -- The guard must not refuse everything. An attributed decision writes, and an
  -- unrelated edit to an already-decided row is not a new decision.
  update public.applications set status='passed', decided_by='rig@example.invalid' where id=v_id;
  update public.applications set phone='+18765550000' where id=v_id;
  insert into t(name,result) values ('4. an attributed decision writes, and later edits are not blocked','PASS');

  select count(*) into cnt from public.desk_decisions where who='rig@example.invalid' and kind='vetting decision';
  insert into t(name,result) values ('5. it reaches desk_decisions as a vetting decision',
    case when cnt=1 then 'PASS' else 'FAIL, '||cnt end);

  select count(*) into cnt from public.applications
   where decided_by is null and status in ('approved','declined','passed') and app_id not like 'TEST-VET-%';
  insert into t(name,result) values ('6. history is left unattributed rather than invented',
    case when cnt > 0 then 'PASS, '||cnt||' rows honestly NULL' else 'CHECK, nothing historical found' end);

  create table if not exists public._vet_out (n int, name text, result text);
  delete from public._vet_out; insert into public._vet_out select n,name,result from t;
  delete from public.applications where app_id like 'TEST-VET-%';
end $$;
select name, result from public._vet_out order by n;
drop table public._vet_out;
