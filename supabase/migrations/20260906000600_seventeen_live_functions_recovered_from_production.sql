-- Seventeen live functions that existed in no migration, recovered from
-- production on 5 September 2026.
--
-- ── What was wrong ──
--
-- Every one of these is running. None of them was in this directory. They were
-- applied straight to the database, mostly through the Supabase MCP, which
-- assigns its own version number and writes no file, so the repository has been
-- describing a database it could not rebuild.
--
-- is_admin() is the one that makes this urgent rather than untidy. Sixty-four
-- policies and functions across the existing migrations call it. It was defined
-- in none of them. A rebuild from this repository would fail on the first
-- policy that names it, and CLAUDE.md section 6 puts it second in the three
-- controls standing between the public internet and a worker's identity
-- documents: "Cloudflare Access, is_admin() and RLS, in that order."
--
-- The same class of drift has now been caught three times: the Vault migration
-- on 3 September, work_log_pins on 4 September, and this. The other two were
-- one object each. This is seventeen, and it includes the security model.
--
-- ── How to read this file ──
--
-- TRANSCRIBED, NOT AUTHORED, and NOT TESTED, exactly like the two before it.
-- Every body below came out of pg_get_functiondef and every grant out of
-- has_function_privilege. Nothing here was executed: production already has it
-- all, so running this changes nothing. It matters on a rebuild, where a latent
-- error surfaces instead of here.
--
-- Ordered so the file applies cleanly on an empty database: the leaves first,
-- then the functions that call them. current_doc_version before
-- client_cleared_for_golive before may_use_agents and
-- enforce_signed_before_open.
--
-- ── Two things worth a human's eye, neither changed here ──
--
-- 1. mark_enquiry_test() and mark_thread_test() are executable by anon. Both
--    refuse anybody who is not an admin as their first statement, so this is
--    not an open door, but a grant wider than the function's own rule is a
--    thing to narrow deliberately rather than in a transcription.
--
-- 2. rls_auto_enable() is an EVENT trigger function: it turns row level
--    security on for every new table in public, which is what makes CLAUDE.md
--    section 6's "every table has RLS" true by default rather than by
--    discipline. Recreating the function does NOT recreate the event trigger
--    that fires it. That is included at the end.

-- ── leaves, nothing here calls anything else in this file ──

CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from admins
    where lower(email) = lower(auth.jwt() ->> 'email')
  );
$function$;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.current_doc_version(p_doc_type text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select value from public.app_settings where key = p_doc_type || '_version';
$function$;
grant execute on function public.current_doc_version(text) to anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.email_has_account(p_email text)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'auth', 'public'
AS $function$
  select exists (
    select 1 from auth.users where lower(email) = lower(trim(p_email))
  );
$function$;
-- Service role only. It answers "does this address have an account", which is
-- an account enumeration oracle if anyone can ask it.
revoke all on function public.email_has_account(text) from public, anon, authenticated;
grant execute on function public.email_has_account(text) to service_role;

CREATE OR REPLACE FUNCTION public.job_open_for_quotes(jid text)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from jobs j
    where j.id = jid and j.open and coalesce(j.worker_email,'') = '' and j.stage = 0
  );
$function$;
grant execute on function public.job_open_for_quotes(text) to anon, authenticated, service_role;
-- ── built on the leaves above ──

CREATE OR REPLACE FUNCTION public.client_cleared_for_golive(p_email text)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select p_email is not null and length(btrim(p_email)) > 0
    and exists (
      select 1 from public.doc_signatures s
      where s.doc_type = 'client_guidelines'
        and lower(s.signer_email) = lower(btrim(p_email))
        and (public.current_doc_version('client_guidelines') is null
             or s.doc_version = public.current_doc_version('client_guidelines'))
    )
    and exists (
      select 1 from public.client_profiles cp
      where lower(cp.email) = lower(btrim(p_email))
        and cp.active is true
    );
$function$;
revoke all on function public.client_cleared_for_golive(text) from public, anon, authenticated;
grant execute on function public.client_cleared_for_golive(text) to service_role;

CREATE OR REPLACE FUNCTION public.may_use_agents(p_email text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.is_admin() or public.client_cleared_for_golive(p_email);
$function$;
grant execute on function public.may_use_agents(text) to anon, authenticated, service_role;
-- ── admin only RPCs, each refusing a non-admin as its first statement ──

CREATE OR REPLACE FUNCTION public.mark_enquiry_test(p_enquiry uuid)
 RETURNS enquiries
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare row public.enquiries;
begin
  if not public.is_admin() then
    raise exception 'Only a signed-in admin can mark an enquiry as a test.';
  end if;

  update public.enquiries set status = 'test'
   where id = p_enquiry and coalesce(status,'new') not in ('replied','converted')
   returning * into row;

  if row.id is null then
    raise exception 'That enquiry does not exist, or it has already been answered or converted.';
  end if;

  insert into public.agent_actions (actor, actor_kind, action, summary, refs)
  values (coalesce(auth.jwt() ->> 'email', 'unknown'), 'human', 'mark_enquiry_test',
          'Marked the enquiry from ' || coalesce(nullif(btrim(row.name),''), 'somebody who left no name') || ' as a test.',
          jsonb_build_object('enquiries', p_enquiry));

  return row;
end;
$function$;
grant execute on function public.mark_enquiry_test(uuid) to anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.mark_thread_test(p_channel text, p_from text)
 RETURNS intake_threads
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare row public.intake_threads;
begin
  if not public.is_admin() then
    raise exception 'Only a signed-in admin can mark a conversation as a test.';
  end if;

  update public.intake_threads set is_test = true
   where channel = p_channel and from_addr = p_from
   returning * into row;

  if row.channel is null then
    raise exception 'There is no conversation on that channel and address.';
  end if;

  insert into public.agent_actions (job_id, actor, actor_kind, action, summary, refs)
  values (row.job_id, coalesce(auth.jwt() ->> 'email', 'unknown'), 'human', 'mark_thread_test',
          'Marked the ' || p_channel || ' conversation ' || coalesce(row.job_id, p_from) || ' as a test, so it stops counting against the reply promise.',
          jsonb_build_object('intake_threads', p_channel || '/' || p_from));

  return row;
end;
$function$;
grant execute on function public.mark_thread_test(text, text) to anon, authenticated, service_role;
-- ── trigger functions ──
--
-- These recreate the FUNCTIONS only. Where the trigger that fires one is
-- already in an existing migration it stays there; this file does not
-- duplicate it. The one exception is the event trigger at the end, which has
-- never been in a migration at all.

CREATE OR REPLACE FUNCTION public.bind_worker_identity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public, auth'
AS $function$
begin
  if new.worker_user is null and coalesce(new.worker_email,'') <> '' then
    select id into new.worker_user from auth.users
     where lower(email) = lower(new.worker_email) limit 1;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.bump_yaad_score()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.stage >= 5 and coalesce(old.scored, false) = false
     and coalesce(new.worker_email, '') <> '' then
    new.scored = true;

    update worker_profiles
       set jobs_completed = coalesce(jobs_completed, 0) + 1
     where lower(worker_email) = lower(new.worker_email);

    -- Published on the public job board as open_jobs.client_jobs_completed,
    -- and workers read it when deciding whether to quote.
    if coalesce(new.client_email, '') <> '' then
      update client_profiles
         set jobs_completed = coalesce(jobs_completed, 0) + 1
       where lower(email) = lower(new.client_email);
    end if;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.client_profiles_guard_selfedit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  -- Fields a client must never edit on their own profile. The only writer
  -- allowed past this is another trigger (today: bump_yaad_score, which
  -- increments jobs_completed when a job reaches stage 5).
  if pg_trigger_depth() < 2 and not public.is_admin() then
    new.jobs_completed := old.jobs_completed;
    new.active         := old.active;
    new.user_id        := old.user_id;
    new.email          := old.email;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.client_profiles_touch()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  new.updated_at = now();
  -- A client edits only their name; the score and standing are Yaadly's.
  if pg_trigger_depth() < 2 and not public.is_admin() then
    new.user_id = old.user_id; new.email = old.email;
    new.jobs_completed = old.jobs_completed; new.active = old.active;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_signed_before_open()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if NEW.open is true and coalesce(OLD.open, false) is false then
    if not public.client_cleared_for_golive(NEW.client_email) then
      raise exception
        'Job % cannot be opened for quotes yet: the client (%) must create a profile and sign the current Client Guidelines first.',
        NEW.id, coalesce(nullif(btrim(NEW.client_email), ''), '(no email on file)')
        using errcode = 'check_violation';
    end if;
  end if;
  return NEW;
end;
$function$;

CREATE OR REPLACE FUNCTION public.kickoff_guard_approval()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  total numeric;
begin
  if new.status = 'approved' then
    if new.docs is null then
      raise exception 'An empty pack cannot be approved: it has no documents.';
    end if;
    select coalesce(sum((s->>'proportion_percent')::numeric), 0) into total
      from jsonb_array_elements(coalesce(new.docs->'payment_schedule'->'stages', '[]'::jsonb)) s;
    if total <> 100 then
      raise exception 'Payment stages total % percent; they must total exactly 100 before approval.', total;
    end if;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.kickoff_touch_updated()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  new.updated_at = now();
  if (tg_op = 'UPDATE') and (new.docs is distinct from old.docs) then
    -- Archive the outgoing version, then move the revision counter on.
    -- Client-supplied rev/revisions values are overwritten here on purpose:
    -- the database, not the browser, is the authority on history.
    new.revisions = coalesce(old.revisions, '[]'::jsonb) || jsonb_build_array(
      jsonb_build_object(
        'rev',         coalesce(old.rev, 1),
        'docs',        old.docs,
        'status',      old.status,
        'approved_by', old.approved_by,
        'saved_at',    old.updated_at
      )
    );
    new.rev = coalesce(old.rev, 1) + 1;
    -- Any edit to the drafted documents drops the pack out of approved. An
    -- approval must refer to the text that was actually approved.
    if (new.status = 'approved') and (old.status = 'approved') then
      new.status = 'in_review';
      new.approved_by = null;
      new.approved_at = null;
    end if;
  else
    -- No docs change: rev and history stay exactly as they were.
    new.rev = old.rev;
    new.revisions = old.revisions;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.quote_set_worker_name()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  select wp.name into new.worker_name
    from worker_profiles wp
   where lower(wp.worker_email) = lower(new.worker_email)
   limit 1;
  if new.worker_name is null or new.worker_name = '' then
    new.worker_name = split_part(coalesce(new.worker_email,''), '@', 1);
  end if;
  return new;
end;
$function$;
-- ── the event trigger that makes "every table has RLS" true by default ──
--
-- CLAUDE.md section 6 says every table has row level security. This is what
-- makes that hold without anyone remembering: it fires on CREATE TABLE in
-- public and enables RLS on the new table. It logs and continues on failure
-- rather than blocking the DDL, so a table it could not reach is a line in the
-- log, not an outage. Recreating the function alone would leave the rule
-- silently off, which is why the trigger is here too.

CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$;

drop event trigger if exists ensure_rls;
create event trigger ensure_rls
  on ddl_command_end
  when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
  execute function public.rls_auto_enable();
