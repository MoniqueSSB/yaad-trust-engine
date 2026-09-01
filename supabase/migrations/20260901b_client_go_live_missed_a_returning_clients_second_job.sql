-- client_go_live() matched only status = 'awaiting_client_setup', the status
-- a first-time client's job carries while nobody has signed anything yet.
-- sync_job_status() (20260826_yaad_match onward) gives a DIFFERENT meaning
-- to 'draft' for a client who is already cleared (has a current Client
-- Guidelines signature and an active profile): "not yet open", not "still
-- being written". A returning client's second job reaches exactly that
-- state the instant claim_code_as_me() binds its client_email, because the
-- trigger sees client_cleared_for_golive() = true immediately and sets
-- 'draft', never 'awaiting_client_setup'. client_go_live() then never finds
-- it: the job sits correct by every rule, cleared client, no worker, stage
-- 0, and permanently invisible, with the existing "stuck job" recovery
-- button (web/app/portal/golive-actions.ts) unable to reach it either, same
-- status mismatch.
--
-- Found live, 1 Sep 2026, testing a second real WhatsApp job on a number
-- that had already gone through the whole flow once that same session.
--
-- Fix: match both statuses a not-yet-open, cleared-client job can honestly
-- carry. Every other condition in the WHERE clause is unchanged.
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
       and j.status in ('awaiting_client_setup', 'draft')
       and coalesce(j.worker_email, '') = ''
       and coalesce(j.stage, 0) = 0
    returning j.id;
end;
$function$;

revoke all on function public.client_go_live() from public, anon;
grant execute on function public.client_go_live() to authenticated;
