-- Stamped 20260910130000, not 20260909180000 as first written. Production had
-- already recorded 20260909180000 and 20260910090000 from another session's
-- work (an independent check on a job, and the client guidelines that price
-- it), neither of them in the repository when this was merged. Two different
-- migrations under one version number is the collision CLAUDE.md section 12
-- exists to prevent, and this is the file that moved.
--
-- The client chooses who picks the tradesperson, and Yaadly can pick for them.
--
-- Founder instruction, 9 September 2026: "there should be a step where the
-- client can choose Yaadly to choose a selection for tradesperson based on
-- their requirement, and there be an AI agent that picks a few tradespeople
-- to quote. We receive the quotes, the client can either pick or Yaadly
-- chooses the subcontractor."
--
-- WHAT WAS THERE BEFORE. The 31 July ledger made "Choose for me" the default
-- path and "Let me choose" the alternative, and said the pilot version was
-- the founder doing it by hand. The product then got built entirely as "Let
-- me choose": every quote went straight to the client's quotes page the
-- moment it landed, the client compared and picked, and the desk had no way
-- to put one tradesperson forward on a client's behalf. The default path was
-- unreachable, even for the founder.
--
-- WHAT THIS DOES, in four parts.
--
--   1. jobs.worker_choice: 'yaadly' (the client asked Yaadly to pick) or
--      'client' (they want to see the quotes and choose). Default 'yaadly',
--      which is the ledger's default and means every job that arrives by
--      WhatsApp, email or the desk gets it without anybody having to ask.
--
--   2. A shortlist. job_shortlists holds who the shortlist agent (the
--      yaad-shortlist Edge Function) picked to be ASKED TO QUOTE, with its
--      reason. Admin-only. The agent reads the job and the published worker
--      profiles and picks a few; a named person on the desk sees the list
--      and presses "Invite", and only then does anybody hear about the job.
--      Nothing in this table books anybody or moves money. It is a list of
--      people to ask.
--
--   3. A recommendation. On a 'yaadly' job the client sees NO quotes until a
--      signed-in admin recommends one, via recommend_quote(). The other
--      quotes stay on the desk. What the client then sees is one price, with
--      the name of the person who chose it and why. The client still agrees
--      the price themselves (agree_quote_as_me, or a WhatsApp reply), the
--      worker still confirms their side, and the booking gate underneath,
--      _do_choose_worker, is untouched. Yaadly chooses the person. The
--      client agrees the money. CLAUDE.md section 2 holds on both counts.
--
--   4. The client's view is narrowed at the source, not in a page. The RLS
--      policy jq_select_client and the no-account quotes_for_code() both
--      hide an un-recommended 'submitted' quote on a 'yaadly' job, so every
--      surface (portal, quotes page, WhatsApp reply) agrees without each
--      having to remember. The two WhatsApp RPCs that let a client confirm a
--      price by replying are narrowed the same way, so "reply JOB-123 to
--      confirm" lands on the recommended price and not on whichever quote
--      happened to be first.
--
-- ONE MORE RULE, same day, founder's own words: "When a worker sends their
-- quote the only person that needs to accept is the client for it to go
-- live." So the worker's quote IS the worker's agreement. There is no second
-- "reply to confirm your price" step for the worker any more: the client
-- accepting an open quote books it, in one action, through the same
-- _do_choose_worker gate as before. This supersedes the quote-level dual
-- agreement of 2 September (agree_quote_via_whatsapp, 20260831zzzz, and its
-- portal twin agree_quote_as_me, 20260906000200). The Kickoff Pack route is
-- untouched: a client who asks for the fuller document still gets a pack
-- both sides confirm before booking, because that document is new terms
-- the worker has not yet seen, whereas their quote is their own words.
--
-- WHAT THIS IS NOT. Not a change to who sets the price (the tradesperson
-- quotes it, always). Not a model in the booking: the agent's output is a
-- list of people to ASK, and it never touches job_quotes. Not auto-release
-- of anything. Not a change to the 'client' path, which works exactly as it
-- did yesterday.
--
-- THE MIRROR RULE. A worker who was shortlisted and not invited, or invited
-- and not recommended, is not marked down anywhere: job_shortlists is not
-- a score and the Yaad Score does not read it. The recommendation names the
-- person who made it (recommended_by), so a worker who asks "why not me" can
-- be given a person's answer rather than a machine's.

begin;

-- ── 1. who picks ───────────────────────────────────────────────────────────
-- Every job that already exists was posted under "see every quote and
-- choose", and its client may be looking at quotes today. So existing rows
-- are backfilled 'client' by the add, and only then does the default become
-- 'yaadly' for jobs created from here on. Doing it the other way round would
-- hide live quotes from clients mid-decision the moment this ran.
alter table public.jobs
  add column if not exists worker_choice text not null default 'client';
alter table public.jobs alter column worker_choice set default 'yaadly';
alter table public.jobs drop constraint if exists jobs_worker_choice_chk;
alter table public.jobs
  add constraint jobs_worker_choice_chk check (worker_choice in ('yaadly', 'client'));

comment on column public.jobs.worker_choice is
  'Who picks the tradesperson. yaadly: the client asked Yaadly to choose, and sees one recommended price. client: the client sees every quote and chooses. Default yaadly, the ledger default of 31 Jul 2026.';

-- ── 2. the shortlist ───────────────────────────────────────────────────────
create table if not exists public.job_shortlists (
  id            uuid primary key default gen_random_uuid(),
  job_id        text not null references public.jobs(id) on delete cascade,
  worker_email  text not null,
  worker_name   text,
  rank          int  not null,
  reason        text,
  -- 'model': the shortlist agent chose and wrote the reason.
  -- 'rank':  the database ranking (trade, parish, jobs completed) stood in,
  --          because there were too few candidates to need a model, the
  --          model was paused, or it did not answer usably.
  source        text not null check (source in ('model', 'rank')),
  model         text,
  created_by    text,
  created_at    timestamptz not null default now(),
  invited_at    timestamptz,
  dropped_at    timestamptz,
  dropped_by    text,
  unique (job_id, worker_email)
);

alter table public.job_shortlists enable row level security;

drop policy if exists shortlist_admin_all on public.job_shortlists;
create policy shortlist_admin_all on public.job_shortlists
  for all using (public.is_admin()) with check (public.is_admin());

grant select, insert, update, delete on public.job_shortlists to authenticated;
revoke all on public.job_shortlists from anon;

comment on table public.job_shortlists is
  'Who the shortlist agent picked to be ASKED to quote on a job, with its reason. Admin only. Not a score, not a booking, never read by the Yaad Score. A named person invites from it.';

-- Candidates for the shortlist agent to choose among. The same bar as
-- match_workers_for_job (active, guidelines signed, trade or parish match)
-- minus the "not already alerted" exclusion, because a shortlist is built
-- before anybody is alerted. Carries the PUBLISHED profile text (about,
-- years, areas) because that is what the agent reads: the same words anybody
-- can read on /workers/<slug>, nothing from the application.
create or replace function public.shortlist_candidates_for_job(
  p_job   text,
  p_limit int default 12
)
returns table (
  worker_email   text,
  name           text,
  trade          text,
  parish         text,
  areas          text,
  lane           text,
  years          int,
  jobs_completed int,
  about          text,
  slug           text,
  match_reason   text,
  rank_score     int
)
language sql
stable
security definer
set search_path to 'public'
as $$
  with j as (
    select id,
           trade_key(trade)   as tk,
           parish_key(parish) as pk
      from jobs
     where id = p_job
  )
  select w.worker_email,
         w.name,
         w.trade,
         w.parish,
         w.areas,
         w.lane,
         w.years,
         w.jobs_completed,
         w.about,
         w.slug,
         case
           when trade_key(w.trade) = j.tk and parish_key(w.parish) = j.pk then 'trade and parish'
           when trade_key(w.trade) = j.tk then 'trade, different parish'
           else 'parish, related trade'
         end,
         (case when trade_key(w.trade)  = j.tk then 100 else 0 end)
       + (case when parish_key(w.parish) = j.pk then 50  else 0 end)
       + least(coalesce(w.jobs_completed, 0), 25)
    from worker_profiles w
    cross join j
   where w.active
     and coalesce(w.is_test, false) = false
     and coalesce(w.worker_email, '') <> ''
     and exists (
       select 1 from doc_signatures ds
        where ds.doc_type = 'worker_guidelines'
          and lower(ds.signer_email) = lower(w.worker_email)
          and (current_doc_version('worker_guidelines') is null
               or ds.doc_version = current_doc_version('worker_guidelines'))
     )
     and (trade_key(w.trade) = j.tk or parish_key(w.parish) = j.pk)
   order by 12 desc, w.jobs_completed desc nulls last, w.name
   limit greatest(1, least(p_limit, 30));
$$;

revoke all on function public.shortlist_candidates_for_job(text, int) from public, anon, authenticated;
grant execute on function public.shortlist_candidates_for_job(text, int) to service_role;

-- What the shortlist agent is allowed to read of the job: the description
-- exactly as the public board shows it. board_descr() strips the client's
-- name, email and phone; the address is never passed in. One wrapper so the
-- function needs no client columns at all to build its prompt.
create or replace function public.board_descr_for_job(p_job text)
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  select public.board_descr(j.descr, j.client_name, j.client_email, j.client_phone)
    from jobs j
   where j.id = p_job;
$$;
revoke all on function public.board_descr_for_job(text) from public, anon, authenticated;
grant execute on function public.board_descr_for_job(text) to service_role;

comment on function public.shortlist_candidates_for_job(text, int) is
  'Who the shortlist agent may choose among for a job, ranked on verifiable data only. Read-only. Sends nothing. Service role only: yaad-shortlist calls it.';

-- ── 3. the recommendation ──────────────────────────────────────────────────
alter table public.job_quotes
  add column if not exists recommended_at     timestamptz,
  add column if not exists recommended_by     text,
  add column if not exists recommended_reason text;

-- One recommended quote per job. The unique index is the guarantee, not the
-- function below.
create unique index if not exists job_quotes_one_recommended_per_job
  on public.job_quotes (job_id) where recommended_at is not null;

-- jq_update lets a worker edit their own submitted quote, and job_quotes_touch
-- is what stops that edit reaching the columns a worker must not own (whose
-- quote it is, and its status). The three recommendation columns join that
-- list, or a worker could recommend themselves with one PATCH. Same function
-- as live, three lines added; the yaadly.choosing handshake is unchanged.
create or replace function public.job_quotes_touch()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  new.updated_at = now();
  -- A worker (non-admin) can never change whose quote it is or move it into
  -- an admin-only state. choose_worker() is the one trusted exception,
  -- marked by a transaction-local flag it alone sets.
  if not public.is_admin()
     and coalesce(current_setting('yaadly.choosing', true), '') <> '1' then
    new.worker_user = old.worker_user;
    new.worker_email = old.worker_email;
    new.job_id = old.job_id;
    if new.status not in ('submitted','withdrawn') then
      new.status = old.status;
    end if;
    -- Added 9 Sep 2026: a recommendation is a named admin's decision.
    new.recommended_at     = old.recommended_at;
    new.recommended_by     = old.recommended_by;
    new.recommended_reason = old.recommended_reason;
  end if;
  return new;
end $function$;

-- Why a helper: jobs and job_quotes RLS looped into each other once
-- (20260901w), and job_client_email_matches is the security definer that
-- broke the loop. This is the same shape for the same reason.
create or replace function public.job_worker_choice(p_job text)
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce((select worker_choice from jobs where id = p_job), 'yaadly');
$$;
revoke all on function public.job_worker_choice(text) from public;
grant execute on function public.job_worker_choice(text) to anon, authenticated, service_role;

-- A quote a client may see. On a 'client' job, everything they could see
-- before. On a 'yaadly' job, a submitted quote only once it is recommended;
-- anything past submitted (confirmed, pack requested, accepted) can only
-- have got there through the client, so it stays visible.
create or replace function public.client_may_see_quote(p_job text, p_status text, p_recommended_at timestamptz)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select p_status <> 'submitted'
      or p_recommended_at is not null
      or public.job_worker_choice(p_job) = 'client';
$$;
revoke all on function public.client_may_see_quote(text, text, timestamptz) from public;
grant execute on function public.client_may_see_quote(text, text, timestamptz) to anon, authenticated, service_role;

drop policy if exists jq_select_client on public.job_quotes;
create policy jq_select_client on public.job_quotes
  for select using (
    status = any (array['submitted','quote_confirmed','kickoff_requested','accepted'])
    and job_client_email_matches(job_id, (auth.jwt() ->> 'email'))
    and public.client_may_see_quote(job_id, status, recommended_at)
  );

-- The named admin puts one price to the client.
create or replace function public.recommend_quote(p_quote uuid, p_reason text default null)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_quote public.job_quotes%rowtype;
  v_job   public.jobs%rowtype;
begin
  if not public.is_admin() then
    raise exception 'Only a signed-in admin may choose a tradesperson for a client.'
      using errcode = '28000';
  end if;

  select * into v_quote from public.job_quotes where id = p_quote for update;
  if v_quote.id is null then raise exception 'No such quote.'; end if;

  select * into v_job from public.jobs where id = v_quote.job_id for update;
  if v_job.id is null then raise exception 'No such job.'; end if;

  if v_job.worker_choice <> 'yaadly' then
    raise exception 'This client asked to choose for themselves. Every quote is already on their page; there is nothing to recommend.';
  end if;
  if coalesce(v_job.worker_email, '') <> '' then
    raise exception 'A worker is already chosen on this job.';
  end if;
  if v_quote.status <> 'submitted' then
    raise exception 'Only an open price can be put to the client. This one is %.', v_quote.status;
  end if;
  if exists (
    select 1 from public.job_quotes q
     where q.job_id = v_job.id and q.status in ('quote_confirmed', 'kickoff_requested')
  ) then
    raise exception 'The client has already agreed a price on this job. Talk to them before changing it.';
  end if;

  -- A change of mind is allowed until the client has agreed. The earlier
  -- recommendation is cleared, not kept: the unique index above permits one.
  update public.job_quotes
     set recommended_at = null, recommended_by = null, recommended_reason = null
   where job_id = v_job.id and id <> p_quote and recommended_at is not null;

  update public.job_quotes
     set recommended_at     = now(),
         recommended_by     = v_email,
         recommended_reason = nullif(btrim(coalesce(p_reason, '')), '')
   where id = p_quote;

  return v_job.id;
end;
$function$;

revoke all on function public.recommend_quote(uuid, text) from public, anon;
grant execute on function public.recommend_quote(uuid, text) to authenticated;

comment on function public.recommend_quote(uuid, text) is
  'A signed-in admin puts one open quote to the client of a yaadly-picks job, with their name and reason on it. Books nothing: the client still agrees the price and the worker still confirms theirs.';

-- The client can change their mind from the portal, until a worker is
-- booked. Switching to 'client' reveals every open quote; switching back to
-- 'yaadly' hides the un-recommended ones again. Neither touches a quote, an
-- agreement or a booking. The job form's own copy promises "you can change
-- your mind", and the portal is where that promise is kept without a
-- message to Yaadly.
create or replace function public.set_worker_choice_as_me(p_job text, p_choice text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_email text := lower(nullif(btrim(auth.jwt() ->> 'email'), ''));
  v_job   public.jobs%rowtype;
begin
  if v_email is null then
    raise exception 'Sign in to change who picks your tradesperson.' using errcode = '28000';
  end if;
  if p_choice not in ('yaadly', 'client') then
    raise exception 'Who picks must be yaadly or client.';
  end if;

  select * into v_job from public.jobs where id = p_job for update;
  if v_job.id is null then raise exception 'No such job.'; end if;
  if lower(coalesce(v_job.client_email, '')) <> v_email then
    raise exception 'Only the client of this job may change who picks.' using errcode = '28000';
  end if;
  if coalesce(v_job.worker_email, '') <> '' then
    raise exception 'A tradesperson is already booked on this job, so there is nobody left to pick.';
  end if;

  update public.jobs set worker_choice = p_choice, updated_at = now() where id = p_job;
  return p_choice;
end;
$function$;
revoke all on function public.set_worker_choice_as_me(text, text) from public, anon;
grant execute on function public.set_worker_choice_as_me(text, text) to authenticated;

comment on function public.set_worker_choice_as_me(text, text) is
  'The signed-in client of a job switches between Yaadly picking the tradesperson and choosing from the quotes themselves. Allowed until a worker is booked. Touches nothing else.';

-- ── 4. every client surface reads the same rule ────────────────────────────

-- The no-account quotes page. Same filter as the RLS policy, plus the three
-- recommendation columns so the page can say who chose and why.
drop function if exists public.quotes_for_code(text, text);
create function public.quotes_for_code(p_job text, p_code text)
returns table (
  id uuid, worker_name text, labour_jmd integer, materials_jmd integer,
  materials_at_cost boolean, earliest_start text, days_estimate text,
  note text, status text,
  scope_summary text, timeline_note text, payment_stage_note text,
  included_note text, excluded_note text,
  recommended_at timestamptz, recommended_by text, recommended_reason text
)
language sql security definer set search_path to 'public'
as $$
  select q.id, q.worker_name, q.labour_jmd, q.materials_jmd, q.materials_at_cost,
         q.earliest_start, q.days_estimate, q.note, q.status,
         q.scope_summary, q.timeline_note, q.payment_stage_note,
         q.included_note, q.excluded_note,
         q.recommended_at, q.recommended_by, q.recommended_reason
    from job_quotes q
    join jobs j on j.id = q.job_id
   where j.id = p_job and coalesce(j.portal_code,'') <> '' and j.portal_code = p_code
     and public.client_may_see_quote(q.job_id, q.status, q.recommended_at)
   order by q.created_at;
$$;
revoke all on function public.quotes_for_code(text, text) from public;
grant execute on function public.quotes_for_code(text, text) to anon, authenticated;

-- The job header on that page learns who picks, so it can say "Yaadly is
-- choosing" before any price is shown.
drop function if exists public.job_for_code(text, text);
create function public.job_for_code(p_job text, p_code text)
returns table (id text, title text, parish text, descr text, worker_email text, worker_choice text)
language sql security definer set search_path to 'public'
as $$
  select j.id, j.title, j.parish, j.descr, j.worker_email, j.worker_choice
    from jobs j
   where j.id = p_job and coalesce(j.portal_code,'') <> '' and j.portal_code = p_code;
$$;
revoke all on function public.job_for_code(text, text) from public;
grant execute on function public.job_for_code(text, text) to anon, authenticated;

-- "Reply JOB-123 to accept" from the client's phone. Live body from
-- 20260904f, with two changes in the client branch. Only a quote the client
-- may see counts as open, so on a yaadly-picks job with three quotes in, the
-- reply lands on the recommended one and not on "more than one price is
-- open". And the client's acceptance BOOKS: the worker's quote is their
-- agreement (founder, 9 Sep 2026), so the quote goes to quote_confirmed and
-- straight through _do_choose_worker in the same call. The worker branch is
-- kept so a worker who replies with the code is answered rather than
-- ignored; it records their agreement and changes nothing else, because
-- nothing else needs their reply now.
create or replace function public.agree_quote_via_whatsapp(p_job text, p_phone text)
returns table(agreed_side text, both_confirmed boolean, out_job_id text, out_quote_id uuid)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_job public.jobs%rowtype;
  v_quote public.job_quotes%rowtype;
  v_side text;
  v_email text;
  v_open_count integer;
  v_both boolean;
begin
  if length(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g')) < 9 then
    raise exception 'No usable phone number.';
  end if;

  select * into v_job from public.jobs where id = p_job;
  if v_job.id is null then
    raise exception 'No such job.';
  end if;

  if public.same_phone(v_job.client_phone, p_phone) then
    select count(*) into v_open_count
      from public.job_quotes q
     where q.job_id = p_job and q.status = 'submitted'
       and public.client_may_see_quote(q.job_id, q.status, q.recommended_at);
    if coalesce(v_open_count, 0) = 0 then
      if v_job.worker_choice = 'yaadly' then
        raise exception 'Yaadly is still choosing your tradesperson. You will get a message with one price to confirm.';
      end if;
      raise exception 'No open price on this job to confirm.';
    end if;
    if v_open_count > 1 then
      raise exception 'More than one price is open on this job. Say which worker you mean.';
    end if;
    select * into v_quote
      from public.job_quotes q
     where q.job_id = p_job and q.status = 'submitted'
       and public.client_may_see_quote(q.job_id, q.status, q.recommended_at);
    v_side := 'client';
    v_email := lower(coalesce(v_job.client_email, ''));
  else
    select q.* into v_quote
      from public.job_quotes q
      join public.worker_profiles wp on lower(wp.worker_email) = lower(q.worker_email)
     where q.job_id = p_job and q.status = 'submitted'
       and public.same_phone(wp.phone, p_phone);
    if v_quote.id is null then
      raise exception 'No open price on this job is waiting on your confirmation.';
    end if;
    v_side := 'worker';
    v_email := lower(v_quote.worker_email);
  end if;

  insert into public.quote_agreements (quote_id, side, email)
  values (v_quote.id, v_side, v_email)
  on conflict (quote_id, side) do nothing;

  if v_side = 'client' then
    -- The client's word books it. quote_confirmed first, because that is
    -- the state _do_choose_worker accepts, then the booking itself, which
    -- locks the job row and refuses if somebody is already on it.
    perform set_config('yaadly.choosing', '1', true);
    update public.job_quotes set status = 'quote_confirmed', updated_at = now() where id = v_quote.id;
    perform set_config('yaadly.choosing', '', true);
    perform public._do_choose_worker(p_job, v_quote.id);
    v_both := true;
  else
    v_both := false;
  end if;

  return query select v_side, v_both, p_job, v_quote.id;
end;
$function$;
revoke all on function public.agree_quote_via_whatsapp(text, text) from anon, authenticated, public;
grant execute on function public.agree_quote_via_whatsapp(text, text) to service_role;

-- The portal's own "accept this price" door. Two changes from 20260906000200:
-- it refuses a quote the client cannot see (RLS already hides it from the
-- page, but a quote id in a URL is not a page, and the same rule has to hold
-- at the function), and the client's acceptance books, same as the WhatsApp
-- door above, because the worker's quote is their agreement.
create or replace function public.agree_quote_as_me(p_quote uuid)
returns table(agreed_side text, both_confirmed boolean, job_id text, quote_id uuid)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_email text := lower(nullif(btrim(auth.jwt() ->> 'email'), ''));
  v_quote public.job_quotes%rowtype;
  v_job   public.jobs%rowtype;
  v_side  text;
  v_both  boolean;
begin
  if v_email is null then
    raise exception 'Sign in to confirm a price.' using errcode = '28000';
  end if;

  select * into v_quote from public.job_quotes where id = p_quote;
  if v_quote.id is null then
    raise exception 'No such price.';
  end if;

  if v_quote.status <> 'submitted' then
    raise exception 'That price is not open for confirmation.';
  end if;

  select * into v_job from public.jobs where id = v_quote.job_id;
  if v_job.id is null then
    raise exception 'No such job.';
  end if;

  if v_email = lower(coalesce(v_job.client_email, '')) then
    v_side := 'client';
    -- 9 Sep 2026: on a yaadly-picks job the client confirms the price that
    -- was put to them, not one they found by id.
    if not public.client_may_see_quote(v_quote.job_id, v_quote.status, v_quote.recommended_at) then
      raise exception 'Yaadly is still choosing your tradesperson. The price to confirm will be on your page once a person has chosen.';
    end if;
  elsif v_email = lower(coalesce(v_quote.worker_email, '')) then
    v_side := 'worker';
  else
    raise exception 'Only the client of this job or the worker who quoted it may confirm this price.'
      using errcode = '28000';
  end if;

  insert into public.quote_agreements (quote_id, side, email)
  values (v_quote.id, v_side, v_email)
  on conflict (quote_id, side) do nothing;

  if v_side = 'client' then
    perform set_config('yaadly.choosing', '1', true);
    update public.job_quotes set status = 'quote_confirmed', updated_at = now() where id = v_quote.id;
    perform set_config('yaadly.choosing', '', true);
    perform public._do_choose_worker(v_job.id, v_quote.id);
    v_both := true;
  else
    v_both := false;
  end if;

  return query select v_side, v_both, v_job.id, v_quote.id;
end;
$function$;
revoke all on function public.agree_quote_as_me(uuid) from public, anon;
grant execute on function public.agree_quote_as_me(uuid) to authenticated;

comment on function public.agree_quote_as_me(uuid) is
  'The signed-in client accepts an open price and that books the job (founder, 9 Sep 2026: the worker''s quote is their agreement). Refuses a quote the client may not see. A worker calling it records their agreement and nothing else.';

-- The worker is no longer asked to reply and confirm their own price. The
-- trigger that sent that message is dropped; the notify kind it used stays
-- in yaad-notify-client so an in-flight call does not fail, but nothing
-- fires it now. What the worker hears instead is that they are booked, from
-- the trigger below.
drop trigger if exists trg_notify_worker_quote_confirm on public.job_quotes;

-- ── both sides hear they are booked ────────────────────────────────────────
-- yaad-notify-client has carried a quote_accepted message since 31 August,
-- and its own comment says it fires "from the jobs row itself the moment
-- worker_email is first set". Read live on 9 September 2026: no trigger on
-- jobs sends it, and nothing at all tells the worker. Neither side has ever
-- been told a booking happened by the system. That mattered less while the
-- worker confirmed their price by hand; it matters now, so this adds the
-- trigger the comment described, and a worker kind beside it.
create or replace function public.notify_on_booking()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
    begin
      if coalesce(new.worker_email, '') <> '' and coalesce(old.worker_email, '') = '' then
        perform net.http_post(
          url := 'https://leffyisvfvjwzilydlwf.supabase.co/functions/v1/yaad-notify-client',
          body := jsonb_build_object('secret', public.notify_trigger_secret(), 'jobId', new.id, 'kind', 'quote_accepted'),
          headers := jsonb_build_object('Content-Type','application/json','apikey','sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz','Authorization','Bearer '||'sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz'),
          timeout_milliseconds := 15000
        );
        perform net.http_post(
          url := 'https://leffyisvfvjwzilydlwf.supabase.co/functions/v1/yaad-notify-client',
          body := jsonb_build_object('secret', public.notify_trigger_secret(), 'jobId', new.id, 'kind', 'booked_worker'),
          headers := jsonb_build_object('Content-Type','application/json','apikey','sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz','Authorization','Bearer '||'sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz'),
          timeout_milliseconds := 15000
        );
      end if;
      return new;
    end;
$function$;

drop trigger if exists trg_notify_on_booking on public.jobs;
create trigger trg_notify_on_booking
  after update of worker_email on public.jobs
  for each row execute function public.notify_on_booking();

-- ── the client hears at the right moment ───────────────────────────────────
-- On a 'client' job the client is told the moment a quote lands, as before.
-- On a 'yaadly' job that message would show them a price they cannot open,
-- so it waits: the client is told when a person recommends one. Same
-- shared-secret-from-the-vault shape as 20260903a, body copied from live.
create or replace function public.notify_client_quote_arrived()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
    begin
      if new.status = 'submitted' and public.job_worker_choice(new.job_id) = 'client' then
        perform net.http_post(
          url := 'https://leffyisvfvjwzilydlwf.supabase.co/functions/v1/yaad-notify-client',
          body := jsonb_build_object('secret', public.notify_trigger_secret(), 'jobId', new.job_id, 'kind', 'quote_arrived'),
          headers := jsonb_build_object('Content-Type','application/json','apikey','sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz','Authorization','Bearer '||'sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz'),
          timeout_milliseconds := 15000
        );
      end if;
      return new;
    end;
$function$;

create or replace function public.notify_client_quote_recommended()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
    begin
      if new.recommended_at is not null and old.recommended_at is null then
        perform net.http_post(
          url := 'https://leffyisvfvjwzilydlwf.supabase.co/functions/v1/yaad-notify-client',
          body := jsonb_build_object('secret', public.notify_trigger_secret(), 'jobId', new.job_id, 'kind', 'quote_recommended', 'meta', jsonb_build_object('quoteId', new.id)),
          headers := jsonb_build_object('Content-Type','application/json','apikey','sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz','Authorization','Bearer '||'sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz'),
          timeout_milliseconds := 15000
        );
      end if;
      return new;
    end;
$function$;

drop trigger if exists trg_notify_quote_recommended on public.job_quotes;
create trigger trg_notify_quote_recommended
  after update of recommended_at on public.job_quotes
  for each row execute function public.notify_client_quote_recommended();

commit;
