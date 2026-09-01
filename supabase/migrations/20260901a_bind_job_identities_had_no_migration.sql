-- bind_job_identities() and its trigger were live in production with no
-- migration anywhere in this repository. Found 1 Sep 2026, verifying a real
-- end-to-end WhatsApp test: jobs.client_user came back populated on a job
-- this session had grepped the whole repo for and found no write site for,
-- because the write was never checked in. Every other trigger on jobs
-- (sync_job_status, approve_stage's stage_approvals, enforce_signed_before_open,
-- and so on) has a migration; this is the one that did not.
--
-- The risk is not that it is wrong today, it is that scripts/backup-db.sh is
-- the only backup path on the free plan (no point-in-time recovery), and a
-- rebuild from migrations alone would silently drop this trigger. jobs.client_user
-- and jobs.worker_user would stop populating, with nothing in CI or the schema
-- to say why, until someone noticed client_go_live() or a portal page behaving
-- as though an account had never been linked.
--
-- Definition below is exactly what was read back live with
-- pg_get_functiondef('bind_job_identities'::regproc) and
-- pg_get_triggerdef() on trg_bind_job_identities, unchanged. This migration
-- documents what already runs; it does not alter it.

create or replace function public.bind_job_identities()
returns trigger
language plpgsql
security definer
set search_path to 'public, auth'
as $function$
begin
  if new.client_user is null and coalesce(new.client_email,'') <> '' then
    select id into new.client_user from auth.users
     where lower(email) = lower(new.client_email) limit 1;
  end if;
  if new.worker_user is null and coalesce(new.worker_email,'') <> '' then
    select id into new.worker_user from auth.users
     where lower(email) = lower(new.worker_email) limit 1;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_bind_job_identities on public.jobs;
create trigger trg_bind_job_identities
  before insert or update on public.jobs
  for each row execute function public.bind_job_identities();
