-- The client adds the street address, once somebody is booked to go there.
--
-- WHY. Found 28 Sep 2026 running a live job: a job booked and at stage 2 read
-- "Address: Not added yet", and nothing anywhere let the client add it. The
-- job form deliberately never asks for it (a public form, and an empty house),
-- so it had no second chance to arrive. Founder: it lives in its own section,
-- the Job details tab.
--
-- WHAT THIS DOES. set_job_address_as_me(p_job, p_addr): this job's client
-- only, matched on their JWT email, while the job is not complete. Writes
-- jobs.addr and a line in agent_actions saying who added or changed it, so a
-- changed address is never silent. The old address is not copied into the
-- log: agent_actions is read more widely than the address should be. The address is still read
-- only by the client and the booked worker (the job room fetches it for
-- nobody else); nothing here widens who can see it.

create or replace function public.set_job_address_as_me(p_job text, p_addr text)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_email text := lower(nullif(btrim(auth.jwt() ->> 'email'), ''));
  v_job   jobs%rowtype;
  v_addr  text := btrim(coalesce(p_addr, ''));
begin
  if v_email is null then
    raise exception 'Sign in to add the address.' using errcode = '28000';
  end if;
  select * into v_job from jobs where id = p_job for update;
  if not found or lower(coalesce(v_job.client_email, '')) <> v_email then
    raise exception 'Only the client on this job can set its address.' using errcode = '28000';
  end if;
  if v_job.status = 'complete' then
    raise exception 'This job is complete, so its address is fixed as it was.';
  end if;
  if char_length(v_addr) < 6 then
    raise exception 'Give the full street address: house number, street and district.';
  end if;
  if char_length(v_addr) > 300 then
    raise exception 'Keep the address under 300 characters. Directions can go in Messages.';
  end if;
  if v_addr is not distinct from btrim(coalesce(v_job.addr, '')) then
    return false;
  end if;

  update jobs set addr = v_addr, updated_at = now() where id = p_job;

  insert into agent_actions (job_id, actor, actor_kind, action, summary, refs)
  values (p_job, v_email, 'human', 'set_job_address',
          case when coalesce(btrim(v_job.addr), '') = ''
               then 'The client added the street address.'
               else 'The client changed the street address.' end,
          jsonb_build_object('jobs', p_job, 'had_address', coalesce(btrim(v_job.addr), '') <> ''));
  return true;
end $function$;

comment on function public.set_job_address_as_me(text, text) is
  'The job''s client adds or corrects the street address while the job is open. Logged to agent_actions. Read only by the client and the booked worker.';

revoke all on function public.set_job_address_as_me(text, text) from public, anon;
grant execute on function public.set_job_address_as_me(text, text) to authenticated;
