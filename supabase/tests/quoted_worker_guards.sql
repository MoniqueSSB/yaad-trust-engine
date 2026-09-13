-- Proof that a quoting worker reads the tender pack and not the job
-- (20260913225614). Run against the project with execute_sql, or psql.
-- Reads only, creates nothing. Checks 9 to 11 act as a real worker who has
-- quoted and is not booked, using a local setting that ends with this
-- statement, and print counts only, never a value.
do $$
declare
  t      text := E'\n';
  v      int;
  q      text;
  w_uid  uuid;
  w_mail text;
begin
  select qual into q from pg_policies
   where schemaname = 'public' and tablename = 'jobs' and policyname = 'workers can read their own jobs';
  t := t || '1. the worker read rule on jobs no longer opens through a quote: '
       || case when q is not null and q not ilike '%job_quotes%' then 'PASS' else 'FAIL' end || E'\n';

  select count(*) into v from pg_proc p
   where p.proname = 'my_quoted_jobs' and p.pronamespace = 'public'::regnamespace and p.prosecdef
     and not has_function_privilege('anon', p.oid, 'EXECUTE')
     and has_function_privilege('authenticated', p.oid, 'EXECUTE');
  t := t || '2. my_quoted_jobs exists, runs as owner, signed-in users only: '
       || case when v = 1 then 'PASS' else 'FAIL' end || E'\n';

  select count(*) into v from pg_proc p, unnest(p.proargnames) a(n)
   where p.proname = 'my_quoted_jobs' and p.pronamespace = 'public'::regnamespace
     and a.n in ('addr', 'access_contact', 'access_type', 'client_name', 'client_email', 'client_phone',
                 'client_user', 'portal_code', 'pay_method', 'pay_ref', 'owed', 'walk_link', 'walk_notes',
                 'walk_call_notes', 'review_notes', 'worker_email', 'worker_phone');
  t := t || '3. my_quoted_jobs returns no address, client, code, payment or walkthrough column: '
       || case when v = 0 then 'PASS' else 'FAIL, ' || v end || E'\n';

  select pg_get_functiondef(p.oid) into q from pg_proc p
   where p.proname = 'my_quoted_jobs' and p.pronamespace = 'public'::regnamespace;
  t := t || '4. the description it returns is the board''s scrubbed one: '
       || case when q ilike '%board_descr(j.descr%' then 'PASS' else 'FAIL' end || E'\n';

  select count(*) into v from public.jobs j
   where coalesce(btrim(j.client_email), '') = '' and public.job_open_for_quotes(j.id);
  t := t || '5. no job without a client email is open for quotes: '
       || case when v = 0 then 'PASS' else 'FAIL, ' || v end || E'\n';

  select count(*) into v from public.open_jobs oj join public.jobs j on j.id = oj.id
   where coalesce(btrim(j.client_email), '') = '';
  t := t || '6. the public board lists no job without a client email: '
       || case when v = 0 then 'PASS' else 'FAIL, ' || v end || E'\n';

  select count(*) into v from public.jobs j
   where public.job_client_email_matches(j.id, null) or public.job_client_email_matches(j.id, '');
  t := t || '7. no email matches no job, not even one with a blank client email: '
       || case when v = 0 then 'PASS' else 'FAIL, ' || v end || E'\n';

  select count(*) into v from pg_policies
   where (schemaname = 'public' and tablename = 'job_photos'
          and policyname = 'quoting worker sees the board photos of a job they quoted')
      or (schemaname = 'storage' and tablename = 'objects'
          and policyname = 'quoting worker reads board photo files of a job they quoted')
      or (schemaname = 'public' and tablename = 'quote_pack_drafts'
          and policyname = 'quoting worker reads the approved draft of a job they quoted');
  t := t || '8. the three tender pack read rules are in place: '
       || case when v = 3 then 'PASS' else 'FAIL, ' || v end || E'\n';

  select count(*) into v from pg_trigger
   where tgrelid = 'public.job_quotes'::regclass and tgname = 'trg_notify_worker_quote_not_selected' and tgenabled <> 'D';
  select pg_get_functiondef('public.notify_worker_quote_not_selected()'::regprocedure) into q;
  t := t || '8b. a declined quote tells its worker, by id and never by text (20260913225714): '
       || case when v = 1 and q ilike '%quote_not_selected%' and q ilike '%notify_trigger_secret()%' then 'PASS' else 'FAIL' end || E'\n';

  select q2.worker_user, q2.worker_email into w_uid, w_mail
    from public.job_quotes q2 join public.jobs j on j.id = q2.job_id
   where q2.worker_user is not null
     and coalesce(q2.worker_email, '') <> ''
     and lower(coalesce(j.worker_email, '')) <> lower(q2.worker_email)
     and lower(coalesce(j.client_email, '')) <> lower(q2.worker_email)
     and not exists (select 1 from public.admins a where lower(a.email) = lower(q2.worker_email))
   limit 1;

  if w_uid is null then
    t := t || '9 to 11. SKIP, no worker in this database has quoted without being booked' || E'\n';
  else
    perform set_config('request.jwt.claims',
      json_build_object('sub', w_uid, 'email', w_mail, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';

    select count(*) into v from public.jobs j
     where lower(coalesce(j.worker_email, '')) <> lower(w_mail)
       and lower(coalesce(j.client_email, '')) <> lower(w_mail);
    t := t || '9. a quoted-only worker reads no jobs row they are not booked on or the client of: '
         || case when v = 0 then 'PASS' else 'FAIL, ' || v end || E'\n';

    select count(*) into v from public.v_job_checks c
     where c.id in (select q3.job_id from public.job_quotes q3 where q3.worker_user = w_uid)
       and lower(coalesce(c.client_email, '')) <> lower(w_mail);
    t := t || '10. nor the client details on v_job_checks for a job they only quoted: '
         || case when v = 0 then 'PASS' else 'FAIL, ' || v end || E'\n';

    select count(*) into v from public.my_quoted_jobs();
    t := t || '11. my_quoted_jobs still gives them the jobs they quoted on: '
         || case when v >= 1 then 'PASS, ' || v else 'FAIL' end || E'\n';

    execute 'reset role';
  end if;

  raise notice '%', t;
end $$;
