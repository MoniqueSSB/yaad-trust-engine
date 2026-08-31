-- Kickoff Pack dual agreement, step 1 of the founder-agreed design (31 Aug
-- 2026): client and worker each confirm the SAME revision of the pack with
-- a short confirmation code, not just a click. The page's own footer
-- already promised this ("a change after issue creates a new revision and
-- both sides re-sign") before anything backed it.
--
-- The code is embedded in whatever link a party is sent (WhatsApp or
-- portal) and is checked against the pack's CURRENT code at confirm time:
-- if the pack has moved to a new revision since that link was sent, an old
-- code fails closed with a plain reason, rather than silently confirming
-- content that changed under the reader. Reusing this repository's existing
-- shared-code pattern (job.portal_code), not inventing a new one.
--
-- This migration adds the mechanism only: the column, the agreement table,
-- and the RPC. It does not yet change when a pack is drafted or who is
-- notified - those are separate, later pieces of the same design.

alter table public.kickoff_packs
  add column if not exists confirm_code text,
  add column if not exists both_confirmed_at timestamptz;

create table if not exists public.kickoff_pack_agreements (
  pack_id   text not null references public.kickoff_packs(id),
  rev       int  not null,
  side      text not null check (side in ('client','worker')),
  email     text not null,
  agreed_at timestamptz not null default now(),
  primary key (pack_id, rev, side)
);

alter table public.kickoff_pack_agreements enable row level security;

create policy "admin full kickoff_pack_agreements" on public.kickoff_pack_agreements
  for all using (public.is_admin()) with check (public.is_admin());

create policy "parties read kickoff pack agreements" on public.kickoff_pack_agreements
  for select using (
    exists (
      select 1 from public.kickoff_packs p
      join public.jobs j on j.id = p.job_id
      where p.id = kickoff_pack_agreements.pack_id
        and (lower(coalesce(j.client_email,'')) = lower(auth.jwt()->>'email')
             or lower(coalesce(j.worker_email,'')) = lower(auth.jwt()->>'email'))
    )
  );
-- No insert/update/delete policy for parties: every write goes through
-- agree_kickoff_pack() below, security definer, so a side can never be
-- recorded as agreed except by that side's own signed-in call.

-- Every pack gets its code the moment it exists, same door link_kickoff_
-- draft_to_job() already is (20260831y). create or replace, not a separate
-- backfill: this repository's own standing rule after the secret-mismatch
-- incident (20260831z2) is to extend a function in place rather than layer
-- a second one that can drift from it.
create or replace function public.link_kickoff_draft_to_job(p_draft_id uuid, p_job_id text)
returns table(pack_id text)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_draft kickoff_drafts%rowtype;
  v_job   jobs%rowtype;
  v_pack_id text;
begin
  if not public.is_admin() then
    raise exception 'Admin only.' using errcode = '28000';
  end if;

  select * into v_draft from kickoff_drafts where id = p_draft_id;
  if not found then
    raise exception 'No such draft.' using errcode = 'check_violation';
  end if;
  if v_draft.status <> 'ready' or v_draft.docs is null then
    raise exception 'This draft is not ready. Only a finished, successful draft can become a Kickoff Pack.'
      using errcode = 'check_violation';
  end if;

  select * into v_job from jobs where id = p_job_id;
  if not found then
    raise exception 'No such job.' using errcode = 'check_violation';
  end if;

  v_pack_id := 'KO-' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint::text;

  insert into public.kickoff_packs (id, job_id, project_title, client_name, parish, intake, docs, model, confirm_code)
  values (
    v_pack_id,
    p_job_id,
    coalesce(nullif(btrim(v_draft.intake->>'title'), ''), 'Untitled project'),
    nullif(btrim(v_draft.intake->>'client_name'), ''),
    coalesce(nullif(btrim(v_draft.intake->>'parish'), ''), v_job.parish),
    v_draft.intake,
    v_draft.docs,
    v_draft.model,
    upper(substring(encode(extensions.gen_random_bytes(4), 'hex') from 1 for 6))
  );

  return query select v_pack_id;
end $$;

revoke execute on function public.link_kickoff_draft_to_job(uuid, text) from anon, public;
grant  execute on function public.link_kickoff_draft_to_job(uuid, text) to authenticated;

-- A pack created before this migration has no code yet; give every such
-- pack one now so an already-approved pack is still confirmable.
update public.kickoff_packs
   set confirm_code = upper(substring(encode(extensions.gen_random_bytes(4), 'hex') from 1 for 6))
 where confirm_code is null;

-- The OUT column is "agreed_side", not "side": naming it "side" (as first
-- written) shadowed the kickoff_pack_agreements.side column everywhere in
-- this function's body, including inside "on conflict (pack_id, rev,
-- side)", and Postgres refused it as ambiguous. Caught by actually running
-- this end to end against test rows before it ever reached a real pack.
create or replace function public.agree_kickoff_pack(p_pack_id text, p_code text)
returns table(agreed_side text, both_confirmed boolean)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_pack  kickoff_packs%rowtype;
  v_job   jobs%rowtype;
  v_email text := lower(nullif(btrim(auth.jwt()->>'email'), ''));
  v_side  text;
  v_both  boolean;
begin
  if v_email is null then
    raise exception 'Sign in to confirm this pack.' using errcode = '28000';
  end if;

  select * into v_pack from kickoff_packs where id = p_pack_id;
  if not found then raise exception 'No such Kickoff Pack.' using errcode = 'check_violation'; end if;
  if v_pack.status <> 'approved' then
    raise exception 'This pack has not been issued yet.' using errcode = 'check_violation';
  end if;
  if v_pack.confirm_code is null or upper(btrim(p_code)) <> v_pack.confirm_code then
    raise exception 'That confirmation code does not match the current version of this pack. Open it again for the latest link.'
      using errcode = 'check_violation';
  end if;

  select * into v_job from jobs where id = v_pack.job_id;
  if lower(coalesce(v_job.client_email,'')) = v_email then
    v_side := 'client';
  elsif lower(coalesce(v_job.worker_email,'')) = v_email then
    v_side := 'worker';
  else
    raise exception 'Only the client or worker on this job may confirm it.' using errcode = '28000';
  end if;

  insert into public.kickoff_pack_agreements (pack_id, rev, side, email, agreed_at)
  values (p_pack_id, v_pack.rev, v_side, v_email, now())
  on conflict (pack_id, rev, side) do nothing;

  v_both :=
    exists (select 1 from public.kickoff_pack_agreements
             where pack_id = p_pack_id and rev = v_pack.rev and side = 'client')
    and exists (select 1 from public.kickoff_pack_agreements
             where pack_id = p_pack_id and rev = v_pack.rev and side = 'worker');

  if v_both and v_pack.both_confirmed_at is null then
    update public.kickoff_packs set both_confirmed_at = now() where id = p_pack_id;
  end if;

  return query select v_side, v_both;
end $$;

revoke execute on function public.agree_kickoff_pack(text, text) from anon, public;
grant  execute on function public.agree_kickoff_pack(text, text) to authenticated;

comment on table public.kickoff_pack_agreements is
  'Client and worker each confirm one revision of a Kickoff Pack with a shared code. Written only by agree_kickoff_pack(). See 20260831zzzz10.';
