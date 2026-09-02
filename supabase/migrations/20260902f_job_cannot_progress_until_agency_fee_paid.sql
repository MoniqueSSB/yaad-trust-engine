-- The job cannot progress until the agency fee invoice is paid (2 Sep
-- 2026, founder's own correction). Booking used to set jobs straight to
-- 'in_progress', stage 1, worker able to file evidence immediately, with
-- no connection at all to whether Yaadly's own Guarantee & Support fee had
-- ever been paid. New status 'awaiting_payment': a job sits there, worker
-- chosen but not yet allowed to start, until a named admin marks the
-- agency fee invoice paid in the concierge desk. That single action is
-- what actually moves it, the same "a human confirms every consequential
-- step" shape as every other money-adjacent gate in this codebase.

alter table public.jobs drop constraint if exists jobs_status_check;
alter table public.jobs add constraint jobs_status_check
  check (status = any (array[
    'draft','awaiting_client_setup','open_for_quotes','quoted',
    'awaiting_payment','in_progress','evidence','complete','disputed','cancelled'
  ]));

create or replace function public.sync_job_status()
returns trigger
language plpgsql
as $function$
declare
  has_quotes boolean;
  working_stage integer;
  has_unapproved_evidence boolean;
  final_stage_count integer;
  is_complete boolean;
  fee_paid boolean;
begin
  if new.status in ('disputed','cancelled') then
    return new;
  end if;

  select jsonb_array_length(p.docs->'payment_schedule'->'stages')
    into final_stage_count
    from public.kickoff_packs p
   where p.job_id = new.id and p.status = 'approved'
   order by p.updated_at desc
   limit 1;

  is_complete := coalesce(new.stage, 0) >
    coalesce(final_stage_count, 5 - 1);

  if is_complete then
    new.status := 'complete';
  elsif coalesce(new.worker_email,'') <> '' then
    select exists (
      select 1 from public.invoices i
       where i.job_id = new.id and i.stage is null and i.status = 'paid'
    ) into fee_paid;

    if not fee_paid then
      new.status := 'awaiting_payment';
    else
      working_stage := greatest(coalesce(new.stage, 0), 1);
      select exists (
        select 1 from public.evidence e
         where e.job_id = new.id and coalesce(e.stage, 1) = working_stage
      ) and not exists (
        select 1 from public.stage_approvals a
         where a.job_id = new.id and a.stage = working_stage
      ) into has_unapproved_evidence;

      new.status := case when has_unapproved_evidence then 'evidence' else 'in_progress' end;
    end if;
  elsif new.open then
    select exists (select 1 from public.job_quotes q
                    where q.job_id = new.id and q.status in ('submitted', 'quote_confirmed', 'kickoff_requested'))
      into has_quotes;
    new.status := case when has_quotes then 'quoted' else 'open_for_quotes' end;
  elsif public.client_cleared_for_golive(new.client_email) then
    new.status := 'draft';
  else
    new.status := 'awaiting_client_setup';
  end if;

  return new;
end;
$function$;

-- Booking no longer forces stage 1: a job sitting at 'awaiting_payment' is
-- stage 0, not started. The trigger below moves it to stage 1 the moment
-- the agency fee is actually marked paid, which is also what lets
-- sync_job_status's own evidence branch run for the first time.
create or replace function public._do_choose_worker(p_job text, p_quote uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_job    jobs%rowtype;
  v_quote  job_quotes%rowtype;
  v_pack_confirmed timestamptz;
begin
  select * into v_job from jobs where id = p_job for update;
  if not found then raise exception 'no such job'; end if;

  if coalesce(v_job.worker_email, '') <> '' then
    raise exception 'a worker is already chosen on this job';
  end if;

  select * into v_quote from job_quotes where id = p_quote and job_id = p_job;
  if not found then raise exception 'that quote is not on this job'; end if;

  if v_quote.status = 'quote_confirmed' then
    null;
  elsif v_quote.status = 'kickoff_requested' then
    select both_confirmed_at into v_pack_confirmed
      from kickoff_packs
     where job_id = p_job and quote_id = p_quote
     order by created_at desc
     limit 1;
    if v_pack_confirmed is null then
      raise exception 'choose unlocks once this worker''s Kickoff Pack is confirmed by both sides';
    end if;
  else
    raise exception 'choose unlocks once both sides confirm the price, or once a requested Kickoff Pack is confirmed by both sides';
  end if;

  perform set_config('yaadly.choosing', '1', true);
  update jobs set worker_email = v_quote.worker_email,
                  worker_name  = v_quote.worker_name,
                  worker_user  = v_quote.worker_user,
                  updated_at = now()
   where id = p_job;
  update job_quotes set status = 'accepted' where id = p_quote;
  update job_quotes set status = 'declined'
   where job_id = p_job and id <> p_quote and status in ('submitted', 'quote_confirmed', 'kickoff_requested');
  perform set_config('yaadly.choosing', '', true);

  return p_job;
end;
$function$;

-- The moment a named admin marks the agency fee invoice paid, the job
-- moves off 'awaiting_payment' on its own: touching the row is enough,
-- sync_job_status recomputes everything else from the facts that are now
-- true. stage is bumped to at least 1 in the same write, since a job stuck
-- at stage 0 forever would never leave 'awaiting_payment' even once paid.
create or replace function public.start_job_on_agency_fee_paid()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.job_id is not null and new.stage is null
     and new.status = 'paid' and coalesce(old.status, '') is distinct from 'paid' then
    update public.jobs
       set stage = greatest(coalesce(stage, 0), 1), updated_at = now()
     where id = new.job_id;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_start_job_on_agency_fee_paid on public.invoices;
create trigger trg_start_job_on_agency_fee_paid
  after update on public.invoices
  for each row execute function public.start_job_on_agency_fee_paid();

-- Evidence cannot be filed on an unpaid job, worker portal or WhatsApp
-- alike: RLS is the real gate (yaad-inbound's own WhatsApp eligibility
-- filter is updated alongside this migration to match, but that is a
-- courtesy, not the enforcement).
drop policy if exists "job party can insert evidence" on public.evidence;
create policy "job party can insert evidence" on public.evidence
  for insert
  with check (
    is_admin() or exists (
      select 1 from jobs j
       where j.id = evidence.job_id
         and j.status <> 'awaiting_payment'
         and (lower(j.worker_email) = lower(auth.jwt() ->> 'email')
              or lower(j.client_email) = lower(auth.jwt() ->> 'email'))
    )
  );

-- Every job with a worker already chosen and no agency fee paid yet gets
-- recomputed once, now, rather than waiting for the next unrelated touch.
update public.jobs set updated_at = now()
 where coalesce(worker_email, '') <> '' and status <> 'complete';
