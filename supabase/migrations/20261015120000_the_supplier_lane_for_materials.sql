-- The supplier lane for materials.
--
-- Founder, 15 October 2026: "make a supplier portal, just like the clients
-- have one", "on the app". The five rules were decided the same day and are
-- in the ideas ledger: supplier paid by bank transfer within 7 days of the
-- site evidence; collection by the tradesperson is the default, delivery the
-- exception with the address on the delivery note only; the supplier lane is
-- the default for new jobs, worker-buys the exception; shortfalls and price
-- rises are a held release and a conversation, nothing docked by a machine;
-- guardrail 4 applies, a supplier is supply.
--
-- WHAT THIS IS BUILT ON. The site terms have said since 7 October that
-- Yaadly buys materials from the merchant and pays the merchant directly,
-- and that the tradesperson is paid labour only. The database has run the
-- older rule since 14 September: materials money released to the worker up
-- front, receipt back afterwards. This file adds the lane the terms describe
-- WITHOUT removing the lane that is live. A supplier order is a
-- materials_releases row made out to a supplier instead of the worker, so it
-- passes through the same two gates that already exist and are not touched:
-- the client has nominated the materials store (20260828c), and nothing is
-- released above what the client has paid for materials (20260914112000).
--
-- WHAT THE SUPPLIER MAY DO. Confirm the order, mark it ready, mark it
-- collected against the collection code, attach their invoice number. Four
-- functions, each refusing any release that is not made out to the caller's
-- supplier, each moving goods and never money.
--
-- WHAT STAYS A NAMED HUMAN'S CLICK. Releasing (release_materials_tranche,
-- admin only, unchanged). Marking the money sent (mark_materials_sent,
-- unchanged). The match between the goods and the site is the materials
-- evidence the tradesperson files in the nominated store; nothing here reads
-- it or acts on it. The governing rule in CLAUDE.md section 2 holds.
--
-- WHAT THE SUPPLIER SEES. my_supplier_orders() returns their own releases
-- with the job's id, title, parish, stage count and the collector's first
-- name. No client column, no address, no free-text store description (that
-- names where the valuable things are kept), no labour figure.

begin;

-- ------------------------------------------------------------------ suppliers

create table if not exists public.suppliers (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  parish         text not null default '',
  contact_name   text not null default '',
  contact_email  text not null,
  contact_phone  text not null default '',
  account_ref    text not null unique,
  supplier_user  uuid references auth.users(id) on delete set null,
  is_active      boolean not null default true,
  notes          text not null default '',
  created_at     timestamptz not null default now(),
  created_by     text not null default ''
);

alter table public.suppliers drop constraint if exists suppliers_contact_email_lower;
alter table public.suppliers add constraint suppliers_contact_email_lower
  check (contact_email = lower(btrim(contact_email)) and contact_email <> '');

alter table public.suppliers drop constraint if exists suppliers_sane_lengths;
alter table public.suppliers add constraint suppliers_sane_lengths check (
  length(name) between 2 and 120 and length(parish) <= 60 and length(contact_name) <= 120
  and length(contact_email) <= 200 and length(contact_phone) <= 40 and length(notes) <= 2000);

comment on table public.suppliers is
  'A hardware merchant Yaadly buys materials from on account. One row per supplier, added by the desk. The supplier signs in to /portal/supplier with contact_email; supplier_user is filled on first sign-in by bind_my_supplier(). 20261015120000.';
comment on column public.suppliers.account_ref is
  'The account reference the supplier quotes back to Yaadly, YSA-0001 style. Set by add_supplier().';

alter table public.suppliers enable row level security;

drop policy if exists suppliers_admin on public.suppliers;
create policy suppliers_admin on public.suppliers
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- A supplier reads their own row and nobody else's. Matched on the signed-in
-- user once bound, and on the email before that so the first sign-in works.
drop policy if exists suppliers_own_read on public.suppliers;
create policy suppliers_own_read on public.suppliers
  for select to authenticated
  using (
    supplier_user = auth.uid()
    or contact_email = nullif(btrim(lower(coalesce(auth.jwt() ->> 'email', ''))), '')
  );

create or replace function public.add_supplier(
  p_name text, p_parish text default '', p_contact_name text default '',
  p_contact_email text default '', p_contact_phone text default '', p_notes text default '')
returns public.suppliers
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_row public.suppliers;
  v_n   int;
begin
  if not public.is_admin() then
    raise exception 'Only the desk adds a supplier.' using errcode = '42501';
  end if;
  select count(*) + 1 into v_n from public.suppliers;
  insert into public.suppliers (name, parish, contact_name, contact_email, contact_phone, notes, account_ref, created_by)
  values (btrim(p_name), btrim(coalesce(p_parish, '')), btrim(coalesce(p_contact_name, '')),
          lower(btrim(coalesce(p_contact_email, ''))), btrim(coalesce(p_contact_phone, '')),
          btrim(coalesce(p_notes, '')), 'YSA-' || lpad(v_n::text, 4, '0'),
          coalesce(auth.jwt() ->> 'email', ''))
  returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.add_supplier(text, text, text, text, text, text) from public, anon;
grant execute on function public.add_supplier(text, text, text, text, text, text) to authenticated;

-- Same shape as bind_my_portal_claims(): called on the way into the portal,
-- attaches the signed-in user to the supplier row that carries their email,
-- a no-op for everybody else. Returns the supplier id, or null.
create or replace function public.bind_my_supplier()
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_email text := nullif(btrim(lower(coalesce(auth.jwt() ->> 'email', ''))), '');
  v_id    uuid;
begin
  if v_email is null or auth.uid() is null then return null; end if;
  update public.suppliers
     set supplier_user = auth.uid()
   where contact_email = v_email and supplier_user is null and is_active;
  select id into v_id from public.suppliers
   where supplier_user = auth.uid() and is_active
   order by created_at limit 1;
  return v_id;
end;
$$;

revoke all on function public.bind_my_supplier() from public, anon;
grant execute on function public.bind_my_supplier() to authenticated;

-- -------------------------------------------------- the release, made out to a supplier

alter table public.materials_releases
  add column if not exists payee           text not null default 'worker',
  add column if not exists supplier_id     uuid references public.suppliers(id),
  add column if not exists collection_code text not null default '',
  add column if not exists fulfilment      text not null default 'collection',
  add column if not exists lines           jsonb not null default '[]'::jsonb,
  add column if not exists confirmed_at    timestamptz,
  add column if not exists ready_at        timestamptz,
  add column if not exists collected_at    timestamptz;

alter table public.materials_releases drop constraint if exists materials_releases_payee_chk;
alter table public.materials_releases add constraint materials_releases_payee_chk
  check (payee in ('worker', 'supplier')
         and (payee = 'worker') = (supplier_id is null));

alter table public.materials_releases drop constraint if exists materials_releases_fulfilment_chk;
alter table public.materials_releases add constraint materials_releases_fulfilment_chk
  check (fulfilment in ('collection', 'delivery'));

comment on column public.materials_releases.payee is
  'worker: the lane live since 28 Aug, money to the worker who buys the goods. supplier: Yaadly buys from a supplier on account; the row is the order. Default worker, so every row before 20261015120000 is unchanged.';
comment on column public.materials_releases.collection_code is
  'Given by the tradesperson at the supplier''s counter. The supplier releases goods only against it (supplier_mark_collected). Shown to the desk and the worker, never to the supplier.';
comment on column public.materials_releases.fulfilment is
  'collection (default, founder 15 Oct 2026) or delivery (heavy loads; the address goes on the delivery note, never into this table or the portal).';
comment on column public.materials_releases.lines is
  'The order lines, [{"item","qty","unit_jmd"}], typed at release from the accepted quote. Informational for the supplier; amount_jmd is the figure the gates check.';
comment on column public.materials_releases.receipt_ref is
  'Worker lane: the supplier receipt the worker brought back. Supplier lane: the supplier''s own invoice number, attached by them (supplier_attach_invoice). Either way the document the money is accounted for by.';

create index if not exists materials_releases_supplier_idx
  on public.materials_releases (supplier_id, created_at desc) where supplier_id is not null;

-- The supplier reads their own releases. The existing party_read policy for
-- the client and worker, and the admin policy, are untouched.
drop policy if exists materials_releases_supplier_read on public.materials_releases;
create policy materials_releases_supplier_read on public.materials_releases
  for select to authenticated
  using (payee = 'supplier' and exists (
    select 1 from public.suppliers s
     where s.id = materials_releases.supplier_id and s.supplier_user = auth.uid()));

-- The worker is told by WhatsApp when materials money is sent to THEM. A
-- supplier payment is not their money and must not raise that message. Body
-- otherwise identical to 20260914190000, read before this was written.
create or replace function public.notify_worker_materials_sent()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.sent_at is not null and old.sent_at is null and coalesce(new.payee, 'worker') = 'worker' then
    perform net.http_post(
      url := 'https://leffyisvfvjwzilydlwf.supabase.co/functions/v1/yaad-notify-client',
      body := jsonb_build_object('secret', public.notify_trigger_secret(), 'jobId', new.job_id,
        'kind', 'materials_sent_worker', 'meta', jsonb_build_object('releaseId', new.id)),
      headers := jsonb_build_object('Content-Type','application/json','apikey','sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz','Authorization','Bearer '||'sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz'),
      timeout_milliseconds := 15000
    );
  end if;
  return new;
end
$function$;

-- The desk's one click for the supplier lane. Wraps release_materials_tranche
-- so both gates and the admin check run exactly as they do today, then makes
-- the row out to the supplier and gives it a collection code. Nothing here
-- loosens a gate: if the wrapped call refuses, this refuses.
create or replace function public.release_materials_to_supplier(
  p_job text, p_amount_jmd numeric, p_supplier uuid,
  p_stage integer default null, p_lines jsonb default '[]'::jsonb,
  p_fulfilment text default 'collection', p_note text default '')
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id   uuid;
  v_code text;
begin
  if not public.is_admin() then
    raise exception 'Only the desk orders from a supplier.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.suppliers where id = p_supplier and is_active) then
    raise exception 'No active supplier with that id.';
  end if;
  if p_fulfilment not in ('collection', 'delivery') then
    raise exception 'Fulfilment is collection or delivery.' using errcode = 'check_violation';
  end if;

  select r.release_id into v_id
    from public.release_materials_tranche(p_job, p_amount_jmd, '', p_stage, p_note) r;

  -- Four digits, letters that cannot be misread at a counter.
  v_code := 'YC-' || lpad((floor(random() * 9000) + 1000)::int::text, 4, '0');

  update public.materials_releases
     set payee = 'supplier', supplier_id = p_supplier, collection_code = v_code,
         fulfilment = p_fulfilment, lines = coalesce(p_lines, '[]'::jsonb)
   where id = v_id;
  return v_id;
end;
$$;

revoke all on function public.release_materials_to_supplier(text, numeric, uuid, integer, jsonb, text, text) from public, anon;
grant execute on function public.release_materials_to_supplier(text, numeric, uuid, integer, jsonb, text, text) to authenticated;

-- ------------------------------------------------ what the supplier does

-- One check, used by all four, so the rule cannot drift: the caller is a
-- signed-in, bound, active supplier and the release is made out to them.
create or replace function public.supplier_owns_release(p_release uuid)
returns public.materials_releases
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_rel public.materials_releases;
begin
  if auth.uid() is null then
    raise exception 'Sign in to your supplier portal first.' using errcode = '28000';
  end if;
  select r.* into v_rel from public.materials_releases r
   where r.id = p_release for update;
  if not found then raise exception 'no such release'; end if;
  if v_rel.payee <> 'supplier' or not exists (
       select 1 from public.suppliers s where s.id = v_rel.supplier_id and s.supplier_user = auth.uid() and s.is_active) then
    raise exception 'This order is not made out to your account.' using errcode = '42501';
  end if;
  if v_rel.released_at is null then
    raise exception 'This order has not been released by Yaadly yet.';
  end if;
  return v_rel;
end;
$$;
revoke all on function public.supplier_owns_release(uuid) from public, anon, authenticated;

create or replace function public.supplier_confirm_release(p_release uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_rel public.materials_releases := public.supplier_owns_release(p_release);
begin
  if v_rel.confirmed_at is not null then return; end if;
  update public.materials_releases set confirmed_at = now() where id = p_release;
end;
$$;

create or replace function public.supplier_mark_ready(p_release uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_rel public.materials_releases := public.supplier_owns_release(p_release);
begin
  if v_rel.confirmed_at is null then
    raise exception 'Confirm the price and stock first.';
  end if;
  if v_rel.ready_at is not null then return; end if;
  update public.materials_releases set ready_at = now() where id = p_release;
end;
$$;

-- The code is the whole door. A wrong code is refused with the same wording
-- every time, so the person at the counter learns nothing from a near miss.
create or replace function public.supplier_mark_collected(p_release uuid, p_code text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_rel public.materials_releases := public.supplier_owns_release(p_release);
begin
  if v_rel.ready_at is null then
    raise exception 'Mark the order ready before releasing the goods.';
  end if;
  if v_rel.collected_at is not null then return; end if;
  if v_rel.fulfilment = 'collection'
     and upper(btrim(coalesce(p_code, ''))) is distinct from upper(v_rel.collection_code) then
    raise exception 'That code does not match this order. Do not release the goods.' using errcode = '42501';
  end if;
  update public.materials_releases set collected_at = now() where id = p_release;
end;
$$;

-- Write once, like a receipt on the worker lane: a recorded number is not
-- overwritten. A correction is a conversation with the desk.
create or replace function public.supplier_attach_invoice(p_release uuid, p_ref text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_rel public.materials_releases := public.supplier_owns_release(p_release);
  v_ref text := btrim(coalesce(p_ref, ''));
begin
  if v_ref = '' or length(v_ref) > 60 then
    raise exception 'Type your invoice number.' using errcode = 'check_violation';
  end if;
  if btrim(v_rel.receipt_ref) <> '' then
    raise exception 'Invoice % is already on this order. Ask Yaadly if it needs correcting.', v_rel.receipt_ref;
  end if;
  update public.materials_releases
     set receipt_ref = v_ref, receipt_at = now(), receipt_by = coalesce(auth.jwt() ->> 'email', '')
   where id = p_release;
end;
$$;

revoke all on function public.supplier_confirm_release(uuid) from public, anon;
revoke all on function public.supplier_mark_ready(uuid) from public, anon;
revoke all on function public.supplier_mark_collected(uuid, text) from public, anon;
revoke all on function public.supplier_attach_invoice(uuid, text) from public, anon;
grant execute on function public.supplier_confirm_release(uuid) to authenticated;
grant execute on function public.supplier_mark_ready(uuid) to authenticated;
grant execute on function public.supplier_mark_collected(uuid, text) to authenticated;
grant execute on function public.supplier_attach_invoice(uuid, text) to authenticated;

-- ------------------------------------------------ what the supplier sees

-- The supplier's orders, with just enough of the job to make sense of them.
-- Same shape as my_quoted_jobs(): security definer, scoped by auth.uid(),
-- and the columns it does not return are the point of it.
create or replace function public.my_supplier_orders()
returns table(
  id uuid, job_id text, job_title text, parish text, stage integer, stages integer,  -- stages null until an approved Kickoff Pack says
  collector text, store_type text, fulfilment text, amount_jmd numeric, lines jsonb,
  released_at timestamptz, confirmed_at timestamptz, ready_at timestamptz, collected_at timestamptz,
  evidenced_at timestamptz, sent_at timestamptz, sent_ref text, receipt_ref text, receipt_at timestamptz
)
language sql
stable
security definer
set search_path = 'public'
as $function$
  select r.id, r.job_id, j.title, j.parish, r.stage,
         (select jsonb_array_length(p.docs->'payment_schedule'->'stages')
            from public.kickoff_packs p
           where p.job_id = j.id and p.status = 'approved'
           order by p.updated_at desc limit 1),
         split_part(btrim(coalesce(j.worker_name, '')), ' ', 1),
         j.materials_store_type, r.fulfilment, r.amount_jmd, r.lines,
         r.released_at, r.confirmed_at, r.ready_at, r.collected_at,
         (select min(e.created_at) from public.evidence e
           where e.job_id = r.job_id and e.kind = 'materials'
             and (r.stage is null or e.stage = r.stage)
             and e.created_at >= coalesce(r.collected_at, r.released_at)),
         r.sent_at, r.sent_ref, r.receipt_ref, r.receipt_at
    from public.materials_releases r
    join public.jobs j on j.id = r.job_id
    join public.suppliers s on s.id = r.supplier_id
   where auth.uid() is not null
     and r.payee = 'supplier'
     and r.released_at is not null
     and s.supplier_user = auth.uid()
     and s.is_active
   order by r.released_at desc;
$function$;

revoke all on function public.my_supplier_orders() from public, anon;
grant execute on function public.my_supplier_orders() to authenticated;

commit;
