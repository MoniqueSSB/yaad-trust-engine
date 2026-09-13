-- A client can ask for a change to a quote before accepting it.
-- Founder instruction, 13 September 2026: "there should be a section where
-- the client can respond on a quote and ask for a revision if needed".
--
-- Until now a client had two moves on an open quote: accept it, or ignore it.
-- Messages on a job only open once a worker is booked, so "can the price
-- include the whole rail?" had nowhere to go except off the platform.
--
-- This is PIECE 1 of three, and only the client's side:
--
--   1. (this file) the client writes what they want changed; the request is
--      saved against that one quote, with a copy of the quote as it stood,
--      so there is a record of what was asked and what it was asked of.
--   2. (next) the worker is told, and answers: update the quote, or keep it
--      as it is. The worker is allowed to say no (the Mirror Rule).
--   3. (after) a revised quote that Yaadly had chosen loses "chosen by
--      Yaadly" and goes back to the desk, so a named person puts the new
--      price to the client, never the old recommendation on a new number.
--
-- Founder decisions, 13 Sep 2026: on a "Choose for me" job the request goes
-- STRAIGHT TO THE WORKER, not to the desk first (the desk reads a copy); and
-- a revised quote Yaadly had chosen is RE-CHOSEN by a person (piece 3).
--
-- What asking does NOT do: it changes nothing on the quote. The quote stays
-- 'submitted' and the client can still accept it as it stands. Asking is not
-- committing, and it is not a hold on the job either.
--
-- Writes only through request_quote_change_as_me(), which runs the same
-- checks as agree_quote_as_me(): signed in, this job's client, the job not
-- yet booked, the quote still open, and the quote one the client may see.
-- The browser has read access only, and only to its own rows.
--
-- Applied to production: not yet. Waiting on Monique's "apply".

begin;

create table public.quote_change_requests (
  id            uuid primary key default gen_random_uuid(),
  quote_id      uuid not null references public.job_quotes(id) on delete cascade,
  job_id        text not null references public.jobs(id) on delete cascade,
  requested_by  text not null,
  request_text  text not null check (char_length(btrim(request_text)) between 1 and 1500),
  -- The quote as it stood when the change was asked for. Piece 2 shows the
  -- client "was / now" from this, so a revision never changes quietly.
  quote_before  jsonb not null,
  status        text not null default 'open'
                check (status in ('open', 'revised', 'kept', 'withdrawn')),
  worker_reply  text,
  answered_at   timestamptz,
  created_at    timestamptz not null default now()
);

comment on table public.quote_change_requests is
  'A client asking for a change to one open quote, before accepting it. Written only by request_quote_change_as_me(). Read by the job''s client, the worker who quoted, and admins.';

-- One open request per quote. A second "can you also..." waits for the first
-- to be answered, so the worker is never revising against two lists at once.
create unique index quote_change_requests_one_open_per_quote
  on public.quote_change_requests (quote_id) where status = 'open';
create index quote_change_requests_job on public.quote_change_requests (job_id);

alter table public.quote_change_requests enable row level security;

create policy "admin full quote change requests" on public.quote_change_requests
  for all using (public.is_admin()) with check (public.is_admin());

-- The client of the job, or the worker whose quote it is. The client check is
-- the security-definer helper the rest of the schema uses, so this policy
-- never reads jobs through jobs' own RLS (the loop fixed in 20260901).
create policy "parties read quote change requests" on public.quote_change_requests
  for select using (
    public.job_client_email_matches(job_id, auth.jwt() ->> 'email')
    or exists (
      select 1 from public.job_quotes q
       where q.id = quote_change_requests.quote_id
         and lower(coalesce(q.worker_email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
    )
  );

-- Read only from the browser. No insert, update or delete policy exists, so
-- RLS already refuses them; revoking the privilege as well means a policy
-- added carelessly later still cannot open a write path on its own.
revoke insert, update, delete, truncate on public.quote_change_requests from anon, authenticated;
revoke all on public.quote_change_requests from anon;
grant select on public.quote_change_requests to authenticated;

create or replace function public.request_quote_change_as_me(p_quote uuid, p_text text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_email text := lower(nullif(btrim(auth.jwt() ->> 'email'), ''));
  v_text  text := btrim(coalesce(p_text, ''));
  v_quote public.job_quotes%rowtype;
  v_job   public.jobs%rowtype;
  v_id    uuid;
begin
  if v_email is null then
    raise exception 'Sign in to ask for a change.' using errcode = '28000';
  end if;

  if v_text = '' then
    raise exception 'Say what you would like changed.';
  end if;
  if char_length(v_text) > 1500 then
    raise exception 'Keep it under 1,500 characters.';
  end if;

  select * into v_quote from public.job_quotes where id = p_quote;
  if v_quote.id is null then
    raise exception 'No such price.';
  end if;

  select * into v_job from public.jobs where id = v_quote.job_id;
  if v_job.id is null then
    raise exception 'No such job.';
  end if;

  if v_email <> lower(coalesce(v_job.client_email, '')) then
    raise exception 'Only the client of this job can ask for a change to its quote.'
      using errcode = '28000';
  end if;

  -- Once booked, a change is a variation to agreed work and agreed money.
  -- That is a different conversation and deliberately not this one.
  if v_job.worker_email is not null then
    raise exception 'This job is already booked. Message Yaadly about any change to it.';
  end if;

  if v_quote.status <> 'submitted' then
    raise exception 'That price is not open for changes.';
  end if;

  if not public.client_may_see_quote(v_quote.job_id, v_quote.status, v_quote.recommended_at) then
    raise exception 'Yaadly is still choosing your tradesperson. The price will be on your page once a person has chosen.';
  end if;

  if exists (
    select 1 from public.quote_change_requests r
     where r.quote_id = v_quote.id and r.status = 'open'
  ) then
    raise exception 'You have already asked for a change to this quote. It is waiting on the tradesperson.';
  end if;

  insert into public.quote_change_requests (quote_id, job_id, requested_by, request_text, quote_before)
  values (
    v_quote.id, v_job.id, v_email, v_text,
    jsonb_build_object(
      'labour_jmd',         v_quote.labour_jmd,
      'materials_jmd',      v_quote.materials_jmd,
      'earliest_start',     v_quote.earliest_start,
      'days_estimate',      v_quote.days_estimate,
      'note',               v_quote.note,
      'scope_summary',      v_quote.scope_summary,
      'included_note',      v_quote.included_note,
      'excluded_note',      v_quote.excluded_note,
      'timeline_note',      v_quote.timeline_note,
      'payment_stage_note', v_quote.payment_stage_note,
      'recommended_at',     v_quote.recommended_at
    )
  )
  returning id into v_id;

  return v_id;
end;
$function$;

revoke all on function public.request_quote_change_as_me(uuid, text) from public, anon;
grant execute on function public.request_quote_change_as_me(uuid, text) to authenticated;

comment on function public.request_quote_change_as_me(uuid, text) is
  'The signed-in client of a job asks for a change to one open quote before accepting it. Changes nothing on the quote; records the request and a copy of the quote as it stood.';

commit;
