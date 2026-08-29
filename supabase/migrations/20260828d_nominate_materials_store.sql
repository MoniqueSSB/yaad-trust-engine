-- Somebody has to be able to answer the question.
--
-- 20260828c added the nominated materials store and the two guards that refuse
-- a tranche or materials evidence without one. It left no way to record an
-- answer on a job that did not come through the job wizard, which is every job
-- already in the table. A gate nobody can pass is not a gate, it is a wall, so
-- this is the door.
--
-- One function, because there are two callers and they must not drift:
--   the CLIENT, from their portal, answering it themselves
--   an ADMIN, from the desk, writing down what the client said on the phone
--
-- The WORKER is refused, deliberately and by name. The whole argument for
-- moving the risk in materials onto the client is that the CLIENT chose the
-- place. A worker who could nominate it would be choosing where to leave
-- goods he is then not responsible for, and the rule would be worth nothing.
--
-- Authorisation is NULL-safe from the first line, for the reason written up in
-- 20260828a: with no JWT, auth.jwt()->>'email' is NULL, a comparison against
-- it is NULL, and plpgsql treats IF NULL as false, so the check that looks
-- like it is guarding the door quietly holds it open.
create or replace function public.nominate_materials_store(
  p_job   text,
  p_type  text,
  p_where text default ''
)
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
end $function$;

comment on function public.nominate_materials_store(text, text, text) is
  'The client, or an admin on the client''s word, records where materials are to be kept on the property. Nothing else may write jobs.materials_store_type: it is the fact the materials guards in 20260828c turn on.';

-- Nothing anonymous gets near a function that decides who carries the loss on
-- a stolen load, whatever the body says.
revoke execute on function public.nominate_materials_store(text, text, text) from public, anon;
grant  execute on function public.nominate_materials_store(text, text, text) to authenticated;
