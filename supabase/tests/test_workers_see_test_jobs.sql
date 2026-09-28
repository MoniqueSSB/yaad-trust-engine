-- Proves 20260929010000: a test job is visible to a test worker and to
-- nobody else. Run AFTER the migration is applied, in the Supabase SQL
-- editor. Everything happens inside one transaction and is rolled back, so it
-- leaves nothing behind: JOB-DEMO-PHOTOS is marked as a test only for the
-- length of the check.
--
-- Expected: three rows.
--   visitor                        0
--   signed in, not a test worker   0
--   test worker                    1

begin;

update public.jobs set is_test = true where id = 'JOB-DEMO-PHOTOS';
create temp table _r(who text, sees int) on commit drop;
grant insert, select on _r to anon, authenticated;

set local role anon;
insert into _r select 'visitor', count(*) from public.open_jobs where id = 'JOB-DEMO-PHOTOS';
reset role;

set local request.jwt.claims = '{"email":"someone.real@nowhere.invalid","role":"authenticated"}';
set local role authenticated;
insert into _r select 'signed in, not a test worker', count(*) from public.open_jobs where id = 'JOB-DEMO-PHOTOS';
reset role;

set local request.jwt.claims = '{"email":"test.worker@yaadly.co.uk","role":"authenticated"}';
set local role authenticated;
insert into _r select 'test worker', count(*) from public.open_jobs where id = 'JOB-DEMO-PHOTOS';
reset role;

select * from _r;

rollback;
