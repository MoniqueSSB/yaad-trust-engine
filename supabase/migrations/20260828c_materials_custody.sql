-- Materials custody: the client nominates the store, the evidence moves the
-- risk. Founder decision of 28 August 2026, logged at the top of
-- BridgeWorks_Ideas_Ledger.md and in "[C] Staged Payments, Matching Trade
-- Practice v1.md" section 4b. Both name the same two gaps: jobs carried
-- materials_by and no nominated storage location, and nothing gated a
-- materials release on one existing. This closes both.
--
-- THE RULE
-- The worker buys the materials and is paid for them against a receipt before
-- any labour stage runs. The CLIENT nominates where on the property they are
-- to be stored, and nothing is released until they have. The worker then files
-- the receipt, photographs and a video of the materials in that nominated
-- place. From the moment that evidence is filed the materials are at the
-- CLIENT's risk. If the worker cannot produce that evidence, stored them
-- somewhere else, or left them plainly insecure, the risk stays with the
-- WORKER. Tools are the worker's risk in every case, stored or not, evidenced
-- or not. Where the property has no securable space the agreed fallback is
-- that the worker buys in drops sized to the next stage and removes the
-- surplus nightly, agreed and priced at quote time, not discovered after a
-- theft.
--
-- WHY THE GATE IS IN POSTGRES AND NOT IN A FORM
-- This inverts the construction default. Under JCT and the contracts that copy
-- it, unfixed materials on site stay at the CONTRACTOR's risk until they are
-- built in, and he stays responsible for them while they are in his custody
-- even after the client has paid and title has vested. Yaadly departs from
-- that on one argument and one only: the client already owns them, the client
-- chose the place, and the worker evidenced doing exactly what he was told.
-- Ownership is not risk. The nomination and the evidence are the whole of the
-- transfer. A materials release with no nomination behind it is therefore not
-- a slightly incomplete record, it is a job running on a rule that has not
-- been satisfied, with nobody knowing whose loss a theft is. That is an
-- invariant, so it lives here rather than in an interface, alongside the
-- client_go_live gate in 20260827i.
--
-- WHAT THIS DOES NOT DECIDE
-- Nothing here is insurance. Neither the guarantee reserve nor the founder's
-- PI covers stolen materials, and public liability and contractors' all risk
-- remain December items. Clients are told at quote time to check that their
-- Jamaican property insurance covers materials on site, because cover on an
-- unoccupied house often does not.
--
-- And the hardest question is still open at the time of writing: what Yaadly
-- does when a client's materials are stolen and the client has to buy them
-- twice. A hard "you insure it" line, a capped goodwill contribution, or a
-- shared split. This schema records who was carrying the risk. It does not
-- decide what happens next, and nobody should read it as though it has.

-- ------------------------------------------------------------ the nomination

alter table public.jobs
  add column if not exists materials_store        text,
  add column if not exists materials_store_type   text,
  add column if not exists materials_store_set_at timestamptz,
  add column if not exists materials_store_set_by text;

alter table public.jobs drop constraint if exists jobs_materials_store_type_chk;
alter table public.jobs add constraint jobs_materials_store_type_chk
  check (materials_store_type is null
         or materials_store_type in ('lockable','indoors','none_available'));

comment on column public.jobs.materials_store is
  'The client''s own words for where on the property materials are to be stored: "the back room off the veranda, key with my aunt". Free text on purpose, because a picker cannot describe a Jamaican yard. This is what the worker photographs and films the materials in, and it is the instruction he is proved to have followed. Withheld from open_jobs: it says where the valuable things are kept.';
comment on column public.jobs.materials_store_type is
  'lockable | indoors | none_available. Coarse enough to publish to the board, because a worker cannot price the drops fallback without knowing which of the three he is quoting against. none_available IS an answer: it selects the fallback (buy in drops sized to the next stage, surplus removed nightly, priced at quote time) rather than leaving the question open.';
comment on column public.jobs.materials_store_set_at is
  'When the nomination was recorded. A dispute about a stolen load turns on when the client named the place, not on when the row was last touched.';
comment on column public.jobs.materials_store_set_by is
  'Who recorded it. The signed-in caller where there is one; otherwise the client''s own address, because the job wizard runs with no session at all and the answer is still the client''s.';

-- ------------------------------------------------------------- the gate

-- One definition of "nominated", used by every guard below, so the rule cannot
-- drift between the tranche and the evidence.
--
-- A type is required in every case: the client has to have answered. Where the
-- answer is lockable or indoors, a description is required as well, because
-- "indoors" alone is not a place a camera can be pointed at and not an
-- instruction anyone can be held to. Where the answer is none_available there
-- is nothing to describe, so the text is optional and the job runs on the
-- drops fallback. That case still clears this gate and still pays the worker
-- against his receipt, but no evidence of materials in a nominated place can
-- exist, so the risk simply never leaves him. The gate is about the client
-- having answered. The evidence is about the risk moving. They are different
-- questions and this function only answers the first.
create or replace function public.materials_store_nominated(p_job text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.jobs j
     where j.id = p_job
       and j.materials_store_type is not null
       and (j.materials_store_type = 'none_available'
            or coalesce(btrim(j.materials_store), '') <> '')
  );
$$;

revoke execute on function public.materials_store_nominated(text) from public, anon, authenticated;

-- ------------------------------------------------- stamping and un-nominating

create or replace function public.jobs_materials_store_stamp()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_changed boolean;
  v_had     boolean;
begin
  -- OLD is unassigned on INSERT and reading a field of it there is an error,
  -- so the two cases are separated rather than leaned on AND short-circuiting,
  -- which SQL does not promise.
  if tg_op = 'INSERT' then
    v_changed := true;
    v_had     := false;
  else
    v_changed := new.materials_store      is distinct from old.materials_store
              or new.materials_store_type is distinct from old.materials_store_type;
    v_had     := old.materials_store_type is not null;
  end if;

  -- Only move the stamp when the instruction itself moved. An unrelated update
  -- to the job must not make an old nomination look freshly given.
  if v_changed then
    if new.materials_store_type is not null then
      new.materials_store_set_at := now();
      new.materials_store_set_by := coalesce(
        nullif(btrim(lower(auth.jwt() ->> 'email')), ''),
        nullif(btrim(lower(coalesce(new.client_email, ''))), ''),
        'not recorded');
    else
      new.materials_store_set_at := null;
      new.materials_store_set_by := null;
    end if;
  end if;

  -- Changing the nomination is allowed: materials genuinely get moved, and the
  -- new instruction is stamped above. Removing it altogether once money or
  -- evidence has gone through on the strength of it is not, because it rewrites
  -- who was carrying the risk at the time, after the fact.
  if v_had and new.materials_store_type is null then
    if exists (select 1 from public.materials_releases r where r.job_id = new.id)
       or exists (select 1 from public.evidence e
                   where e.job_id = new.id and e.kind = 'materials') then
      raise exception
        'Job % has a materials release or materials evidence recorded against its nominated store, so the nomination cannot be removed. Record a new location instead: the change is stamped and the old one stays in the record.', new.id
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end $$;

-- ------------------------------------------------------- materials evidence

-- The receipt, the photographs and the video of the materials in the nominated
-- place. Marked as its own kind rather than sniffed out of a label, because
-- this is the one evidence set that decides who eats a theft, and a rule that
-- turns on somebody typing the word "materials" is not a rule.
alter table public.evidence
  add column if not exists kind text;

alter table public.evidence drop constraint if exists evidence_kind_chk;
alter table public.evidence add constraint evidence_kind_chk
  check (kind is null or kind in ('materials','work'));

comment on column public.evidence.kind is
  'materials means this set is the receipt, photographs and video of materials in the store the client nominated: it is what transfers the risk in them, and it is refused on a job with no nomination. work is ordinary stage evidence. Null is everything filed before this column existed, and is treated as work.';

create or replace function public.evidence_materials_needs_store()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.kind is distinct from 'materials' then
    return new;
  end if;
  if not public.materials_store_nominated(new.job_id) then
    raise exception
      'Job % has no materials store nominated by the client, so materials evidence cannot be filed against it. The client names the place first; the evidence of the materials in that place is what moves the risk to them.', new.job_id
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists trg_evidence_materials_needs_store on public.evidence;
create trigger trg_evidence_materials_needs_store
  before insert or update on public.evidence
  for each row execute function public.evidence_materials_needs_store();

-- --------------------------------------------------------- the tranche

-- The materials line of a quote, released to the worker against a receipt
-- before any labour stage runs. Yaadly does not buy materials and does not
-- hold stock; this row is the record that the materials money moved and what
-- it moved against. Materials are never fee'd on either side, so there is no
-- fee column here and there is not meant to be one.
--
-- Deliberately narrow. Amounts are J$ because that is what a hardware receipt
-- in Portmore says, and reconciling a receipt against a converted figure is
-- how disputes start.
create table if not exists public.materials_releases (
  id          uuid primary key default gen_random_uuid(),
  job_id      text        not null references public.jobs(id) on delete cascade,
  stage       int,
  amount_jmd  numeric(12,2) not null check (amount_jmd > 0),
  receipt_ref text        not null default '',
  note        text        not null default '',
  released_at timestamptz,
  released_by text        not null default '',
  created_at  timestamptz not null default now()
);

comment on table public.materials_releases is
  'One row per materials tranche paid to the worker against a receipt. Refused outright on a job where the client has not nominated a materials store: see materials_release_needs_store.';
comment on column public.materials_releases.stage is
  'The labour stage this tranche is buying for. Null on a single-drop job. On the drops fallback there is one row per drop, each sized to the next stage.';

create index if not exists materials_releases_job_idx
  on public.materials_releases (job_id, created_at desc);

create or replace function public.materials_release_needs_store()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.materials_store_nominated(new.job_id) then
    raise exception
      'Job % has no materials store nominated by the client, so no materials tranche can be released on it. Ask the client where the materials are to be kept, record it on the job, and this will go through. If there is nowhere securable, record that as the answer: the job then runs on drops sized to the next stage, priced at quote time.', new.job_id
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists trg_materials_release_needs_store on public.materials_releases;
create trigger trg_materials_release_needs_store
  before insert or update on public.materials_releases
  for each row execute function public.materials_release_needs_store();

-- The stamp trigger reads materials_releases, so it goes on last.
drop trigger if exists trg_jobs_materials_store_stamp on public.jobs;
create trigger trg_jobs_materials_store_stamp
  before insert or update on public.jobs
  for each row execute function public.jobs_materials_store_stamp();

-- ------------------------------------------------------------------- RLS

alter table public.materials_releases enable row level security;

drop policy if exists materials_releases_admin      on public.materials_releases;
drop policy if exists materials_releases_party_read on public.materials_releases;

-- Money moves when a named human says so, so writing is the desk's alone.
create policy materials_releases_admin on public.materials_releases
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Both parties can see what was released and what it was released against.
-- The client is paying for it and the worker is being paid it.
create policy materials_releases_party_read on public.materials_releases
  for select to authenticated
  using (exists (
    select 1 from public.jobs j
     where j.id = materials_releases.job_id
       and nullif(btrim(lower(auth.jwt() ->> 'email')), '') is not null
       and nullif(btrim(lower(auth.jwt() ->> 'email')), '') in (
             nullif(btrim(lower(coalesce(j.client_email, ''))), ''),
             nullif(btrim(lower(coalesce(j.worker_email, ''))), ''))
  ));

-- ------------------------------------------------------------ the board

-- The type goes to the board because a worker cannot price the drops fallback
-- without it. The free text does not, and never will: it names where on a
-- property, often an empty one, the valuable things are kept. Same reason
-- open_jobs strips the address and the phone number, and the same reason
-- budget_band is not in this list.
create or replace view public.open_jobs as
 SELECT j.id, j.title, j.parish,
    regexp_replace(regexp_replace(regexp_replace(j.descr, '(^|\n)\s*(Address|Access contact)\s*:[^\n]*'::text, '\1'::text, 'gi'::text), '\+?[0-9][0-9\s().-]{7,}[0-9]'::text, '[contact removed]'::text, 'g'::text), '\n{3,}'::text, '\n\n'::text, 'g'::text) AS descr,
    j.updated_at,
    cp.user_id IS NOT NULL AS client_signed,
    COALESCE(cp.jobs_completed, 0) AS client_jobs_completed,
    j.trade, j.job_type, j.size_band, j.access_type, j.materials_by, j.urgency,
    j.materials_store_type
   FROM jobs j
     LEFT JOIN client_profiles cp ON lower(cp.email) = lower(COALESCE(j.client_email, ''::text))
  WHERE j.open = true AND COALESCE(j.worker_email, ''::text) = ''::text AND j.stage = 0;

-- --------------------------------------------------------------- grants

-- Trigger bodies are for triggers. Nothing reaches these through PostgREST.
revoke execute on function public.jobs_materials_store_stamp()      from public, anon, authenticated;
revoke execute on function public.evidence_materials_needs_store()  from public, anon, authenticated;
revoke execute on function public.materials_release_needs_store()   from public, anon, authenticated;
