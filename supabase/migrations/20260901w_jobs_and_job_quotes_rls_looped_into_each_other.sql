-- jobs' "workers can read their own jobs" policy checks job_quotes (a worker's own quote on
-- this job). job_quotes' "jq_select_client" policy checks jobs (a client's own email on this
-- job). Reading either table evaluates the other table's policy, which evaluates the first
-- table's policy again, forever. Postgres calls this out directly: infinite recursion detected
-- in policy for relation "jobs". Broke the whole Job Invoices view, and anything else reading
-- jobs as this shape of user.
--
-- is_admin() already relies on the fix for this shape: a security definer function reads
-- `admins` from inside other tables' policies without re-triggering RLS on it, because a
-- security definer function is evaluated as its owner, not the calling session. Doing the same
-- for job_quotes' read of `jobs` breaks the cycle without changing what either policy actually
-- decides.

create or replace function public.job_client_email_matches(p_job_id text, p_email text)
returns boolean
language sql
security definer
set search_path = 'public'
stable
as $function$
  select exists (
    select 1 from jobs j
    where j.id = p_job_id
      and lower(coalesce(j.client_email, '')) = lower(coalesce(p_email, ''))
  );
$function$;

revoke all on function public.job_client_email_matches(text, text) from public;
grant execute on function public.job_client_email_matches(text, text) to authenticated;

drop policy if exists jq_select_client on public.job_quotes;
create policy jq_select_client on public.job_quotes
for select
using (
  status = any (array['submitted', 'kickoff_requested', 'accepted'])
  and public.job_client_email_matches(job_id, auth.jwt() ->> 'email')
);
