-- yaad-post-job looks the client up after creating their account, so the
-- signature has an account to belong to. It did that with the admin API's
-- listUsers(), which returns the FIRST PAGE, fifty accounts, and nothing else.
--
-- That works for exactly as long as Yaadly has fewer than fifty auth users.
-- The fifty-first client signs, their account exists, their password is right,
-- their draft is theirs, and the lookup still comes back empty because they
-- are on page two. The endpoint answers "Could not attach your signature to an
-- account. Message Yaadly.", the signature is never written, and the job never
-- opens. Nothing in the code says why, which is the part that makes it a trap
-- rather than a bug: it would first bite on a good day, at the exact moment
-- clients started arriving faster than they were being read about.
--
-- Ask the database instead. It knows the answer without paging, and the
-- question is the one actually being asked: which account holds this email.
--
-- Only the service role may call it. auth.users is not a table any browser
-- role gets to interrogate by email, not even indirectly, and a security
-- definer function is a hole the moment it is granted more widely than the
-- one caller that needs it. Revoke from PUBLIC first: anon and authenticated
-- inherit the default PUBLIC grant, so revoking from them alone leaves the
-- function open and looks like it worked.
--
-- The out parameters are named user_id and confirmed_at rather than id and
-- email_confirmed_at because a SQL body cannot tell an out parameter from a
-- column of the same name, and would refuse the reference as ambiguous.
create or replace function public.auth_user_by_email(p_email text)
returns table (user_id uuid, confirmed_at timestamptz)
language sql
security definer
set search_path to 'public, auth'
as $$
  select u.id, u.email_confirmed_at
    from auth.users u
   where lower(btrim(u.email)) = lower(btrim(p_email))
   -- Emails are unique in practice, but a soft-deleted account can leave a
   -- second row wearing the same address. Oldest first so the answer is the
   -- same one every time rather than whatever the planner reaches first.
   order by u.created_at
   limit 1;
$$;

revoke execute on function public.auth_user_by_email(text) from public, anon, authenticated;
grant execute on function public.auth_user_by_email(text) to service_role;
