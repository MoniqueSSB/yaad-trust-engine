-- Applied to production 3 Sep 2026 via MCP as
-- a_client_can_correct_their_own_description.
--
-- The client gets to correct the description of their own job.
--
-- A job posted through the wizard read "Fix the rood" in the client's own
-- board preview, and the person who typed it had no way to fix it. The jobs
-- table has never had an update policy for clients, and that is right: most
-- of its columns belong to the desk or to the state machine, and a blanket
-- update policy would hand a client open, stage, worker_email and the money
-- columns in one line. So this is a function, the same shape as
-- nominate_materials_store() (20260828d): one column, one rule about who and
-- when, and the refusal comes back in words the page can show.
--
-- When: only while nobody is booked. Once a worker is chosen the description
-- is the scope both sides confirmed a Kickoff Pack against, and changing the
-- words under an agreement is a variation, not an edit. That goes through
-- the desk, where a named human records it. Before that point quotes may
-- already be in, and they were priced against the old wording; the page says
-- so rather than pretending otherwise.
--
-- What is deliberately NOT applied here: the contact scrub. A description
-- may carry an "Address:" or "Access contact:" line that the desk and the
-- booked worker need. open_jobs strips those lines and masks phone numbers
-- before the board sees them (20260828c), and the client's board preview
-- mirrors that chain. This changes what is stored; what is published is
-- still decided by the view, which is where a rule about who sees somebody's
-- property belongs.
--
-- Triggers that fire on a jobs update were read before this was written:
-- notify_client_on_job_change sends only on a stage rise, on completion or
-- on walkthrough notes; sync_job_status recomputes status from the same
-- facts and lands on the same value; the two enforce_* gates only look when
-- open flips to true. A description-only update moves nothing else.

create or replace function public.edit_job_descr_as_me(p_job text, p_descr text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(nullif(btrim(auth.jwt() ->> 'email'), ''));
  v_descr text := btrim(coalesce(p_descr, ''));
  v_job   jobs%rowtype;
begin
  if v_email is null then
    raise exception 'Sign in as the client of this job to change its description.'
      using errcode = '28000';
  end if;

  if v_descr = '' then
    raise exception 'The description cannot be empty. Say what needs doing, in your own words.'
      using errcode = 'check_violation';
  end if;

  if length(v_descr) > 4000 then
    raise exception 'That is too long at % characters. Keep the description under 4000.', length(v_descr)
      using errcode = 'check_violation';
  end if;

  select * into v_job from jobs where id = p_job for update;
  if not found then
    raise exception 'no such job';
  end if;

  if not public.is_admin()
     and lower(coalesce(v_job.client_email, '')) is distinct from v_email then
    raise exception 'Only the client of this job can change its description.'
      using errcode = '42501';
  end if;

  if coalesce(v_job.worker_email, '') <> '' or coalesce(v_job.stage, 0) <> 0 then
    raise exception 'A worker is booked on this job, so the description is now the scope you both agreed. Ask Yaadly to record any change as a variation.'
      using errcode = 'check_violation';
  end if;

  -- Saving the same words is not a change, and should not bump updated_at,
  -- which the board sorts by.
  if v_descr = coalesce(v_job.descr, '') then
    return;
  end if;

  update jobs
     set descr      = v_descr,
         updated_at = now()
   where id = p_job;
end $$;

revoke execute on function public.edit_job_descr_as_me(text, text) from public, anon;
grant  execute on function public.edit_job_descr_as_me(text, text) to authenticated;

comment on function public.edit_job_descr_as_me(text, text) is
  'The client of a job corrects its description, only while no worker is booked. Portal only; the desk edits the row directly.';

-- Proven 3 Sep 2026 inside a rolled back transaction, as role authenticated
-- with request.jwt.claims set to a made-up client who is NOT an admin (the
-- same trap 20260902w records: probed as Monique, is_admin() lets everything
-- through). The real job was reassigned to that client for the duration and
-- a booked copy of it inserted, both undone by the rollback.
--
--   somebody else's job ..... REFUSED 42501
--   own job, new words ...... ALLOWED, stored trimmed, updated_at bumped
--   own job, same words ..... no-op, updated_at NOT bumped
--   own job, empty .......... REFUSED 23514
--   own job, 4001 chars ..... REFUSED 23514
--   own job, worker booked .. REFUSED 23514 (the variation sentence)
--   no such job ............. REFUSED P0001
--   no email in token ....... REFUSED 28000
