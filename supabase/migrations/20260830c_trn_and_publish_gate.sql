-- 1. The TRN, and its approval.
--
-- When Persona took over step 3 on 30 Aug the TRN upload row went with it,
-- and nothing replaced it, so no TRN was being collected at all. It matters
-- for two reasons that are not about identity: it is one of the stronger
-- indicators that somebody is a contractor rather than an employee, and a
-- subcontractor raises an invoice against it.
--
-- The number is stored, not a photograph of it, because a nine digit number
-- read off a card is the thing being checked and an image of it is a document
-- to store, redact and destroy for no extra proof.
alter table public.applications add column if not exists trn text;
alter table public.applications add column if not exists trn_status text not null default 'not_given';
alter table public.applications add column if not exists trn_checked_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.applications'::regclass and conname = 'applications_trn_status_check'
  ) then
    alter table public.applications
      add constraint applications_trn_status_check
      check (trn_status in ('not_given', 'pending', 'approved', 'rejected'));
  end if;
end $$;

-- 2. The publish gate.
--
-- RUNBOOK.md lists what to check before a profile goes public. A list in a
-- document is not a gate, so this is the same list in the database. Publishing
-- is still a human act: this refuses a bad publish, it never performs one.
--
-- An email is required because everything AFTER publishing is keyed on it: the
-- portal account, the Worker Guidelines signature that yaad_match demands, and
-- the job alerts themselves. Publishing a worker who can never be sent a job
-- is not a kindness, it is a dead profile with their name on it.
create or replace function public.enforce_profile_publish_checks()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  app record;
begin
  if new.active is not true or new.application_id is null then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.active is true then
    return new;
  end if;

  select persona_status, trn_status, coalesce(nullif(email, ''), '') as email
    into app
    from applications
   where id = new.application_id;

  if app is null then
    raise exception 'Cannot publish: no application % exists.', new.application_id;
  end if;

  if coalesce(new.worker_email, '') = '' and app.email = '' then
    raise exception 'Cannot publish %: no email address. The portal account, the Worker Guidelines signature and job alerts are all keyed on it, so this worker could never be sent a job.', new.name;
  end if;

  if coalesce(app.persona_status, '') not in ('approved', 'completed') then
    raise exception 'Cannot publish %: the identity check reads "%". It must be approved or completed, confirmed by our server against Persona.', new.name, coalesce(app.persona_status, 'nothing yet');
  end if;

  if coalesce(app.trn_status, 'not_given') <> 'approved' then
    raise exception 'Cannot publish %: the TRN reads "%". Check it against the name on the ID and set it to approved first.', new.name, coalesce(app.trn_status, 'not_given');
  end if;

  return new;
end $$;

drop trigger if exists trg_profile_publish_checks on public.worker_profiles;
create trigger trg_profile_publish_checks
  before insert or update on public.worker_profiles
  for each row execute function public.enforce_profile_publish_checks();
