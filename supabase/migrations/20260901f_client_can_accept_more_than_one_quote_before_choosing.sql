-- Founder's own correction, 1 Sep 2026, live: accepting a quote had been
-- wired straight to booking (accept_quote_as_me, migration 20260901e).
-- A client pressing Accept immediately got worker_email set and the job
-- read as in_progress, with no scope of work and no payment terms agreed
-- yet. The Kickoff Pack that carries both was drafted afterward, off to
-- the side, tied only to the job, so there was nowhere for it to gate
-- anything even if it had been asked to.
--
-- The founder's stated model: a client can accept more than one quote.
-- Each accepted worker writes a Kickoff Pack against their own price.
-- The client compares the documents and only then chooses. So the unit
-- that gets confirmed can no longer be the job; it has to be the quote,
-- because more than one quote can be live for the same job at once.
--
-- This does four things.
--
-- 1. kickoff_drafts and kickoff_packs gain quote_id, so a job can carry
--    more than one draft/pack in flight, one per accepted quote.
--    Existing rows are backfilled against the job's own accepted quote,
--    the only case that could exist before this migration.
--
-- 2. job_quotes gains a status between 'submitted' and 'accepted':
--    'kickoff_requested'. Accepting a quote now means this, not booking.
--
-- 3. accept_quote_as_me() is retired. It only ever set job_quotes.status
--    and jobs.worker_email in one step, which is exactly the shape that
--    does not fit a client who can do this more than once. In its place,
--    request_kickoff_as_me(p_quote) flips a submitted quote to
--    kickoff_requested and touches nothing on jobs. It can be called
--    again for a different quote on the same job; nothing here stops
--    that, on purpose.
--
-- 4. _do_choose_worker(), the one real booking path underneath
--    choose_worker() and choose_worker_via_whatsapp(), is regated. It no
--    longer reads scope_agreements, which was already known not to fit
--    more than one live quote: choose_worker_via_whatsapp() itself
--    refuses outright the moment more than one quote is open, precisely
--    because scope_agreements carries one row per side per job, not per
--    quote, and cannot tell two workers' agreements apart. The Kickoff
--    Pack can, because it is drafted and confirmed per quote_id. So the
--    gate becomes: this specific quote's Kickoff Pack has
--    both_confirmed_at set. scope_agreements and agreeScope() are left
--    in place, unread by this function from here on; retiring the
--    portal's separate tick-box UI is a follow-up, not done in this
--    migration.
--
-- choose_worker_via_whatsapp() is deliberately NOT touched here. It
-- already refuses when more than one quote is open and sends the client
-- to the portal link, which is the right instinct for comparing more
-- than one Kickoff Pack; its own scope_agreements pre-check is now
-- redundant rather than load bearing, since _do_choose_worker() holds
-- the real gate underneath it either way, and a stale pre-check failing
-- open is not a bypass, it is caught one call further in. Worth revisiting
-- so its own message is not confusing, but not decided here.

alter table public.kickoff_drafts
  add column if not exists quote_id uuid references public.job_quotes(id);

alter table public.kickoff_packs
  add column if not exists quote_id uuid references public.job_quotes(id);

update public.kickoff_drafts d
   set quote_id = q.id
  from public.job_quotes q
 where d.quote_id is null
   and q.job_id = d.job_id
   and q.status = 'accepted';

update public.kickoff_packs p
   set quote_id = q.id
  from public.job_quotes q
 where p.quote_id is null
   and q.job_id = p.job_id
   and q.status = 'accepted';

alter table public.job_quotes drop constraint job_quotes_status_check;
alter table public.job_quotes add constraint job_quotes_status_check
  check (status = any (array['submitted','kickoff_requested','withdrawn','accepted','declined']));

drop function if exists public.accept_quote_as_me(uuid);

create function public.request_kickoff_as_me(p_quote uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare q record; j record; me text;
begin
  me := lower(coalesce(auth.jwt() ->> 'email', ''));
  if me = '' then raise exception 'You need to be signed in to do that.'; end if;

  select * into q from job_quotes where id = p_quote;
  if q is null then raise exception 'That quote no longer exists.'; end if;

  select * into j from jobs where id = q.job_id;
  if j is null then raise exception 'That job no longer exists.'; end if;

  if lower(coalesce(j.client_email,'')) <> me then
    raise exception 'That is not your job.';
  end if;

  if coalesce(j.worker_email,'') <> '' then
    raise exception 'This job already has a worker on it. Talk to Yaadly before changing that.';
  end if;

  if q.status <> 'submitted' then
    raise exception 'That price is not open to request a Kickoff Pack for.';
  end if;

  update job_quotes set status = 'kickoff_requested', updated_at = now() where id = p_quote;

  return q.job_id;
end;
$function$;

revoke all on function public.request_kickoff_as_me(uuid) from public;
grant execute on function public.request_kickoff_as_me(uuid) to authenticated, service_role;

create or replace function public._do_choose_worker(p_job text, p_quote uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_job    jobs%rowtype;
  v_quote  job_quotes%rowtype;
  v_confirmed timestamptz;
begin
  select * into v_job from jobs where id = p_job for update;
  if not found then raise exception 'no such job'; end if;

  if coalesce(v_job.worker_email, '') <> '' then
    raise exception 'a worker is already chosen on this job';
  end if;

  select * into v_quote from job_quotes where id = p_quote and job_id = p_job;
  if not found then raise exception 'that quote is not on this job'; end if;

  select both_confirmed_at into v_confirmed
    from kickoff_packs
   where job_id = p_job and quote_id = p_quote
   order by created_at desc
   limit 1;

  if v_confirmed is null then
    raise exception 'choose unlocks once this worker''s Kickoff Pack is confirmed by both sides';
  end if;

  perform set_config('yaadly.choosing', '1', true);
  update jobs set worker_email = v_quote.worker_email,
                  worker_name  = v_quote.worker_name,
                  worker_user  = v_quote.worker_user,
                  status = 'in_progress', stage = 1,
                  updated_at = now()
   where id = p_job;
  update job_quotes set status = 'accepted' where id = p_quote;
  update job_quotes set status = 'declined'
   where job_id = p_job and id <> p_quote and status in ('submitted', 'kickoff_requested');
  perform set_config('yaadly.choosing', '', true);

  return p_job;
end;
$function$;
