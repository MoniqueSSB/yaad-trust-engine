-- =====================================================================
-- yaad-match — matching + alerting groundwork
-- Written 26 Aug 2026 against the live schema of leffyisvfvjwzilydlwf.
-- Safe to run once. Every statement is IF NOT EXISTS / OR REPLACE.
-- Read the BLOCKER note at the top before running.
-- =====================================================================

-- ---------------------------------------------------------------------
-- BLOCKER, and the reason this migration exists at all:
-- `jobs` has no trade column. It has title, descr, parish, worker_lane,
-- pack_tier — no trade. So "match on trade + parish" cannot be written
-- as SQL today. This adds it, nullable, so nothing existing breaks.
-- yaad-website-intake must start writing it, and the two existing rows
-- need backfilling by hand (see the bottom of this file).
-- ---------------------------------------------------------------------
alter table public.jobs add column if not exists trade text;

comment on column public.jobs.trade is
  'Trade key for matching. Set by yaad-website-intake from the wizard. Free text in, trade_key() normalises for matching.';


-- ---------------------------------------------------------------------
-- 1. Normalisers
-- Parish and trade are free text on both sides and they do not agree.
-- Live values already include "St Catherine", "Portmore (St. Catherine)",
-- "Kingston 8 — Barbican" and "Barbican, Kingston 8". A plain
-- jobs.parish = worker_profiles.parish join matches almost nothing.
-- Both functions are IMMUTABLE so they can be indexed.
-- ---------------------------------------------------------------------
create or replace function public.parish_key(p text)
returns text
language sql
immutable
parallel safe
as $$
  select case
    when p is null or btrim(p) = '' then null
    when lower(p) ~ '(portmore|old harbour|spanish town|st\.?\s*catherine|saint catherine|braeton|greater portmore|linstead|bog walk)' then 'st catherine'
    when lower(p) ~ '(barbican|liguanea|half\s*way\s*tree|stony hill|constant spring|papine|mona|red hills|havendale|st\.?\s*andrew|saint andrew|kingston\s*(5|6|7|8|9|10|19|20))' then 'st andrew'
    when lower(p) ~ '(kingston\s*(1|2|3|4|11|12|13|14|15|16|17|18)|downtown kingston)' then 'kingston'
    when lower(p) ~ '(mobay|montego bay|st\.?\s*james|saint james)' then 'st james'
    when lower(p) ~ '(ocho rios|runaway bay|st\.?\s*ann|saint ann)' then 'st ann'
    when lower(p) ~ '(mandeville|manchester)' then 'manchester'
    when lower(p) ~ '(may pen|clarendon)' then 'clarendon'
    when lower(p) ~ '(morant bay|st\.?\s*thomas|saint thomas)' then 'st thomas'
    when lower(p) ~ '(port antonio|portland)' then 'portland'
    when lower(p) ~ '(port maria|oracabessa|st\.?\s*mary|saint mary)' then 'st mary'
    when lower(p) ~ '(falmouth|trelawny)' then 'trelawny'
    when lower(p) ~ '(lucea|hanover)' then 'hanover'
    when lower(p) ~ '(negril|sav-?la-?mar|savanna-?la-?mar|westmoreland)' then 'westmoreland'
    when lower(p) ~ '(black river|st\.?\s*elizabeth|saint elizabeth|santa cruz|junction)' then 'st elizabeth'
    when lower(p) ~ 'kingston' then 'kingston'
    else regexp_replace(lower(btrim(p)), '[^a-z ]+', ' ', 'g')
  end;
$$;

comment on function public.parish_key(text) is
  'Free-text Jamaican location to a parish key. Kingston 5-10 and 19-20 map to st andrew, which is correct: those postal districts are in St Andrew, not Kingston parish.';

create or replace function public.trade_key(p text)
returns text
language sql
immutable
parallel safe
as $$
  select case
    when p is null or btrim(p) = '' then null
    when lower(p) ~ '(plumb|pipe|drain|septic|soakaway|tank|pump|water)' then 'plumbing'
    when lower(p) ~ '(electric|wiring|rewire|solar|inverter|consumer unit|breaker)' then 'electrical'
    when lower(p) ~ '(roof|zinc|shingle|gutter|purlin)' then 'roofing'
    when lower(p) ~ '(tile|tiling|wet ?room)' then 'tiling'
    when lower(p) ~ '(mason|block|concrete|render|plaster|wall|slab)' then 'masonry'
    when lower(p) ~ '(paint|decorat)' then 'painting'
    when lower(p) ~ '(grille|grill|gate|weld|burglar bar)' then 'grille and gate'
    when lower(p) ~ '(air ?con|a/?c|hvac|split unit)' then 'air conditioning'
    when lower(p) ~ '(carpent|joiner|cabinet|wood|door|shelv)' then 'carpentry'
    when lower(p) ~ '(landscap|garden|yard|tree)' then 'landscaping'
    when lower(p) ~ '(lock|security door|cctv|alarm|camera)' then 'security'
    when lower(p) ~ '(window|glaz|glass)' then 'windows'
    when lower(p) ~ '(handy|general repair|odd job|small repair)' then 'handyman'
    else regexp_replace(lower(btrim(p)), '[^a-z ]+', ' ', 'g')
  end;
$$;

comment on function public.trade_key(text) is
  'Free-text trade to a trade key. Deliberately generous: "leaking pipe" and "Plumbing & drainage" both land on plumbing.';


-- ---------------------------------------------------------------------
-- 2. job_alerts — the record of who was told, and the reason a worker
--    can never be alerted twice for the same job on the same channel.
--    The unique index IS the dedupe. Do not do it in application code.
-- ---------------------------------------------------------------------
create table if not exists public.job_alerts (
  id           uuid primary key default gen_random_uuid(),
  job_id       text not null references public.jobs(id) on delete cascade,
  worker_email text not null,
  channel      text not null check (channel in ('ntfy','email','sms','whatsapp','push')),
  status       text not null default 'sent' check (status in ('sent','failed','skipped')),
  detail       text,
  created_at   timestamptz not null default now()
);

create unique index if not exists job_alerts_once
  on public.job_alerts (job_id, lower(worker_email), channel);

create index if not exists job_alerts_job on public.job_alerts (job_id);

alter table public.job_alerts enable row level security;

drop policy if exists ja_admin_all on public.job_alerts;
create policy ja_admin_all on public.job_alerts
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists ja_select_own on public.job_alerts;
create policy ja_select_own on public.job_alerts
  for select to authenticated
  using (lower(worker_email) = lower(coalesce(auth.jwt() ->> 'email','')));

comment on table public.job_alerts is
  'One row per worker per job per channel. The unique index is what stops a retry double-alerting somebody.';


-- ---------------------------------------------------------------------
-- 3. Matching indexes
-- ---------------------------------------------------------------------
create index if not exists wp_match
  on public.worker_profiles (public.trade_key(trade), public.parish_key(parish))
  where active;

create index if not exists jobs_match
  on public.jobs (public.trade_key(trade), public.parish_key(parish))
  where open;


-- ---------------------------------------------------------------------
-- 4. match_workers_for_job
--    Pure read. Returns who SHOULD be told, ranked, already excluding
--    anyone told before. Sends nothing. That separation is deliberate:
--    you can run this in the SQL editor and see exactly who would get
--    an alert before any alert exists.
-- ---------------------------------------------------------------------
create or replace function public.match_workers_for_job(
  p_job   text,
  p_limit int default 25
)
returns table (
  worker_email text,
  name         text,
  trade        text,
  parish       text,
  jobs_done    int,
  match_reason text,
  rank_score   int
)
language sql
stable
security definer
set search_path to 'public'
as $$
  with j as (
    select id,
           trade_key(trade)  as tk,
           parish_key(parish) as pk
    from jobs
    where id = p_job
      and open is true
      and coalesce(worker_email,'') = ''
      and stage = 0
  )
  select w.worker_email,
         w.name,
         w.trade,
         w.parish,
         w.jobs_completed,
         case
           when trade_key(w.trade) = j.tk and parish_key(w.parish) = j.pk then 'trade and parish'
           when trade_key(w.trade) = j.tk then 'trade, different parish'
           else 'parish, related trade'
         end,
         (case when trade_key(w.trade)  = j.tk then 100 else 0 end)
       + (case when parish_key(w.parish) = j.pk then 50  else 0 end)
       + least(w.jobs_completed, 25)
    from worker_profiles w
    cross join j
   where w.active
     and coalesce(w.worker_email,'') <> ''
     -- Must have a signature on the CURRENT Worker Guidelines version.
     -- This mirrors jq_insert_vetted exactly: there is no point alerting
     -- somebody who would then be refused when they tried to quote.
     and exists (
       select 1 from doc_signatures ds
        where ds.doc_type = 'worker_guidelines'
          and lower(ds.signer_email) = lower(w.worker_email)
          and (current_doc_version('worker_guidelines') is null
               or ds.doc_version = current_doc_version('worker_guidelines'))
     )
     -- trade must match, or parish must match. Never neither.
     and (trade_key(w.trade) = j.tk or parish_key(w.parish) = j.pk)
     -- never alert the same person about the same job twice
     and not exists (
       select 1 from job_alerts a
        where a.job_id = j.id
          and lower(a.worker_email) = lower(w.worker_email)
          and a.status = 'sent'
     )
   order by 7 desc, w.jobs_completed desc
   limit greatest(p_limit, 1);
$$;

revoke all on function public.match_workers_for_job(text,int) from public, anon;
grant execute on function public.match_workers_for_job(text,int) to authenticated, service_role;

comment on function public.match_workers_for_job(text,int) is
  'Who should be told about this job, ranked, minus anyone already told. Read-only. Sends nothing.';


-- =====================================================================
-- AFTER RUNNING THIS — two things by hand
-- =====================================================================
-- 1. Backfill the two existing jobs, because nothing wrote a trade:
--      update jobs set trade = 'roofing'  where id = 'JOB-0002';
--      update jobs set trade = 'painting' where id = 'JOB-0003';
--
-- 2. Sanity-check the matcher without sending anything:
--      select * from match_workers_for_job('JOB-0002');
--    It will return zero rows today, because worker_profiles is empty
--    and doc_signatures is empty. That is the correct answer, not a bug.
-- =====================================================================
