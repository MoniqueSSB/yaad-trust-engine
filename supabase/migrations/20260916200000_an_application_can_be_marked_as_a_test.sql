-- An application can be marked as a test, 16 September 2026, on Monique's word.
--
-- Every application on the desk that day was her own or Claude's test, and the
-- Applications list had no way to say so, unlike jobs, workers, conversations
-- and enquiries. They were cleared in SQL by setting status to 'test'. This
-- gives the desk a button that does the same thing and a button that undoes it.
--
-- Marking a test is not a vetting decision. It never passes, gaps or blocks
-- anybody, and it cannot be used to skip one: "This one is real" puts a test
-- that had been decided back into the waiting queue as 'submitted', so a named
-- person decides it again. A status that was not a decision (started,
-- received, submitted, reviewing) comes back exactly as it was.

alter table public.applications
  add column if not exists status_before_test text;

comment on column public.applications.status_before_test is
  'What status was when a person marked this application as a test. Cleared when it is marked real again.';

create or replace function public.mark_application_test(p_id uuid, p_is_test boolean default true)
returns public.applications
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  decided constant text[] := array['passed','blocked','gap','approved','declined'];
  v_admin text := nullif(btrim(lower(auth.jwt() ->> 'email')), '');
  v_old   public.applications;
  v_row   public.applications;
  v_back  text;
begin
  if not public.is_admin() then
    raise exception 'Only a signed-in admin can mark an application as a test.';
  end if;
  if v_admin is null then
    raise exception 'No signed-in person to attribute this to.';
  end if;

  select * into v_old from public.applications where id = p_id for update;
  if v_old.id is null then
    raise exception 'There is no application with that id.';
  end if;

  if p_is_test then
    if v_old.status = 'test' then
      raise exception 'That application is already marked as a test.';
    end if;
    update public.applications
       set status_before_test = v_old.status, status = 'test'
     where id = p_id
     returning * into v_row;
  else
    if coalesce(v_old.status, '') <> 'test' then
      raise exception 'That application is not marked as a test.';
    end if;
    v_back := case
      when v_old.status_before_test is null then 'submitted'
      when v_old.status_before_test = any (decided) then 'submitted'
      else v_old.status_before_test
    end;
    update public.applications
       set status = v_back, status_before_test = null
     where id = p_id
     returning * into v_row;
  end if;

  insert into public.agent_actions (actor, actor_kind, action, summary, refs)
  values (v_admin, 'human',
          case when p_is_test then 'mark_application_test' else 'unmark_application_test' end,
          case when p_is_test
               then 'Marked application ' || coalesce(v_old.app_id, p_id::text) || ' (' || coalesce(nullif(btrim(v_old.name), ''), 'no name') || ') as a test. Its status was ' || coalesce(v_old.status, 'none') || '.'
               else 'Marked application ' || coalesce(v_old.app_id, p_id::text) || ' (' || coalesce(nullif(btrim(v_old.name), ''), 'no name') || ') as real. Its status is now ' || v_back || '.' end,
          jsonb_build_object('applications', p_id, 'is_test', p_is_test, 'was', v_old.status));

  return v_row;
end;
$function$;

revoke execute on function public.mark_application_test(uuid, boolean) from public, anon;
grant  execute on function public.mark_application_test(uuid, boolean) to authenticated, service_role;

-- The fifteen already cleared by hand on 16 September 2026 recorded what their
-- status had been in the ledger. Copy it across so the undo button works on
-- them too.
update public.applications a
   set status_before_test = x.was
  from (
    select distinct on ((refs ->> 'applications')::uuid)
           (refs ->> 'applications')::uuid as id, refs ->> 'was' as was
      from public.agent_actions
     where action = 'mark_application_test' and refs ? 'was'
     order by (refs ->> 'applications')::uuid, at desc
  ) x
 where a.id = x.id and a.status = 'test' and a.status_before_test is null;
