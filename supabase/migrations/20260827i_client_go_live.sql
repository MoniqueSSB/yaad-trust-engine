-- Applied 27 Aug 2026. Kept here so the invariant is in the repo, not only in
-- the database. See the comment on the function for why it exists.
create or replace function public.client_go_live()
returns table (job_id text)
language plpgsql
security definer
set search_path to 'public, auth'
as $function$
declare
  v_uid   uuid := auth.uid();
  v_email text;
  v_name  text;
begin
  if v_uid is null then
    raise exception 'Not signed in.' using errcode = '28000';
  end if;

  select lower(btrim(u.email)) into v_email
    from auth.users u
   where u.id = v_uid and u.email_confirmed_at is not null;

  if v_email is null or v_email = '' then
    raise exception 'Confirm your email address first.' using errcode = '28000';
  end if;

  select s.signer_name into v_name
    from public.doc_signatures s
   where s.doc_type = 'client_guidelines'
     and lower(s.signer_email) = v_email
     and (public.current_doc_version('client_guidelines') is null
          or s.doc_version = public.current_doc_version('client_guidelines'))
   order by s.signed_at desc nulls last
   limit 1;

  if v_name is null or btrim(v_name) = '' then
    raise exception 'Sign the current Client Guidelines first.'
      using errcode = 'check_violation';
  end if;

  insert into public.client_profiles (user_id, email, name, active)
  values (v_uid, v_email, v_name, true)
  on conflict (email) do update
     set user_id    = excluded.user_id,
         name       = excluded.name,
         active     = true,
         updated_at = now();

  return query
    update public.jobs j
       set open = true
     where lower(j.client_email) = v_email
       and j.open is false
       and j.status = 'awaiting_client_setup'
       and coalesce(j.worker_email, '') = ''
       and coalesce(j.stage, 0) = 0
    returning j.id;
end;
$function$;

revoke all on function public.client_go_live() from public;
grant execute on function public.client_go_live() to authenticated;
