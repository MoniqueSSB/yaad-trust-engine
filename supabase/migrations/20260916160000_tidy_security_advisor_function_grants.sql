-- Tidy the Supabase security advisor, 16 September 2026, on Monique's word.
--
-- Nothing here changes what anybody can do today. It removes permissions
-- that were never used, so a future mistake inside one of these functions
-- has a second lock behind it. What is deliberately left alone, and why, is
-- in DECISIONS.md under the same date.
--
-- 1. Trigger functions. A function that returns `trigger` cannot be called
--    through the API, and Postgres only checks EXECUTE on it when a trigger
--    is created, never when it fires. The grant to the public roles is
--    leftover default, not a door anybody uses. Removing it changes nothing
--    about when or how the triggers run.
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prosecdef
       and p.prorettype = 'trigger'::regtype
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;

-- 2. Desk and client actions that already refuse anybody not signed in.
--    Each opens with an is_admin() check or a signed-in email check and
--    raises otherwise, so the anon grant could only ever reach an error.
--    Signed-in users and the service role keep their own explicit grants.
revoke execute on function public.attach_job_to_thread(text, text)               from public, anon;
revoke execute on function public.issue_report(uuid)                             from public, anon;
revoke execute on function public.mark_enquiry_replied(uuid)                     from public, anon;
revoke execute on function public.mark_enquiry_test(uuid)                        from public, anon;
revoke execute on function public.mark_material_supplied(uuid, boolean)          from public, anon;
revoke execute on function public.mark_thread_test(text, text)                   from public, anon;
revoke execute on function public.raise_job_materials_invoice(text)              from public, anon;
revoke execute on function public.raise_job_worker_payable(text)                 from public, anon;
revoke execute on function public.rate_finding(uuid, integer, text)              from public, anon;
revoke execute on function public.request_kickoff_as_me(uuid)                    from public, anon;
revoke execute on function public.retag_evidence(uuid, text, text)               from public, anon;
revoke execute on function public.write_report_verdict(uuid, text, text)         from public, anon;

grant execute on function public.attach_job_to_thread(text, text)                to authenticated, service_role;
grant execute on function public.issue_report(uuid)                              to authenticated, service_role;
grant execute on function public.mark_enquiry_replied(uuid)                      to authenticated, service_role;
grant execute on function public.mark_enquiry_test(uuid)                         to authenticated, service_role;
grant execute on function public.mark_material_supplied(uuid, boolean)           to authenticated, service_role;
grant execute on function public.mark_thread_test(text, text)                    to authenticated, service_role;
grant execute on function public.raise_job_materials_invoice(text)               to authenticated, service_role;
grant execute on function public.raise_job_worker_payable(text)                  to authenticated, service_role;
grant execute on function public.rate_finding(uuid, integer, text)               to authenticated, service_role;
grant execute on function public.request_kickoff_as_me(uuid)                     to authenticated, service_role;
grant execute on function public.retag_evidence(uuid, text, text)                to authenticated, service_role;
grant execute on function public.write_report_verdict(uuid, text, text)          to authenticated, service_role;

-- 3. board_descr strips contact details out of a job description before it
--    reaches the public job board. It touches no tables, only built in text
--    functions, which always resolve from pg_catalog, so an empty search
--    path is safe and stops it ever resolving a look-alike object.
alter function public.board_descr(text, text, text, text) set search_path = '';
