-- The profile is created when Phase 1 lands, not when vetting finishes.
-- Founder decision, 30 August 2026: "the profile is created and goes live
-- once we have phase 1 information."
--
-- Two things stood in the way and both are fixed here.
--
-- 1. worker_email was the PRIMARY KEY, and it is NOT NULL. Phase 1 now takes
--    a name and EITHER a phone number or an email, so a tradesperson who
--    gives a number he answers has no email to key on. Inventing one would
--    put a fake address in a column something will eventually try to send to.
--    So the table gets a surrogate key and the email becomes optional.
--    Nothing has a foreign key to this table, checked before writing this, so
--    the repoint is contained. Every existing join is on worker_email as text
--    and keeps working for the rows that have one.
--
-- 2. There was no way to say a profile exists but has not been vetted.
--    vetting_state carries it, and it starts at 'probation'.
--
-- Being listed is not being bookable. yaad_match already requires a signature
-- on the current Worker Guidelines, which is Phase 3, so a probation profile
-- is visible and cannot be matched to a job. That is what keeps "nobody
-- reaches a client's gate unverified" true while the profile is still live.

alter table public.worker_profiles
  add column if not exists id uuid not null default gen_random_uuid();

alter table public.worker_profiles
  add column if not exists application_id uuid;

alter table public.worker_profiles
  add column if not exists vetting_state text not null default 'probation';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.worker_profiles'::regclass
      and conname = 'worker_profiles_vetting_state_check'
  ) then
    alter table public.worker_profiles
      add constraint worker_profiles_vetting_state_check
      check (vetting_state in ('probation', 'verified', 'suspended'));
  end if;
end $$;

-- Rows that pre-date this migration were created by hand or by seed, and were
-- only ever created for workers already through vetting.
update public.worker_profiles set vetting_state = 'verified' where lane = 'vet';

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.worker_profiles'::regclass
      and conname = 'worker_profiles_pkey'
  ) then
    alter table public.worker_profiles drop constraint worker_profiles_pkey;
  end if;
end $$;

alter table public.worker_profiles add primary key (id);
alter table public.worker_profiles alter column worker_email drop not null;

-- Still one profile per email, but only where there is one. Case folded,
-- because an address is not two addresses because somebody used a capital.
create unique index if not exists worker_profiles_email_uniq
  on public.worker_profiles (lower(worker_email))
  where worker_email is not null and worker_email <> '';

-- One profile per application, so a resubmit updates rather than duplicates.
create unique index if not exists worker_profiles_application_uniq
  on public.worker_profiles (application_id)
  where application_id is not null;
