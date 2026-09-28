-- Add-on work on a booked job.
--
-- Founder decisions, 28 September 2026. Until now a booked job could not take
-- extra work at all: request_quote_change_as_me() refuses a booked job with
-- "Message Yaadly about any change to it" (20260913230000), and nothing else
-- recorded it. Extra work found once a job opens up either happened off the
-- books or stopped the job.
--
-- THE FLOW, as she set it:
--   1. The client writes it: a short scope summary, the amount they offer,
--      and the payment terms. Default terms: paid in full.
--   2. The worker accepts it, edits the scope, amount or terms, or turns it
--      down. An edit goes back to the client, who may accept, edit again or
--      withdraw. Nothing is agreed until both sides have agreed the SAME
--      revision (the kickoff pack's rule, 20260831zzzz10, by revision number
--      instead of a code).
--   3. Once both agree, the add-on's invoice is drafted on the same job as its
--      own numbered invoice, counted in the job's total. The job's own bill is
--      never touched, sent or not. Paid in full means paid on agreement,
--      before the extra work starts; "half now, half on sign-off" is the one
--      alternative.
--   4. Fees as on the main job: the client pays the agreed amount plus 15%
--      Guarantee & Support on top; the worker is paid the amount less 5%.
--   5. The job cannot complete while any add-on is still being agreed or has
--      been agreed and not signed off.
--
-- WHAT THIS DOES NOT DO. It never sends an invoice, marks one paid or pays a
-- worker. Drafting is automatic; sending, marking paid and paying the worker
-- are the same named-human clicks as every other invoice. Sign-off of the
-- add-on's evidence is a named admin (sign_off_addon), recorded by email.
-- No model touches any of it and no price is suggested: the amount is what
-- the two parties wrote (CLAUDE.md §5).
--
-- WHY NOT JUST ADD A STAGE. The accepted quote's stages must total exactly
-- 100% (parse_payment_stages, 20260913230001) and job_final_stage_count()
-- decides when the job is complete. A stage bolted on breaks one or the other.
--
-- THE FIVE LIVE FUNCTIONS THIS TOUCHES, each read live with pg_get_functiondef
-- on 28 September 2026 and identical to the repository, except
-- raise_job_worker_payable, which is restated from 20260928230000 (the pay
-- invoice records worker_labour_jmd and worker_fee_jmd), merged the same day.
-- The ONLY change in each is that an add-on invoice (addon_id set) is kept
-- out of the job's own money:
--   invoice_starts_job_default    an add-on invoice never starts the job
--   raise_job_client_invoice      an add-on invoice is not "the job's bill"
--   raise_job_worker_payable      an add-on payable is not "the job's payable"
--   worker_pay_client_unpaid      an add-on payable waits on its OWN client
--                                 invoices; the job's payable ignores them
--   sync_job_status               open add-ons hold the job short of complete
-- Add-on evidence lives in its own table, so the stage evidence rules
-- (evidence_on_the_working_stage, _do_approve_stage) are untouched.

-- ------------------------------------------------------------------ tables

create table if not exists public.job_addons (
  id              uuid primary key default gen_random_uuid(),
  job_id          text not null references public.jobs(id) on delete cascade,
  rev             integer not null default 1 check (rev >= 1),
  scope           text not null check (char_length(btrim(scope)) between 1 and 1500),
  amount_jmd      integer not null check (amount_jmd between 1 and 100000000),
  terms           text not null default 'in_full'
                  check (terms in ('in_full', 'half_now_half_on_signoff')),
  status          text not null default 'with_worker'
                  check (status in ('with_worker', 'with_client', 'agreed', 'declined', 'withdrawn', 'signed_off')),
  written_by      text not null,
  last_edit_side  text not null default 'client' check (last_edit_side in ('client', 'worker')),
  history         jsonb not null default '[]'::jsonb,
  closed_by       text,
  closed_reason   text check (closed_reason is null or char_length(closed_reason) <= 500),
  closed_at       timestamptz,
  agreed_at       timestamptz,
  signed_off_at   timestamptz,
  signed_off_by   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- The client can confirm a version the worker changed by replying
  -- "CONFIRM <code>" on WhatsApp. A new code on every revision, so a reply
  -- to an older version finds nothing. Never contains the job id, so it can
  -- never be read as a stage approval by yaad-inbound's later lanes.
  confirm_code    text not null default upper(substring(md5(random()::text || clock_timestamp()::text) from 1 for 6))
);

create index if not exists job_addons_job on public.job_addons (job_id);

comment on table public.job_addons is
  'Extra work on a booked job. The client writes it, the worker accepts, edits or declines, both agree the same revision, then its invoice is drafted on the job. Holds the job short of complete until signed off. Founder decisions 28 Sep 2026, 20260928235000.';

create table if not exists public.job_addon_agreements (
  addon_id   uuid not null references public.job_addons(id) on delete cascade,
  rev        integer not null,
  side       text not null check (side in ('client', 'worker')),
  email      text not null,
  agreed_at  timestamptz not null default now(),
  primary key (addon_id, rev, side)
);

create table if not exists public.job_addon_evidence (
  id            uuid primary key default gen_random_uuid(),
  addon_id      uuid not null references public.job_addons(id) on delete cascade,
  job_id        text not null references public.jobs(id) on delete cascade,
  storage_path  text not null unique,
  sha256        text,
  label         text check (label is null or char_length(label) <= 300),
  filed_by      text not null,
  created_at    timestamptz not null default now()
);

create index if not exists job_addon_evidence_addon on public.job_addon_evidence (addon_id);

alter table public.invoices
  add column if not exists addon_id uuid references public.job_addons(id);

create index if not exists invoices_addon on public.invoices (addon_id) where addon_id is not null;

comment on column public.invoices.addon_id is
  'Set on an add-on''s own client invoice or worker payable (20260928235000). Such an invoice never starts the job, is never the job''s bill or the job''s payable, and cannot be split into parts.';

-- ------------------------------------------------------------ row security

create or replace function public.job_worker_email_matches(p_job_id text, p_email text)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $function$
  select coalesce(btrim(p_email), '') <> ''
     and lower(btrim(p_email)) = lower(btrim(coalesce(auth.jwt() ->> 'email', '')))
     and exists (
       select 1 from jobs j
       where j.id = p_job_id
         and lower(coalesce(j.worker_email, '')) = lower(btrim(p_email))
     );
$function$;

comment on function public.job_worker_email_matches(text, text) is
  'The booked-worker twin of job_client_email_matches: true only when p_email is the caller''s own signed-in email and that email is the worker booked on the job. For RLS, 20260928235000.';

revoke all on function public.job_worker_email_matches(text, text) from public, anon;
grant execute on function public.job_worker_email_matches(text, text) to authenticated;

alter table public.job_addons enable row level security;
alter table public.job_addon_agreements enable row level security;
alter table public.job_addon_evidence enable row level security;

drop policy if exists "admin full job_addons" on public.job_addons;
create policy "admin full job_addons" on public.job_addons
  for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists "job party reads its add-ons" on public.job_addons;
create policy "job party reads its add-ons" on public.job_addons
  for select to authenticated
  using (public.job_client_email_matches(job_id, auth.jwt() ->> 'email')
      or public.job_worker_email_matches(job_id, auth.jwt() ->> 'email'));

drop policy if exists "admin full job_addon_agreements" on public.job_addon_agreements;
create policy "admin full job_addon_agreements" on public.job_addon_agreements
  for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists "job party reads add-on agreements" on public.job_addon_agreements;
create policy "job party reads add-on agreements" on public.job_addon_agreements
  for select to authenticated
  using (exists (
    select 1 from public.job_addons a
     where a.id = addon_id
       and (public.job_client_email_matches(a.job_id, auth.jwt() ->> 'email')
         or public.job_worker_email_matches(a.job_id, auth.jwt() ->> 'email'))));

drop policy if exists "admin full job_addon_evidence" on public.job_addon_evidence;
create policy "admin full job_addon_evidence" on public.job_addon_evidence
  for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists "job party reads add-on evidence" on public.job_addon_evidence;
create policy "job party reads add-on evidence" on public.job_addon_evidence
  for select to authenticated
  using (public.job_client_email_matches(job_id, auth.jwt() ->> 'email')
      or public.job_worker_email_matches(job_id, auth.jwt() ->> 'email'));

-- Writes only through the functions below, as quote_change_requests.
revoke insert, update, delete, truncate on public.job_addons, public.job_addon_agreements, public.job_addon_evidence from anon, authenticated;
revoke all on public.job_addons, public.job_addon_agreements, public.job_addon_evidence from anon;
grant select on public.job_addons, public.job_addon_agreements, public.job_addon_evidence to authenticated;

-- A file referenced by add-on evidence is not an "unreferenced upload" either.
drop policy if exists "job party can remove an unreferenced upload" on storage.objects;
create policy "job party can remove an unreferenced upload"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'evidence'
    and not exists (select 1 from public.evidence e where e.storage_path = storage.objects.name)
    and not exists (select 1 from public.job_addon_evidence x where x.storage_path = storage.objects.name)
    and exists (
      select 1 from public.jobs j
      where j.id = (storage.foldername(name))[1]
        and (lower(j.worker_email) = lower(auth.jwt() ->> 'email')
          or lower(j.client_email) = lower(auth.jwt() ->> 'email'))
    )
  );

-- ------------------------------------------------------------- the helpers

-- Which side the caller is on this add-on's job, or null.
create or replace function public._addon_side(p_job text, p_email text)
returns text
language sql
stable security definer
set search_path to 'public'
as $function$
  select case
    when coalesce(p_email, '') = '' then null
    when lower(coalesce(j.client_email, '')) = p_email then 'client'
    when lower(coalesce(j.worker_email, '')) = p_email then 'worker'
  end
  from jobs j where j.id = p_job;
$function$;

-- The client invoice for an add-on, drafted, never sent. p_part is 'full',
-- 'first' (half now) or 'second' (the rest, on sign-off).
create or replace function public._draft_addon_client_invoice(p_addon uuid, p_part text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_a      job_addons%rowtype;
  v_job    jobs%rowtype;
  v_work   integer;
  v_fee    integer;
  v_id     text;
  v_label  text;
begin
  select * into v_a from job_addons where id = p_addon;
  select * into v_job from jobs where id = v_a.job_id;

  v_work := case p_part
              when 'full'   then v_a.amount_jmd
              when 'first'  then (v_a.amount_jmd + 1) / 2
              when 'second' then v_a.amount_jmd - (v_a.amount_jmd + 1) / 2
            end;
  if v_work is null or v_work <= 0 then
    return null;
  end if;
  v_fee := round(v_work * 0.15);
  v_label := case p_part when 'full' then 'Add-on' when 'first' then 'Add-on, first half' else 'Add-on, second half' end;

  v_id := public.new_invoice_number();
  insert into public.invoices (id, client_name, client_email, job_id, addon_id, drafted_by, currency, period_label, payable_to, notes)
  values (v_id, coalesce(v_job.client_name, v_job.client_email), v_job.client_email, v_a.job_id, v_a.id, 'human', 'JMD', v_label, 'yaadly',
    'Extra work on this job, agreed by you and your tradesperson as an add-on. It covers the agreed amount for the work and Yaadly''s 15% Guarantee & Support fee on top. '
    || case p_part
         when 'full'   then 'Paid in full before the extra work starts.'
         when 'first'  then 'The first half, paid before the extra work starts. The second half is billed once the work is signed off.'
         else 'The second half, now the extra work is signed off.'
       end
    || ' Your original job bill is unchanged. You do not pay the tradesperson: Yaadly engages and pays them.');

  insert into public.invoice_lines (invoice_id, catalogue_id, description, qty, unit_amount_pence, price_source, sort)
  values (v_id, null, 'Add-on: ' || left(regexp_replace(btrim(v_a.scope), '\s+', ' ', 'g'), 120), 1, v_work, 'manual', 0);
  insert into public.invoice_lines (invoice_id, catalogue_id, description, qty, unit_amount_pence, price_source, sort, is_fee)
  values (v_id, null, 'Guarantee & Support, 15%', 1, v_fee, 'manual', 1, true);

  return v_id;
end $function$;

-- Touching the job makes sync_job_status() read the add-ons again.
create or replace function public._touch_job(p_job text)
returns void
language sql
security definer
set search_path to 'public'
as $function$
  update jobs set updated_at = now() where id = p_job;
$function$;

-- Both sides have agreed the current revision: book it and draft its invoice.
-- Shared by the portal (agree_addon_as_me) and WhatsApp (agree_addon_via_whatsapp).
create or replace function public._finish_addon_agreement(p_addon uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_a   job_addons%rowtype;
  v_inv text;
begin
  select * into v_a from job_addons where id = p_addon;
  update job_addons set status = 'agreed', agreed_at = now(), updated_at = now() where id = p_addon;
  v_inv := public._draft_addon_client_invoice(p_addon, case when v_a.terms = 'in_full' then 'full' else 'first' end);
  perform public._touch_job(v_a.job_id);
  return v_inv;
end $function$;

revoke all on function public._finish_addon_agreement(uuid) from public, anon, authenticated;
revoke all on function public._addon_side(text, text) from public, anon, authenticated;
revoke all on function public._draft_addon_client_invoice(uuid, text) from public, anon, authenticated;
revoke all on function public._touch_job(text) from public, anon, authenticated;

-- ------------------------------------------------------ the client writes it

create or replace function public.propose_addon_as_me(p_job text, p_scope text, p_amount_jmd integer, p_terms text default 'in_full')
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_email text := lower(nullif(btrim(auth.jwt() ->> 'email'), ''));
  v_job   jobs%rowtype;
  v_id    uuid;
begin
  if v_email is null then
    raise exception 'Sign in to add work to this job.' using errcode = '28000';
  end if;
  select * into v_job from jobs where id = p_job;
  if not found then
    raise exception 'No such job.';
  end if;
  if lower(coalesce(v_job.client_email, '')) <> v_email then
    raise exception 'Only the client on this job can add work to it.' using errcode = '28000';
  end if;
  if coalesce(v_job.worker_email, '') = '' then
    raise exception 'This job has no tradesperson booked yet. Ask for a change to their quote instead.';
  end if;
  if v_job.status = 'awaiting_payment' then
    raise exception 'Extra work can be added once the job has started.';
  end if;
  if v_job.status not in ('in_progress', 'evidence') then
    raise exception 'This job is %, so work can no longer be added to it. Post a new job for anything else.', replace(v_job.status, '_', ' ');
  end if;
  if char_length(btrim(coalesce(p_scope, ''))) = 0 then
    raise exception 'Say what the extra work is.';
  end if;
  if char_length(btrim(p_scope)) > 1500 then
    raise exception 'Keep it under 1,500 characters.';
  end if;
  if coalesce(p_amount_jmd, 0) < 1 then
    raise exception 'Put the amount you are offering for the work.';
  end if;
  if coalesce(p_terms, 'in_full') not in ('in_full', 'half_now_half_on_signoff') then
    raise exception 'Choose how it is paid.';
  end if;

  insert into job_addons (job_id, scope, amount_jmd, terms, written_by, last_edit_side)
  values (p_job, btrim(p_scope), p_amount_jmd, coalesce(p_terms, 'in_full'), v_email, 'client')
  returning id into v_id;

  -- Writing it is the client's agreement to revision 1, as a worker's quote
  -- is the worker's agreement to it (20260909, client acceptance books).
  insert into job_addon_agreements (addon_id, rev, side, email) values (v_id, 1, 'client', v_email);

  perform public._touch_job(p_job);
  return v_id;
end $function$;

-- ------------------------------------------- either side edits on their turn

create or replace function public.edit_addon_as_me(p_addon uuid, p_rev integer, p_scope text, p_amount_jmd integer, p_terms text)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_email text := lower(nullif(btrim(auth.jwt() ->> 'email'), ''));
  v_a     job_addons%rowtype;
  v_side  text;
begin
  if v_email is null then
    raise exception 'Sign in first.' using errcode = '28000';
  end if;
  select * into v_a from job_addons where id = p_addon for update;
  if not found then
    raise exception 'No such add-on.';
  end if;
  v_side := public._addon_side(v_a.job_id, v_email);
  if v_side is null then
    raise exception 'Only the client and the tradesperson on this job can change it.' using errcode = '28000';
  end if;
  if v_a.status not in ('with_worker', 'with_client') then
    raise exception 'This add-on is % and can no longer be changed.', replace(v_a.status, '_', ' ');
  end if;
  if (v_a.status = 'with_worker') <> (v_side = 'worker') then
    raise exception 'This add-on is waiting on the other side. You can change it again once they reply.';
  end if;
  if p_rev is distinct from v_a.rev then
    raise exception 'This add-on changed while you had it open. Reload to see the latest version.';
  end if;
  if char_length(btrim(coalesce(p_scope, ''))) = 0 or char_length(btrim(p_scope)) > 1500 then
    raise exception 'The scope must say what the work is, in under 1,500 characters.';
  end if;
  if coalesce(p_amount_jmd, 0) < 1 then
    raise exception 'Put an amount for the work.';
  end if;
  if coalesce(p_terms, '') not in ('in_full', 'half_now_half_on_signoff') then
    raise exception 'Choose how it is paid.';
  end if;
  if btrim(p_scope) = v_a.scope and p_amount_jmd = v_a.amount_jmd and p_terms = v_a.terms then
    raise exception 'Nothing changed. Accept it as it is instead.';
  end if;

  update job_addons
     set history        = history || jsonb_build_array(jsonb_build_object(
                             'rev', rev, 'scope', scope, 'amount_jmd', amount_jmd, 'terms', terms,
                             'by', last_edit_side, 'at', updated_at)),
         rev            = rev + 1,
         scope          = btrim(p_scope),
         amount_jmd     = p_amount_jmd,
         terms          = p_terms,
         last_edit_side = v_side,
         status         = case when v_side = 'worker' then 'with_client' else 'with_worker' end,
         confirm_code   = upper(substring(md5(random()::text || clock_timestamp()::text) from 1 for 6)),
         updated_at     = now()
   where id = p_addon;

  -- Sending an edit is the editor's agreement to the new revision.
  insert into job_addon_agreements (addon_id, rev, side, email) values (p_addon, v_a.rev + 1, v_side, v_email);
  return v_a.rev + 1;
end $function$;

-- ----------------------------------------- accepting the revision in front of you

create or replace function public.agree_addon_as_me(p_addon uuid, p_rev integer)
returns table(status text, invoice_id text)
language plpgsql
security definer
set search_path to 'public'
as $function$
#variable_conflict use_column
declare
  v_email text := lower(nullif(btrim(auth.jwt() ->> 'email'), ''));
  v_a     job_addons%rowtype;
  v_side  text;
  v_inv   text;
begin
  if v_email is null then
    raise exception 'Sign in first.' using errcode = '28000';
  end if;
  select * into v_a from job_addons where id = p_addon for update;
  if not found then
    raise exception 'No such add-on.';
  end if;
  v_side := public._addon_side(v_a.job_id, v_email);
  if v_side is null then
    raise exception 'Only the client and the tradesperson on this job can agree it.' using errcode = '28000';
  end if;
  if v_a.status not in ('with_worker', 'with_client') then
    raise exception 'This add-on is % already.', replace(v_a.status, '_', ' ');
  end if;
  if (v_a.status = 'with_worker') <> (v_side = 'worker') then
    raise exception 'You have already agreed this version. It is waiting on the other side.';
  end if;
  if p_rev is distinct from v_a.rev then
    raise exception 'This add-on changed while you had it open. Reload to see the latest version.';
  end if;

  insert into job_addon_agreements (addon_id, rev, side, email)
  values (p_addon, v_a.rev, v_side, v_email)
  on conflict do nothing;

  if (select count(distinct a.side) from job_addon_agreements a where a.addon_id = p_addon and a.rev = v_a.rev) < 2 then
    raise exception 'The other side has not agreed this version, so it cannot be booked yet.';
  end if;

  v_inv := public._finish_addon_agreement(p_addon);
  return query select 'agreed'::text, v_inv;
end $function$;

-- ----------------------------------------------- turning it down, or withdrawing

create or replace function public.decline_addon_as_me(p_addon uuid, p_reason text default null)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_email text := lower(nullif(btrim(auth.jwt() ->> 'email'), ''));
  v_a     job_addons%rowtype;
  v_side  text;
  v_new   text;
begin
  if v_email is null then
    raise exception 'Sign in first.' using errcode = '28000';
  end if;
  select * into v_a from job_addons where id = p_addon for update;
  if not found then
    raise exception 'No such add-on.';
  end if;
  v_side := public._addon_side(v_a.job_id, v_email);
  if v_side is null then
    raise exception 'Only the client and the tradesperson on this job can do that.' using errcode = '28000';
  end if;
  if v_a.status not in ('with_worker', 'with_client') then
    raise exception 'This add-on is % and can no longer be turned down. Message Yaadly.', replace(v_a.status, '_', ' ');
  end if;
  if char_length(coalesce(p_reason, '')) > 500 then
    raise exception 'Keep the reason under 500 characters.';
  end if;

  -- The side it is waiting on turns it down; the side waiting withdraws it.
  v_new := case when (v_a.status = 'with_worker') = (v_side = 'worker') then 'declined' else 'withdrawn' end;

  update job_addons
     set status = v_new, closed_by = v_email, closed_reason = nullif(btrim(coalesce(p_reason, '')), ''),
         closed_at = now(), updated_at = now()
   where id = p_addon;

  perform public._touch_job(v_a.job_id);
  return v_new;
end $function$;

-- ------------------------------------------------------ filing the evidence

create or replace function public.file_addon_evidence_as_me(p_addon uuid, p_path text, p_sha256 text default null, p_label text default null)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_email text := lower(nullif(btrim(auth.jwt() ->> 'email'), ''));
  v_a     job_addons%rowtype;
  v_id    uuid;
begin
  if v_email is null then
    raise exception 'Sign in first.' using errcode = '28000';
  end if;
  select * into v_a from job_addons where id = p_addon;
  if not found then
    raise exception 'No such add-on.';
  end if;
  if public._addon_side(v_a.job_id, v_email) is null then
    raise exception 'Only the client and the tradesperson on this job can file evidence on it.' using errcode = '28000';
  end if;
  if v_a.status <> 'agreed' then
    raise exception 'Evidence goes on an add-on once it is agreed and before it is signed off.';
  end if;
  -- Paid before the extra work starts: the up-front invoice must be paid.
  if not exists (select 1 from invoices i
                  where i.addon_id = p_addon and coalesce(i.payable_to, 'yaadly') = 'yaadly'
                    and i.status = 'paid') then
    raise exception 'The extra work starts once its invoice is paid, so no evidence can be filed on it yet.';
  end if;
  if coalesce(p_path, '') = '' or split_part(p_path, '/', 1) <> v_a.job_id then
    raise exception 'That file is not in this job''s evidence folder.';
  end if;

  insert into job_addon_evidence (addon_id, job_id, storage_path, sha256, label, filed_by)
  values (p_addon, v_a.job_id, p_path, nullif(p_sha256, ''), nullif(left(btrim(coalesce(p_label, '')), 300), ''), v_email)
  returning id into v_id;
  return v_id;
end $function$;

-- --------------------------------------------------- a named person signs it off

create or replace function public.sign_off_addon(p_addon uuid)
returns table(worker_payable text, second_invoice text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_email  text := lower(nullif(btrim(auth.jwt() ->> 'email'), ''));
  v_a      job_addons%rowtype;
  v_job    jobs%rowtype;
  v_rate   integer;
  v_pay    text;
  v_second text;
begin
  if not public.is_admin() then
    raise exception 'Admin only.' using errcode = '28000';
  end if;
  select * into v_a from job_addons where id = p_addon for update;
  if not found then
    raise exception 'No such add-on.';
  end if;
  if v_a.status <> 'agreed' then
    raise exception 'Only an agreed add-on can be signed off. This one is %.', replace(v_a.status, '_', ' ');
  end if;
  if not exists (select 1 from invoices i
                  where i.addon_id = p_addon and coalesce(i.payable_to, 'yaadly') = 'yaadly' and i.status = 'paid') then
    raise exception 'The add-on''s invoice is not marked paid, so the work should not have started.';
  end if;
  if not exists (select 1 from job_addon_evidence e where e.addon_id = p_addon) then
    raise exception 'No evidence has been filed on this add-on. Sign-off is on evidence.';
  end if;
  select * into v_job from jobs where id = v_a.job_id;
  if coalesce(v_job.worker_email, '') = '' then
    raise exception 'This job has no booked tradesperson to pay.';
  end if;

  update job_addons
     set status = 'signed_off', signed_off_at = now(), signed_off_by = v_email, updated_at = now()
   where id = p_addon;

  -- What Yaadly owes the worker for it: the agreed amount less 5%, as on the
  -- main job. Recorded as sent, like a stage payable; paying it is still
  -- mark_worker_paid, which waits for every client invoice on this add-on.
  v_rate := v_a.amount_jmd - round(v_a.amount_jmd * 0.05);
  v_pay := public.new_invoice_number();
  insert into public.invoices (id, client_name, client_email, worker_email, job_id, addon_id, drafted_by, currency, period_label, payable_to, worker_labour_jmd, worker_fee_jmd, notes)
  values (v_pay, 'Yaadly Ltd', 'payable@yaadly.invalid', v_job.worker_email, v_a.job_id, v_a.id, 'human', 'JMD', 'Add-on completed', 'worker', v_a.amount_jmd, v_a.amount_jmd - v_rate,
    'What Yaadly owes ' || coalesce(v_job.worker_name, 'the tradesperson') || ' for agreed add-on work on this job: the amount agreed with the client less 5%, with nothing else deducted. Yaadly pays this directly. The client is not a party to it.');
  insert into public.invoice_lines (invoice_id, catalogue_id, description, qty, unit_amount_pence, price_source)
  values (v_pay, null, 'Add-on: ' || left(regexp_replace(btrim(v_a.scope), '\s+', ' ', 'g'), 100) || ', agreed amount less 5%', 1, v_rate, 'manual');
  -- Lines first, then sent, the order raise_job_stage_worker_payable uses.
  update public.invoices set status = 'sent' where id = v_pay;

  if v_a.terms = 'half_now_half_on_signoff' then
    v_second := public._draft_addon_client_invoice(p_addon, 'second');
  end if;

  perform public._touch_job(v_a.job_id);
  return query select v_pay, v_second;
end $function$;

revoke all on function public.propose_addon_as_me(text, text, integer, text) from public, anon;
revoke all on function public.edit_addon_as_me(uuid, integer, text, integer, text) from public, anon;
revoke all on function public.agree_addon_as_me(uuid, integer) from public, anon;
revoke all on function public.decline_addon_as_me(uuid, text) from public, anon;
revoke all on function public.file_addon_evidence_as_me(uuid, text, text, text) from public, anon;
revoke all on function public.sign_off_addon(uuid) from public, anon;
grant execute on function public.propose_addon_as_me(text, text, integer, text) to authenticated;
grant execute on function public.edit_addon_as_me(uuid, integer, text, integer, text) to authenticated;
grant execute on function public.agree_addon_as_me(uuid, integer) to authenticated;
grant execute on function public.decline_addon_as_me(uuid, text) to authenticated;
grant execute on function public.file_addon_evidence_as_me(uuid, text, text, text) to authenticated;
grant execute on function public.sign_off_addon(uuid) to authenticated;

-- ---------------------------------------- an add-on invoice is never split

create or replace function public.addon_invoice_is_never_a_part()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if new.part_of is not null and exists (select 1 from invoices b where b.id = new.part_of and b.addon_id is not null) then
    raise exception 'An add-on invoice is billed whole and cannot be split into parts.' using errcode = 'check_violation';
  end if;
  return new;
end $function$;

drop trigger if exists invoices_addon_never_a_part on public.invoices;
create trigger invoices_addon_never_a_part
  before insert on public.invoices
  for each row execute function public.addon_invoice_is_never_a_part();

-- =========================================================================
-- The five live functions. Each body is production's, read live on
-- 28 September 2026 (raise_job_worker_payable: 20260928230000's body); the
-- add-on lines are marked "20260928235000".
-- =========================================================================

create or replace function public.invoice_starts_job_default()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if new.part_of is null and new.job_id is not null and new.stage is null
     and coalesce(new.payable_to, 'yaadly') = 'yaadly'
     and new.addon_id is null then   -- 20260928235000
    new.starts_job := true;
  end if;
  return new;
end $function$;

create or replace function public.raise_job_client_invoice(p_job text)
returns table(invoice_id text, total_jmd integer)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_job         jobs%rowtype;
  v_quote       job_quotes%rowtype;
  v_labour      integer;
  v_materials   integer;
  v_fee         integer;
  v_total       integer;
  v_id          text;
  v_mat_already boolean;
begin
  if not public.is_admin() then
    raise exception 'Admin only.' using errcode = '28000';
  end if;

  select * into v_job from jobs where id = p_job;
  if not found then
    raise exception 'No such job.' using errcode = 'check_violation';
  end if;
  if coalesce(v_job.client_email, '') = '' then
    raise exception 'This job has no client email on file to invoice.' using errcode = 'check_violation';
  end if;

  select * into v_quote from job_quotes where job_id = p_job and status = 'accepted';
  if not found then
    raise exception 'No accepted quote on this job yet.' using errcode = 'check_violation';
  end if;

  if exists (
    select 1 from invoices i
     where i.job_id = p_job and i.stage is null
       and i.payable_to = 'yaadly' and i.status <> 'void'
       and i.addon_id is null   -- 20260928235000
  ) then
    raise exception 'This job has already been invoiced to the client.' using errcode = 'check_violation';
  end if;

  v_mat_already := exists (
    select 1 from invoices i
     where i.job_id = p_job and i.stage = 0
       and i.payable_to = 'yaadly' and i.status <> 'void'
  );

  v_labour    := round(coalesce(v_quote.labour_jmd, 0));
  v_materials := case when v_mat_already then 0 else round(coalesce(v_quote.materials_jmd, 0)) end;
  v_fee       := round(v_labour * 0.15);
  v_total     := v_labour + v_fee + v_materials;

  v_id := public.new_invoice_number();
  insert into public.invoices (id, client_name, client_email, job_id, drafted_by, currency, period_label, payable_to, notes)
  values (v_id, coalesce(v_job.client_name, v_job.client_email), v_job.client_email, p_job, 'human', 'JMD', 'Job', 'yaadly',
    case when v_mat_already
      then 'The rest of the price for this job, bought from Yaadly. It covers the work itself and Yaadly''s 15% Guarantee & Support fee for the vetting, the evidence chain and the dispute service. The materials were invoiced separately at the start and are not billed again here. You do not pay the tradesperson: Yaadly engages and pays them. If the work is wrong, that is ours to put right.'
      else 'One price for the whole job, bought from Yaadly. It covers the work itself, materials at cost with nothing added, and Yaadly''s 15% Guarantee & Support fee for the vetting, the evidence chain and the dispute service. You do not pay the tradesperson: Yaadly engages and pays them. If the work is wrong, that is ours to put right.'
    end);

  insert into public.invoice_lines (invoice_id, catalogue_id, description, qty, unit_amount_pence, price_source, sort)
  values (v_id, null, v_job.title || ', the work', 1, v_labour, 'manual', 0);
  insert into public.invoice_lines (invoice_id, catalogue_id, description, qty, unit_amount_pence, price_source, sort, is_fee)
  values (v_id, null, 'Guarantee & Support, 15%', 1, v_fee, 'manual', 1, true);
  if v_materials > 0 then
    insert into public.invoice_lines (invoice_id, catalogue_id, description, qty, unit_amount_pence, price_source, sort)
    values (v_id, null, 'Materials, at cost, nothing added', 1, v_materials, 'manual', 2);
  end if;

  return query select v_id, v_total;
end $function$;

create or replace function public.raise_job_worker_payable(p_job text)
returns table(invoice_id text, total_jmd integer)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_job       jobs%rowtype;
  v_quote     job_quotes%rowtype;
  v_labour    integer;
  v_materials integer;
  v_margin    integer;
  v_rate      integer;
  v_total     integer;
  v_id        text;
begin
  if not public.is_admin() then
    raise exception 'Admin only.' using errcode = '28000';
  end if;

  select * into v_job from jobs where id = p_job;
  if not found then
    raise exception 'No such job.' using errcode = 'check_violation';
  end if;
  if v_job.status <> 'complete' then
    raise exception 'This job is not complete yet. A worker payable is a record of finished, approved work, not an estimate.' using errcode = 'check_violation';
  end if;

  select * into v_quote from job_quotes where job_id = p_job and status = 'accepted';
  if not found then
    raise exception 'No accepted quote on this job.' using errcode = 'check_violation';
  end if;
  if coalesce(v_quote.worker_email, '') = '' then
    raise exception 'This job''s accepted quote has no worker email, so the tradesperson could not read their own payable.' using errcode = 'check_violation';
  end if;

  if exists (
    select 1 from invoices i
     where i.job_id = p_job and i.payable_to = 'worker'
       and i.stage is null and i.status <> 'void'
       and i.addon_id is null   -- 20260928235000
  ) then
    raise exception 'This job''s worker payable has already been raised.' using errcode = 'check_violation';
  end if;

  v_labour    := round(coalesce(v_quote.labour_jmd, 0));
  -- Since 20260914112000: only the materials not already paid to the worker,
  -- up front as a tranche or on a stage payable. It was the whole line.
  v_materials := public.materials_owed_to_worker_jmd(p_job);
  v_margin    := round(v_labour * 0.05);
  v_rate      := v_labour - v_margin;
  v_total     := v_rate + v_materials;

  v_id := public.new_invoice_number();
  insert into public.invoices (id, client_name, client_email, worker_email, job_id, drafted_by, currency, period_label, payable_to, worker_labour_jmd, worker_fee_jmd, notes)
  values (v_id, 'Yaadly Ltd', 'payable@yaadly.invalid', v_quote.worker_email, p_job, 'human', 'JMD', 'Work completed', 'worker', v_labour, v_margin,
    'What Yaadly owes ' || coalesce(v_quote.worker_name, 'the tradesperson') || ' for this job. Yaadly engaged them at their quoted labour price less 5%, agreed in writing before they accepted, plus any materials at cost not already paid to them, with nothing deducted. Yaadly pays this directly. The client is not a party to it.');

  insert into public.invoice_lines (invoice_id, catalogue_id, description, qty, unit_amount_pence, price_source)
  values (v_id, null, v_job.title || ', agreed rate, quoted labour less 5%', 1, v_rate, 'manual');
  if v_materials > 0 then
    insert into public.invoice_lines (invoice_id, catalogue_id, description, qty, unit_amount_pence, price_source)
    values (v_id, null, 'Materials, at cost, nothing deducted', 1, v_materials, 'manual');
  end if;

  return query select v_id, v_total;
end $function$;

create or replace function public.worker_pay_client_unpaid(p_invoice text)
returns text
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_inv          invoices%rowtype;
  v_by_stage     boolean;
  v_stage_billed boolean;
  v_unpaid       text;
begin
  if not (public.is_admin() or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'Admin only.' using errcode = '28000';
  end if;

  select * into v_inv from invoices where id = p_invoice;
  if not found then
    return 'No such invoice.';
  end if;
  if v_inv.payable_to is distinct from 'worker' then
    return format('%s is a client''s bill, not a worker''s pay.', v_inv.id);
  end if;
  if v_inv.job_id is null then
    return format('%s is not attached to a job, so there is no client payment to check it against.', v_inv.id);
  end if;

  -- 20260928235000: an add-on payable is checked against that add-on's own
  -- client invoices, every one of them, and nothing else.
  if v_inv.addon_id is not null then
    if not exists (select 1 from invoices c
                    where c.addon_id = v_inv.addon_id and coalesce(c.payable_to, 'yaadly') = 'yaadly'
                      and c.status = 'paid' and coalesce(c.total_pence, 0) > 0) then
      return format('The client has not paid for this add-on on job %s yet. Pay the worker once its invoice is marked paid on Invoices.', v_inv.job_id);
    end if;
    select string_agg(format('%s (%s)', c.id, c.status), ', ' order by c.id) into v_unpaid
      from invoices c
     where c.addon_id = v_inv.addon_id and coalesce(c.payable_to, 'yaadly') = 'yaadly'
       and c.status not in ('void', 'paid') and coalesce(c.total_pence, 0) > 0;
    if v_unpaid is not null then
      return format('This add-on on job %s still has client money not marked paid: %s. Pay the worker once it is.', v_inv.job_id, v_unpaid);
    end if;
    return null;
  end if;

  v_by_stage := exists (
      select 1 from job_quotes q
       where q.job_id = v_inv.job_id and q.status = 'accepted' and q.billing_mode = 'by_stage')
    or exists (
      select 1 from invoices c
       where c.job_id = v_inv.job_id and coalesce(c.payable_to, 'yaadly') = 'yaadly'
         and c.addon_id is null   -- 20260928235000
         and c.status <> 'void' and coalesce(c.total_pence, 0) > 0 and c.stage >= 1);

  -- 20260919160000: is there a client bill carrying THIS stage number, in any
  -- status? Where there is not, asking for it to be paid can never be met.
  v_stage_billed := v_inv.stage is not null and exists (
      select 1 from invoices c
       where c.job_id = v_inv.job_id and coalesce(c.payable_to, 'yaadly') = 'yaadly'
         and c.addon_id is null   -- 20260928235000
         and c.status <> 'void' and coalesce(c.total_pence, 0) > 0 and c.stage = v_inv.stage);

  if v_inv.stage is null then
    if not exists (select 1 from invoices c
                    where c.job_id = v_inv.job_id and coalesce(c.payable_to, 'yaadly') = 'yaadly'
                      and c.addon_id is null   -- 20260928235000
                      and c.status = 'paid' and coalesce(c.total_pence, 0) > 0) then
      return format('The client has not paid anything on job %s yet. Pay the worker once their bill is marked paid on Invoices.', v_inv.job_id);
    end if;
  elsif v_by_stage and v_stage_billed then
    if not exists (select 1 from invoices c
                    where c.job_id = v_inv.job_id and coalesce(c.payable_to, 'yaadly') = 'yaadly'
                      and c.addon_id is null   -- 20260928235000
                      and c.status = 'paid' and coalesce(c.total_pence, 0) > 0 and c.stage = v_inv.stage) then
      return format('The client has not paid for stage %s of job %s yet. Pay the worker once the client''s stage %s bill is marked paid on Invoices.', v_inv.stage, v_inv.job_id, v_inv.stage);
    end if;
  elsif v_by_stage then
    -- No bill carries this stage number, so the whole-job bill is what covers
    -- this work. Still fails closed: something of the client's must be paid.
    if not exists (select 1 from invoices c
                    where c.job_id = v_inv.job_id and coalesce(c.payable_to, 'yaadly') = 'yaadly'
                      and c.addon_id is null   -- 20260928235000
                      and c.status = 'paid' and coalesce(c.total_pence, 0) > 0 and c.stage is null) then
      return format('The client was never billed separately for stage %s of job %s, and their whole-job bill is not paid. Pay the worker once it is marked paid on Invoices.', v_inv.stage, v_inv.job_id);
    end if;
  else
    if not exists (select 1 from invoices c
                    where c.job_id = v_inv.job_id and coalesce(c.payable_to, 'yaadly') = 'yaadly'
                      and c.addon_id is null   -- 20260928235000
                      and c.status = 'paid' and coalesce(c.total_pence, 0) > 0 and c.stage is null) then
      return format('The client has not paid the bill for job %s yet. Pay the worker once it is marked paid on Invoices.', v_inv.job_id);
    end if;
  end if;

  select string_agg(format('%s (%s)', c.id, c.status), ', ' order by c.id) into v_unpaid
    from invoices c
   where c.job_id = v_inv.job_id
     and coalesce(c.payable_to, 'yaadly') = 'yaadly'
     and c.addon_id is null   -- 20260928235000
     and c.status not in ('void', 'paid')
     and coalesce(c.total_pence, 0) > 0
     and (
       v_inv.stage is null
       or c.stage is null
       or c.stage = 0
       or (v_by_stage and v_stage_billed and c.stage = v_inv.stage)
     );
  if v_unpaid is not null then
    return format('Job %s still has client money not marked paid: %s. Pay the worker once it is.', v_inv.job_id, v_unpaid);
  end if;

  return null;
end
$function$;

create or replace function public.sync_job_status()
returns trigger
language plpgsql
set search_path to 'public'
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

  if coalesce(new.worker_email,'') <> '' then
    -- Was: i.stage is null. Now the invoice that carries the fee, see
    -- 20260913233000.
    select exists (
      select 1 from public.invoices i
       where i.job_id = new.id and i.starts_job and i.status = 'paid'
    ) into fee_paid;

    if not fee_paid then
      new.status := 'awaiting_payment';
      return new;
    end if;

    final_stage_count := public.job_final_stage_count(new.id);

    is_complete := coalesce(new.stage, 0) > coalesce(final_stage_count, 1)
      -- 20260928235000: nothing closes while extra work is still being
      -- agreed, or has been agreed and not signed off.
      and not exists (
        select 1 from public.job_addons a
         where a.job_id = new.id and a.status in ('with_worker', 'with_client', 'agreed')
      );

    if is_complete then
      new.status := 'complete';
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

-- =========================================================================
-- The client confirms on WhatsApp; both sides are told what happened.
-- Founder, 28 Sep 2026: the add-on should be viewable on WhatsApp as a PDF
-- "so the client can confirm, edits only done in portal".
-- =========================================================================

-- "CONFIRM <code>" from the client's own phone accepts the revision the
-- worker sent. Nothing else can be done on WhatsApp: a change, a decline or
-- a new add-on is the portal. Service role only: yaad-inbound calls it with
-- the number Twilio saw, and the phone is the credential, as with
-- agree_quote_via_whatsapp and sign_completion_report_via_whatsapp.
create or replace function public.agree_addon_via_whatsapp(p_phone text, p_code text)
returns table(job_id text, addon_id uuid, invoice_id text)
language plpgsql
security definer
set search_path to 'public'
as $function$
#variable_conflict use_column
declare
  v_code  text := upper(btrim(coalesce(p_code, '')));
  v_n     integer;
  v_a     job_addons%rowtype;
  v_email text;
  v_inv   text;
begin
  if length(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g')) < 9 then
    raise exception 'That number could not be read.';
  end if;
  if v_code !~ '^[0-9A-F]{6}$' then
    raise exception 'That confirmation code is not one Yaadly sent.';
  end if;

  select count(*) into v_n
    from job_addons a join jobs j on j.id = a.job_id
   where a.confirm_code = v_code and a.status = 'with_client'
     and public.same_phone(j.client_phone, p_phone);
  if v_n = 0 then
    raise exception 'No add-on is waiting for you under code %. It may have changed since, so check the latest message or your portal.', v_code;
  end if;
  if v_n > 1 then
    raise exception 'That code matches more than one add-on. Please confirm it in your portal instead.';
  end if;

  select a.* into v_a
    from job_addons a join jobs j on j.id = a.job_id
   where a.confirm_code = v_code and a.status = 'with_client'
     and public.same_phone(j.client_phone, p_phone)
   for update of a;
  select lower(client_email) into v_email from jobs where id = v_a.job_id;

  insert into job_addon_agreements (addon_id, rev, side, email)
  values (v_a.id, v_a.rev, 'client', coalesce(v_email, 'whatsapp:' || p_phone))
  on conflict do nothing;

  if (select count(distinct x.side) from job_addon_agreements x where x.addon_id = v_a.id and x.rev = v_a.rev) < 2 then
    raise exception 'The tradesperson has not agreed this version, so it cannot be booked yet.';
  end if;

  v_inv := public._finish_addon_agreement(v_a.id);
  return query select v_a.job_id, v_a.id, v_inv;
end $function$;

revoke all on function public.agree_addon_via_whatsapp(text, text) from public, anon, authenticated;
grant execute on function public.agree_addon_via_whatsapp(text, text) to service_role;

-- Telling each side. One message per recipient per change, built by
-- yaad-notify-client from the row itself; the trigger sends only ids.
create or replace function public.notify_on_addon_change()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_url  text := 'https://leffyisvfvjwzilydlwf.supabase.co/functions/v1/yaad-notify-client';
  v_hdr  jsonb := jsonb_build_object('Content-Type','application/json','apikey','sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz','Authorization','Bearer '||'sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz');
  v_kinds text[] := '{}';
begin
  if tg_op = 'UPDATE' and new.status = old.status and new.rev = old.rev then
    return new;
  end if;

  if new.status = 'with_worker' then
    v_kinds := array['addon_for_worker'];
  elsif new.status = 'with_client' then
    v_kinds := array['addon_for_client'];
  elsif new.status = 'agreed' then
    v_kinds := array['addon_agreed', 'addon_agreed_worker'];
  elsif new.status = 'declined' then
    -- The side it waited on turned it down: tell the side that sent it.
    v_kinds := array[case when old.status = 'with_worker' then 'addon_closed' else 'addon_closed_worker' end];
  elsif new.status = 'withdrawn' then
    -- The side that sent it took it back: tell the side it was waiting on.
    v_kinds := array[case when old.status = 'with_worker' then 'addon_closed_worker' else 'addon_closed' end];
  end if;

  for i in 1 .. coalesce(array_length(v_kinds, 1), 0) loop
    perform net.http_post(
      url := v_url,
      body := jsonb_build_object('secret', public.notify_trigger_secret(), 'jobId', new.job_id,
        'kind', v_kinds[i], 'meta', jsonb_build_object('addonId', new.id, 'rev', new.rev)),
      headers := v_hdr,
      timeout_milliseconds := 15000
    );
  end loop;
  return new;
end
$function$;

revoke all on function public.notify_on_addon_change() from public, anon, authenticated;
drop trigger if exists trg_notify_on_addon_change on public.job_addons;
create trigger trg_notify_on_addon_change
  after insert or update of status, rev on public.job_addons
  for each row execute function public.notify_on_addon_change();


-- The worker hears when the add-on's up-front invoice is paid, which is when
-- the extra work may start (file_addon_evidence_as_me refuses before then).
-- The second half of "half now, half on sign-off" is paid after the work is
-- done, so only the first client invoice to be paid sends this.
create or replace function public.notify_addon_paid()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.addon_id is not null and coalesce(new.payable_to, 'yaadly') = 'yaadly'
     and new.status = 'paid' and old.status is distinct from 'paid'
     and not exists (select 1 from invoices i where i.addon_id = new.addon_id and i.id <> new.id
                       and coalesce(i.payable_to, 'yaadly') = 'yaadly' and i.status = 'paid') then
    perform net.http_post(
      url := 'https://leffyisvfvjwzilydlwf.supabase.co/functions/v1/yaad-notify-client',
      body := jsonb_build_object('secret', public.notify_trigger_secret(), 'jobId', new.job_id,
        'kind', 'addon_paid_worker', 'meta', jsonb_build_object('addonId', new.addon_id)),
      headers := jsonb_build_object('Content-Type','application/json','apikey','sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz','Authorization','Bearer '||'sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz'),
      timeout_milliseconds := 15000
    );
  end if;
  return new;
end
$function$;

revoke all on function public.notify_addon_paid() from public, anon, authenticated;
drop trigger if exists trg_notify_addon_paid on public.invoices;
create trigger trg_notify_addon_paid
  after update of status on public.invoices
  for each row execute function public.notify_addon_paid();
