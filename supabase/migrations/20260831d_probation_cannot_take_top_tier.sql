-- Probation is a real gate, not a label on a profile.
--
-- Founder's Phase 3: an approved worker goes live in Probation, sees the whole
-- board and quotes standard jobs, and is HIDDEN FROM TOP TIER until the police
-- check and the telephoned references clear. Until now "probation" was a
-- column nothing read, so a worker with no police check could quote a job
-- inside somebody's occupied home. The words were on the page and the door was
-- open.
--
-- Top tier is the founder's own definition: over £500, work inside an occupied
-- home, or anything where the worker holds keys.
--
-- The MONEY test is on the quote rather than the job's budget band, because
-- the quote is the number that always exists and is the one the worker chose.
-- £500 at roughly J$211 to the pound is about J$105,000; the rate moves, so
-- this is a round number just above the line rather than false precision, and
-- it is the one place to change it.
--
-- The ACCESS test reads access_type, which carries the client's own words:
-- "Neighbour holds a key", "Family member on site".
--
-- ONE TRAP, found by testing rather than reading: for a RECORD variable,
-- "j IS NOT NULL" is true only when EVERY column is non-null. jobs has plenty
-- of nullable columns, so a real row read into j failed that test and the
-- access checks below were skipped every time. The money test passed, which is
-- exactly why each rule needed its own case. It tests j.id instead.
create or replace function public.enforce_vetted_worker_on_quote()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  wp record;
  j record;
  total integer;
  top_tier_jmd constant integer := 105000;
begin
  select * into wp from public.worker_profiles
   where lower(worker_email) = lower(coalesce(new.worker_email, '')) and active;

  if wp is null then
    raise exception
      'Only an active vetted worker can submit a quote (no active worker profile for %).',
      coalesce(nullif(btrim(new.worker_email), ''), '(no email)')
      using errcode = 'check_violation';
  end if;

  if coalesce(wp.vetting_state, 'probation') = 'verified' then
    return new;
  end if;

  if coalesce(wp.vetting_state, '') = 'suspended' then
    raise exception 'This account is suspended and cannot quote.'
      using errcode = 'check_violation';
  end if;

  total := coalesce(new.labour_jmd, 0) + coalesce(new.materials_jmd, 0);

  if total >= top_tier_jmd then
    raise exception
      'While your account is in Probation you can quote standard jobs, but not work over about J$%. Finish your police check and your telephoned references and this opens up.',
      top_tier_jmd
      using errcode = 'check_violation';
  end if;

  select * into j from public.jobs where id = new.job_id;

  if j.id is not null and coalesce(j.access_type, '') <> '' then
    if j.access_type ~* '(key|keys)' then
      raise exception
        'While your account is in Probation you cannot take a job where you would hold keys. Finish your police check and your telephoned references and this opens up.'
        using errcode = 'check_violation';
    end if;
    if j.access_type ~* '(on site|occupied|lives there|at home)' then
      raise exception
        'While your account is in Probation you cannot take a job inside an occupied home. Finish your police check and your telephoned references and this opens up.'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;
