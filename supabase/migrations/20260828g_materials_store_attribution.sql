-- materials_store_set_by was landing as 'not recorded' on the commonest path
-- of all, and staying that way. Found by calling the deployed endpoint for
-- real rather than trusting that it worked.
--
-- The job wizard writes the draft at step 2, when there is no session and no
-- client_email on the row yet, so neither source of attribution exists and the
-- fallback fires. At step 6 the client signs and their email is written, but
-- by then the nomination itself has not changed, so the stamp is deliberately
-- not moved and 'not recorded' sticks for the life of the job.
--
-- That is the wrong answer to a question this column exists to answer. In a
-- dispute over a stolen load, WHO named the place is the fact, and for a
-- wizard job it is not unknown, it is simply known slightly later than the
-- answer was given.
--
-- So: WHEN it was named never moves once given, because that is the truth of
-- when the instruction was issued. WHO named it is filled in as soon as it
-- becomes knowable, and only while it is still unattributed. An attribution
-- that already names somebody is never overwritten by this path.
--
-- Proven against production, then rolled back: attribution fills on go-live
-- with set_at unmoved, an unrelated update touches neither field, and a real
-- change to the nomination re-stamps both.
create or replace function public.jobs_materials_store_stamp()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_changed boolean;
  v_had     boolean;
  v_who     text;
begin
  -- OLD is unassigned on INSERT and reading a field of it there is an error,
  -- so the two cases are separated rather than leaned on AND short-circuiting,
  -- which SQL does not promise.
  if tg_op = 'INSERT' then
    v_changed := true;
    v_had     := false;
  else
    v_changed := new.materials_store      is distinct from old.materials_store
              or new.materials_store_type is distinct from old.materials_store_type;
    v_had     := old.materials_store_type is not null;
  end if;

  -- The signed-in caller if there is one, otherwise the client whose job it
  -- is, because the wizard runs with no session and the answer is still
  -- theirs. Null when neither is known yet.
  v_who := coalesce(
    nullif(btrim(lower(auth.jwt() ->> 'email')), ''),
    nullif(btrim(lower(coalesce(new.client_email, ''))), ''));

  -- Only move the stamp when the instruction itself moved. An unrelated update
  -- to the job must not make an old nomination look freshly given.
  if v_changed then
    if new.materials_store_type is not null then
      new.materials_store_set_at := now();
      new.materials_store_set_by := coalesce(v_who, 'not recorded');
    else
      new.materials_store_set_at := null;
      new.materials_store_set_by := null;
    end if;

  -- Unchanged nomination, but the person behind it may have become knowable
  -- since. Fill the gap, leave the time alone, and never overwrite a name.
  elsif new.materials_store_type is not null
        and coalesce(new.materials_store_set_by, 'not recorded') = 'not recorded'
        and v_who is not null then
    new.materials_store_set_by := v_who;
  end if;

  -- Changing the nomination is allowed: materials genuinely get moved, and the
  -- new instruction is stamped above. Removing it altogether once money or
  -- evidence has gone through on the strength of it is not, because it rewrites
  -- who was carrying the risk at the time, after the fact.
  if v_had and new.materials_store_type is null then
    if exists (select 1 from public.materials_releases r where r.job_id = new.id)
       or exists (select 1 from public.evidence e
                   where e.job_id = new.id and e.kind = 'materials') then
      raise exception
        'Job % has a materials release or materials evidence recorded against its nominated store, so the nomination cannot be removed. Record a new location instead: the change is stamped and the old one stays in the record.', new.id
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end $$;

revoke execute on function public.jobs_materials_store_stamp() from public, anon, authenticated;
