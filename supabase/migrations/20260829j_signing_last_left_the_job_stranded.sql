-- Doing the two setup steps in the wrong order stranded the job for good.
--
-- A job goes out to workers when three things are true: the client has signed
-- the current Client Guidelines and so has a profile, the job has a nominated
-- materials store, and somebody sets jobs.open. Only one thing in the whole
-- system ever set jobs.open, and that was client_go_live(), which runs at the
-- moment of signing and never again.
--
-- So the order decided the outcome, silently:
--
--   nominate, then sign  -> signing finds the store already there, job opens.
--   sign, then nominate  -> signing finds no store and opens nothing.
--                           nominate_materials_store() writes the store and
--                           stops. Nothing looks again, ever. The job sits at
--                           stage 0 forever and no worker sees it.
--
-- The founder hit the second order on her own live job within the hour.
-- Nothing on screen said a store was even required, so there was no way to
-- know an order existed, let alone which one to pick.
--
-- Two fixes here, and a backfill.

-- 1. Nominating is the other half of the gate, so let it finish the job -----
-- Scoped to the one job the client just acted on. Not "open everything that
-- now qualifies": answering the last setup question on THIS job is consent
-- about this job, and nothing more.

create or replace function public.nominate_materials_store(p_job text, p_type text, p_where text default ''::text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_email text := lower(nullif(btrim(auth.jwt() ->> 'email'), ''));
  v_admin boolean := public.is_admin();
  v_type  text := lower(nullif(btrim(p_type), ''));
  v_where text := btrim(coalesce(p_where, ''));
  v_job   jobs%rowtype;
begin
  if v_email is null then
    raise exception 'Sign in as the client of this job to say where materials are to be kept.'
      using errcode = '28000';
  end if;

  if v_type is null or v_type not in ('lockable','indoors','none_available') then
    raise exception 'Choose one of: a lockable store on site, indoors inside the house, or nowhere securable.'
      using errcode = 'check_violation';
  end if;

  select * into v_job from jobs where id = p_job for update;
  if not found then
    raise exception 'no such job';
  end if;

  if not v_admin
     and lower(coalesce(v_job.client_email, '')) is distinct from v_email then
    raise exception 'Only the client of this job can say where materials are to be kept. That is what moves the risk in them, so it is not the worker''s to decide and not Yaadly''s to assume.'
      using errcode = '42501';
  end if;

  -- "Indoors" on its own is not a place a camera can be pointed at, and not an
  -- instruction anybody can be held to afterwards. Nowhere securable has
  -- nothing to describe, so it is the one answer that stands on its own.
  if v_type <> 'none_available' and v_where = '' then
    raise exception 'Say which room or store, in your own words. "The back room off the veranda, key with my aunt" is the level of detail this needs: the worker has to film the materials in that exact place.'
      using errcode = 'check_violation';
  end if;
  if v_type = 'none_available' then
    v_where := '';
  end if;

  -- set_at and set_by are stamped by trg_jobs_materials_store_stamp, from the
  -- JWT of whoever is calling. A client answering it themselves is recorded as
  -- themselves; the desk writing down a phone call is recorded as the desk.
  update jobs
     set materials_store      = nullif(left(v_where, 160), ''),
         materials_store_type = v_type,
         updated_at           = now()
   where id = p_job;

  -- The bit that was missing. If this was the last thing the job was waiting
  -- on, open it here rather than leaving it for a signing that already
  -- happened. enforce_signed_before_open still has the final say, so this
  -- cannot open a job whose client is not actually cleared.
  update jobs j
     set open = true
   where j.id = p_job
     and j.open is false
     and coalesce(j.worker_email, '') = ''
     and coalesce(j.stage, 0) = 0
     and j.status in ('awaiting_client_setup', 'draft')
     and public.client_cleared_for_golive(j.client_email)
     and public.materials_store_nominated(j.id);
end $function$;

-- 2. Signing must leave the badge telling the truth ------------------------
-- jobs.status is derived by sync_job_status(), a BEFORE trigger on jobs, so it
-- only recomputes when the job row itself is written. Signing writes
-- doc_signatures and client_profiles, not jobs. So a client who signed and had
-- no store nominated kept the badge "Waiting on your portal setup" on a job
-- whose portal setup was complete. The screen was reporting a fact that had
-- stopped being true, and pointing at the one action already done.

create or replace function public.client_go_live()
returns table(job_id text)
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

  -- Possession of an email address is not proof you can read that mailbox.
  -- Without this check anyone could post a job in a stranger's name and have
  -- it go live to workers, which is the whole reason accounts are created
  -- unconfirmed in the first place.
  select lower(btrim(u.email)) into v_email
    from auth.users u
   where u.id = v_uid and u.email_confirmed_at is not null;

  if v_email is null or v_email = '' then
    raise exception 'Confirm your email address first.' using errcode = '28000';
  end if;

  -- The name comes off the signature rather than a form field, so the profile
  -- carries the name they actually signed with.
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

  -- Only jobs that were waiting on exactly this. A job somebody deliberately
  -- left as a draft stays a draft: signing the terms is consent to the terms,
  -- not blanket consent to publish everything they ever started.
  return query
    update public.jobs j
       set open = true
     where lower(j.client_email) = v_email
       and j.open is false
       and j.status = 'awaiting_client_setup'
       and coalesce(j.worker_email, '') = ''
       and coalesce(j.stage, 0) = 0
       and public.materials_store_nominated(j.id)
    returning j.id;

  -- Whatever could not open still needs its status recomputed, or it goes on
  -- claiming to be waiting on a signature it now has. Touching the row is what
  -- makes sync_job_status() run; it moves them to 'draft', which is the truth:
  -- cleared, not yet out to workers.
  update public.jobs
     set updated_at = now()
   where lower(client_email) = v_email
     and open is false
     and status = 'awaiting_client_setup';

  return;
end;
$function$;

-- 3. Backfill ---------------------------------------------------------------
-- Every job already stranded by the above. Recomputes the derived status only.
-- It opens nothing: a job that should be open still needs its client to say
-- where materials go, which is now asked for on screen.

update public.jobs
   set updated_at = now()
 where open is false
   and status = 'awaiting_client_setup'
   and public.client_cleared_for_golive(client_email);
