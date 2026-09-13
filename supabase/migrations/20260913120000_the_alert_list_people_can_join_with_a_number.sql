-- RENAMED 13 September 2026, content unchanged. Written and applied to
-- production on 6 September 2026 as 20260906223046. Main gained nine migrations in the
-- meantime, and scripts/check-migration-order.mjs requires a new file to sort
-- after every migration already on the base branch, so the filename moved and
-- nothing else did. Applying it again is safe: every statement is CREATE OR
-- REPLACE, IF NOT EXISTS, or an idempotent update.

-- The alert list, and the four doors into it.
--
-- WHAT THIS IS FOR. Until now "who hears about a new job" was not a list at
-- all, it was a query: match_workers_for_job() reads worker_profiles and
-- returns only people who are active, published, and have signed the current
-- Worker Guidelines. There was no way to be told about work without first
-- being fully vetted, and no way at all to put yourself forward.
--
-- Founder's decision, 6 September 2026: anyone may join the alert list with a
-- phone number. Only a vetted worker may quote. The alert to somebody who has
-- not finished joining is deliberately a recruitment message, not an
-- invitation to the job, and that difference is carried by can_quote below so
-- the sending code reads one column instead of re-deriving the gate.
--
-- WHY A SEPARATE TABLE. worker_profiles is the vetted supply. Putting
-- strangers in it to hold a phone number would mean every query that means
-- "our workers" has to start remembering to exclude them, and one that forgets
-- puts an unvetted name in front of a client. The list lives on its own.
--
-- WHY worker_email IS NOT A COLUMN HERE. A subscriber can become a vetted
-- worker weeks later. A stored link would be right on the day it was written
-- and wrong afterwards, which is the drift this repository keeps getting bitten
-- by. It is resolved live in v_job_alert_subscribers instead, on same_phone(),
-- which is not indexable and does not need to be: this is a list of dozens.
--
-- NOTHING HERE SENDS ANYTHING. There is no alerting in this migration and none
-- in the WhatsApp lane that calls it. Joining is built cold on purpose, so a
-- mistake in matching cannot message the list while it is being found.

-- ── 1. the list ──────────────────────────────────────────────────────────
create table if not exists public.job_alert_subscribers (
  id              uuid primary key default gen_random_uuid(),

  -- Digits only, no leading +, the same shape worker_profiles.phone holds.
  -- Twilio only ever delivers E.164, so every real row here is 11 or more.
  phone           text not null check (phone ~ '^[0-9]{9,}$'),
  name            text,

  -- Two columns per side on purpose. trades/parishes is what they actually
  -- said, kept in their words so the desk can see when the normaliser read
  -- somebody wrongly. trade_keys/parish_keys is what matching will use.
  trades          text[] not null default '{}',
  trade_keys      text[] not null default '{}',
  parishes        text[] not null default '{}',
  parish_keys     text[] not null default '{}',

  -- Consent is the inbound message itself: they wrote to us first. Meta wants
  -- to see that, and the exact words are the only version of it worth having.
  -- consent_version moves with the wording of the reply that earned it, the
  -- same rule AI_CONSENT_VERSION follows in JoinFlow.tsx: a consent is only
  -- worth the sentence that earned it.
  consent_version text not null,
  consent_words   text,
  consent_at      timestamptz not null default now(),
  source          text not null default 'whatsapp',

  stopped_at      timestamptz,

  -- Derived, never written, so "are they actually going to be told anything"
  -- cannot drift from the three facts that decide it. Somebody who joined but
  -- has not said a trade and a parish yet is on the list and hears nothing,
  -- which is the honest state and not an error.
  listening       boolean generated always as (
                    stopped_at is null
                    and coalesce(array_length(trade_keys, 1), 0) > 0
                    and coalesce(array_length(parish_keys, 1), 0) > 0
                  ) stored,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create unique index if not exists job_alert_subscribers_phone
  on public.job_alert_subscribers (phone);

create index if not exists job_alert_subscribers_trades
  on public.job_alert_subscribers using gin (trade_keys) where listening;

create index if not exists job_alert_subscribers_parishes
  on public.job_alert_subscribers using gin (parish_keys) where listening;

comment on table public.job_alert_subscribers is
  'Anybody who asked to hear when a job opens. Not the vetted supply: being on this list is permission to be told, never permission to quote. Joined over WhatsApp, where the inbound message is the proof of both the number and the consent.';
comment on column public.job_alert_subscribers.listening is
  'Generated. Not stopped, and has said at least one trade and at least one parish. Somebody who joined and said neither is on the list and correctly hears nothing.';

alter table public.job_alert_subscribers enable row level security;

-- The desk, and nothing else. Subscribers have no account to sign in with, so
-- there is no self-read policy to write. Every write goes through the security
-- definer functions below, called by yaad-inbound on the service role.
drop policy if exists jas_admin_all on public.job_alert_subscribers;
create policy jas_admin_all on public.job_alert_subscribers
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());


-- ── 2. what counts as a trade or a parish we can actually route on ───────
-- A key that is not in these sets still gets stored, because a person who says
-- "swimming pools" said something true about themselves. It just cannot ever
-- match a job, and the joining flow says so to their face rather than letting
-- them sit on a list waiting for work that will never arrive.

create or replace function public.job_alert_trade_keys()
returns text[]
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(array_agg(distinct trade_key(t)), '{}')
    from unnest(string_to_array(
           coalesce((select value from app_settings where key = 'trade_list'), ''), ',')) as t
   where trade_key(t) is not null;
$$;

comment on function public.job_alert_trade_keys() is
  'The trade keys a job can actually be routed on, derived from app_settings.trade_list rather than written out again. Note that the eighteen names collapse to thirteen keys: Solar Install and Water Tank & Pump and Drainage & Septic all land on other trades. That is trade_key()''s behaviour, recorded here rather than worked around.';

-- Off the open internet in the same breath that created it. PostgREST
-- publishes every public function the caller's role may execute, and
-- Supabase grants EXECUTE to anon and authenticated by default, so a new
-- function is reachable at /rest/v1/rpc/<name> until this runs. RUNBOOK §17.
revoke all on function public.job_alert_trade_keys() from public, anon, authenticated;
grant execute on function public.job_alert_trade_keys() to service_role;

create or replace function public.job_alert_parish_keys()
returns text[]
language sql
immutable
set search_path to 'public'
as $$
  -- The fourteen parishes of Jamaica, which are a geographic fact rather than
  -- a configuration value. parish_key() already spells them out; this is the
  -- same list read the other way round.
  select array['kingston','st andrew','st catherine','clarendon','manchester',
               'st elizabeth','westmoreland','hanover','st james','trelawny',
               'st ann','st mary','portland','st thomas']::text[];
$$;


-- Off the open internet in the same breath that created it. PostgREST
-- publishes every public function the caller's role may execute, and
-- Supabase grants EXECUTE to anon and authenticated by default, so a new
-- function is reachable at /rest/v1/rpc/<name> until this runs. RUNBOOK §17.
revoke all on function public.job_alert_parish_keys() from public, anon, authenticated;
grant execute on function public.job_alert_parish_keys() to service_role;


-- ── 3. reading a sentence a tradesperson typed ───────────────────────────
-- They are on a phone. They will write "plumbing, tiling and a bit of
-- masonry", not tick eighteen boxes. Split on the separators a person actually
-- uses, then hand each piece to the SAME normaliser the matcher uses, so what
-- they said and what matches can never be two different code paths.
--
-- Deliberately does not split on "&": "Grille & Gate Welding" is one trade.
--
-- The word boundary is \y, not \b. Postgres regular expressions are not Perl
-- ones: \b there means a literal backspace character, so an earlier \band\b
-- silently matched nothing at all and "tiling and a likkle bit of masonry"
-- stayed one lump, collapsing to tiling alone with the masonry thrown away.
-- Caught on the live rig before this ever ran for anybody, 6 Sep 2026.

create or replace function public.job_alert_split(p_said text)
returns text[]
language sql
immutable
set search_path to 'public'
as $$
  -- WITH ORDINALITY, and first mention wins, so what comes back is their own
  -- list in their own order. The confirmation message reads it back to them,
  -- and a jumbled read-back looks like the machine misheard.
  select coalesce(array_agg(s.x order by s.ord), '{}')
    from (
      select btrim(regexp_replace(w, '^(and|also|plus)\s+', '', 'i')) as x,
             min(ord) as ord
        from unnest(regexp_split_to_array(
               coalesce(p_said, ''), '\s*(,|;|/|\n|\r|\yand\y)\s*', 'i'))
             with ordinality as u(w, ord)
       group by 1
    ) s
   where length(s.x) between 2 and 60;
$$;


-- Off the open internet in the same breath that created it. PostgREST
-- publishes every public function the caller's role may execute, and
-- Supabase grants EXECUTE to anon and authenticated by default, so a new
-- function is reachable at /rest/v1/rpc/<name> until this runs. RUNBOOK §17.
revoke all on function public.job_alert_split(text) from public, anon, authenticated;
grant execute on function public.job_alert_split(text) to service_role;


-- ── 4. the four doors ────────────────────────────────────────────────────
-- All security definer, all granted to service_role alone. The only caller is
-- yaad-inbound, after Twilio's signature has been checked, and the number they
-- act on is the number the message came from. There is no way to put somebody
-- else on this list, and no way to take somebody else off it.

create or replace function public.subscribe_to_job_alerts(
  p_phone   text,
  p_words   text,
  p_version text,
  p_name    text default null
)
returns table (already boolean, listening boolean, trades text[], parishes text[])
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_digits text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_had    boolean;
begin
  if length(v_digits) < 9 then
    raise exception 'No usable phone number.' using errcode = 'check_violation';
  end if;
  if coalesce(btrim(p_version), '') = '' then
    raise exception 'A consent needs the version of the wording that earned it.' using errcode = 'check_violation';
  end if;

  select true into v_had from job_alert_subscribers where phone = v_digits;

  insert into job_alert_subscribers (phone, name, consent_version, consent_words, source)
  values (v_digits, nullif(btrim(coalesce(p_name, '')), ''), btrim(p_version), left(coalesce(p_words, ''), 500), 'whatsapp')
  on conflict (phone) do update
     set stopped_at      = null,
         -- Coming back after a stop is a new consent, to whatever the wording
         -- says today. Keeping the old version would let a stale sentence
         -- stand as agreement to a newer one.
         consent_version = excluded.consent_version,
         consent_words   = excluded.consent_words,
         consent_at      = now(),
         name            = coalesce(excluded.name, job_alert_subscribers.name),
         updated_at      = now();

  return query
    select coalesce(v_had, false), s.listening, s.trades, s.parishes
      from job_alert_subscribers s where s.phone = v_digits;
end;
$$;

comment on function public.subscribe_to_job_alerts(text,text,text,text) is
  'Put the number that sent us a message on the alert list, recording their own words as the consent. Returns whether they were already on it. Sends nothing.';

-- Off the open internet in the same breath that created it. PostgREST
-- publishes every public function the caller's role may execute, and
-- Supabase grants EXECUTE to anon and authenticated by default, so a new
-- function is reachable at /rest/v1/rpc/<name> until this runs. RUNBOOK §17.
revoke all on function public.subscribe_to_job_alerts(text,text,text,text) from public, anon, authenticated;
grant execute on function public.subscribe_to_job_alerts(text,text,text,text) to service_role;


-- Trades and parishes are the same operation twice, and are deliberately two
-- functions rather than one with a "which side" argument: the two sets they
-- validate against are different, and a single function would take the set as
-- a parameter, which is how you eventually pass the wrong one.
create or replace function public.set_job_alert_trades(p_phone text, p_said text)
returns table (matched text[], unmatched text[], listening boolean)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_digits text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_said   text[] := job_alert_split(p_said);
  v_known  text[] := job_alert_trade_keys();
  v_ok     text[] := '{}';
  v_no     text[] := '{}';
  v_keys   text[] := '{}';
  w        text;
begin
  foreach w in array v_said loop
    if trade_key(w) = any (v_known) then
      v_ok   := v_ok   || w;
      v_keys := v_keys || trade_key(w);
    else
      v_no := v_no || w;
    end if;
    exit when cardinality(v_ok) >= 12;
  end loop;

  -- Nothing recognised means nothing is written. A list that quietly emptied
  -- itself because somebody typed one word we did not know is worse than a
  -- second question.
  if cardinality(v_ok) = 0 then
    return query select v_ok, v_no, coalesce((select s.listening from job_alert_subscribers s where s.phone = v_digits), false);
    return;
  end if;

  update job_alert_subscribers
     set trades = v_ok,
         trade_keys = (select coalesce(array_agg(distinct k), '{}') from unnest(v_keys) as k),
         updated_at = now()
   where phone = v_digits;

  if not found then
    raise exception 'That number is not on the alert list.' using errcode = '28000';
  end if;

  return query select v_ok, v_no, s.listening from job_alert_subscribers s where s.phone = v_digits;
end;
$$;


-- Off the open internet in the same breath that created it. PostgREST
-- publishes every public function the caller's role may execute, and
-- Supabase grants EXECUTE to anon and authenticated by default, so a new
-- function is reachable at /rest/v1/rpc/<name> until this runs. RUNBOOK §17.
revoke all on function public.set_job_alert_trades(text,text) from public, anon, authenticated;
grant execute on function public.set_job_alert_trades(text,text) to service_role;

create or replace function public.set_job_alert_parishes(p_phone text, p_said text)
returns table (matched text[], unmatched text[], listening boolean)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_digits text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_said   text[] := job_alert_split(p_said);
  v_known  text[] := job_alert_parish_keys();
  v_ok     text[] := '{}';
  v_no     text[] := '{}';
  v_keys   text[] := '{}';
  w        text;
begin
  -- "Anywhere" is a real answer from a tradesperson who travels, and making
  -- them type fourteen parish names to say it is how you get four.
  if coalesce(p_said, '') ~* '\m(all|anywhere|island ?wide|whole island|everywhere)\M' then
    v_keys := v_known;
    v_ok   := array['Anywhere in Jamaica'];
  else
    foreach w in array v_said loop
      if parish_key(w) = any (v_known) then
        v_ok   := v_ok   || w;
        v_keys := v_keys || parish_key(w);
      else
        v_no := v_no || w;
      end if;
      exit when cardinality(v_ok) >= 14;
    end loop;
  end if;

  if cardinality(v_ok) = 0 then
    return query select v_ok, v_no, coalesce((select s.listening from job_alert_subscribers s where s.phone = v_digits), false);
    return;
  end if;

  update job_alert_subscribers
     set parishes = v_ok,
         parish_keys = (select coalesce(array_agg(distinct k), '{}') from unnest(v_keys) as k),
         updated_at = now()
   where phone = v_digits;

  if not found then
    raise exception 'That number is not on the alert list.' using errcode = '28000';
  end if;

  return query select v_ok, v_no, s.listening from job_alert_subscribers s where s.phone = v_digits;
end;
$$;



-- Off the open internet in the same breath that created it. PostgREST
-- publishes every public function the caller's role may execute, and
-- Supabase grants EXECUTE to anon and authenticated by default, so a new
-- function is reachable at /rest/v1/rpc/<name> until this runs. RUNBOOK §17.
revoke all on function public.set_job_alert_parishes(text,text) from public, anon, authenticated;
grant execute on function public.set_job_alert_parishes(text,text) to service_role;

-- Stopping is not a deletion. The row stays, with the time it stopped on it,
-- because "did this person ever ask us to stop" is a question you have to be
-- able to answer years later, and a deleted row answers it with silence.
create or replace function public.stop_job_alerts(p_phone text)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_digits text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
begin
  update job_alert_subscribers
     set stopped_at = coalesce(stopped_at, now()),
         updated_at = now()
   where phone = v_digits;
  return found;
end;
$$;

-- Off the open internet in the same breath that created it. PostgREST
-- publishes every public function the caller's role may execute, and
-- Supabase grants EXECUTE to anon and authenticated by default, so a new
-- function is reachable at /rest/v1/rpc/<name> until this runs. RUNBOOK §17.
revoke all on function public.stop_job_alerts(text) from public, anon, authenticated;
grant execute on function public.stop_job_alerts(text) to service_role;


-- ── 5. what the desk reads ───────────────────────────────────────────────
-- can_quote is the whole point of the founder's decision made readable: it is
-- the SAME gate match_workers_for_job() applies, which is active profile plus
-- a signature on the current Worker Guidelines. Anybody false here is a lead,
-- and the alert they will eventually get has to say so rather than inviting
-- them to a job they cannot take.
-- security_invoker so the caller's own rights and RLS still apply underneath.
-- Without it a view runs as its OWNER and row level security never gets a look
-- at it, which is 20260829a's finding exactly. This one carries phone numbers,
-- so a view granted to authenticated and running as its owner would hand the
-- whole list to any signed-in client.
create or replace view public.v_job_alert_subscribers
with (security_invoker = true) as
  select s.id,
         s.phone,
         s.name,
         s.trades,
         s.parishes,
         s.listening,
         s.stopped_at,
         s.consent_version,
         s.consent_at,
         s.source,
         s.created_at,
         s.updated_at,
         w.worker_email,
         coalesce(w.can_quote, false) as can_quote
    from job_alert_subscribers s
    left join lateral (
      select p.worker_email,
             (p.active and exists (
                select 1 from doc_signatures ds
                 where ds.doc_type = 'worker_guidelines'
                   and lower(ds.signer_email) = lower(p.worker_email)
                   and (current_doc_version('worker_guidelines') is null
                        or ds.doc_version = current_doc_version('worker_guidelines'))
             )) as can_quote
        from worker_profiles p
       where same_phone(p.phone, s.phone)
       limit 1
    ) w on true;

comment on view public.v_job_alert_subscribers is
  'The alert list as the desk reads it, with the vetting gate resolved live rather than stored. can_quote false is a lead, not a fault.';

-- A view is read-only to the browser by the same rule 20260903g set.
revoke all on public.v_job_alert_subscribers from anon, authenticated;
grant select on public.v_job_alert_subscribers to authenticated;
