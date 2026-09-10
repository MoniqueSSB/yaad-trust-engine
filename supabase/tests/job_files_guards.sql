-- Proof that the job_files guards hold (20260910120000). Run against the
-- project with execute_sql, or psql. Reads only, creates nothing.
--
-- The session running this has no JWT: job_party_side() must answer null for
-- every job, which is what makes every read and write policy refuse. The
-- side-specific happy paths (client adds under client/, worker under
-- worker/, uploader removes own, other side cannot) are exercised from a
-- real portal session; see RUNBOOK "Files on a job".
do $$
declare t text := E'\n'; v int; b record;
begin
  select * into b from storage.buckets where id = 'job-files';
  t := t || '1. job-files bucket exists and is private: '
       || case when found and b.public = false then 'PASS' else 'FAIL' end || E'\n';
  t := t || '2. bucket refuses video and HEIC: '
       || case when found and not ('video/mp4' = any(b.allowed_mime_types)) and not ('image/heic' = any(b.allowed_mime_types)) then 'PASS' else 'FAIL' end || E'\n';
  t := t || '3. bucket allows PDF: '
       || case when found and 'application/pdf' = any(b.allowed_mime_types) then 'PASS' else 'FAIL' end || E'\n';

  select count(*) into v from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'job_files' and c.relrowsecurity;
  t := t || '4. job_files has RLS on: ' || case when v = 1 then 'PASS' else 'FAIL' end || E'\n';

  select count(*) into v from pg_policies where tablename = 'job_files' and cmd = 'UPDATE';
  t := t || '5. no UPDATE policy, a changed document is a new row: ' || case when v = 0 then 'PASS' else 'FAIL' end || E'\n';

  t := t || '6. no session means no side on any job: '
       || case when (select count(*) from public.jobs j where public.job_party_side(j.id) is not null) = 0 then 'PASS' else 'FAIL' end || E'\n';

  select count(*) into v from pg_constraint where conrelid = 'public.job_files'::regclass and contype = 'c';
  t := t || '7. side, kind and bytes constraints present (3): ' || case when v >= 3 then 'PASS' else 'FAIL, ' || v end || E'\n';

  select count(*) into v from pg_policies where schemaname = 'storage' and tablename = 'objects'
   and policyname in ('job party uploads a file on their own side', 'job party reads the job''s files', 'job party removes an unreferenced upload of their own');
  t := t || '8. three storage policies on the bucket: ' || case when v = 3 then 'PASS' else 'FAIL, ' || v end || E'\n';

  select count(*) into v from public.v_job_files;
  t := t || '9. v_job_files answers, rows visible without a session: ' || v || ' (expect 0)' || E'\n';

  -- 10. nothing in the approval path reads job_files.
  select count(*) into v from pg_proc p
   where p.proname in ('sync_job_status', '_do_approve_stage', 'job_check_locked')
     and pg_get_functiondef(p.oid) ilike '%job_files%';
  t := t || '10. sync_job_status, _do_approve_stage, job_check_locked never read job_files: ' || case when v = 0 then 'PASS' else 'FAIL' end || E'\n';

  raise notice '%', t;
end $$;
