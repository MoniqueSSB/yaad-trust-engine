-- Yaadly invoicing
-- 26 Aug 2026
--
-- The governing rule of this repository applies here with no exceptions:
-- AI drafts, a named human confirms. Money is the sharpest edge of that rule,
-- so the guard is in Postgres and not in a prompt.
--
-- Three things this schema makes structurally impossible:
--   1. An AI-drafted invoice line carrying a price the model chose.
--      Catalogue lines are overwritten with the catalogue amount on write.
--      Anything the model could not map to the catalogue lands as
--      'needs_price' at zero, and blocks the invoice from being sent.
--   2. Sending an invoice that still has an unpriced line.
--   3. Anything but a signed-in admin marking an invoice paid.
--
-- Money is integer pence, GBP. Totals are computed by trigger from the lines
-- and are never accepted from a caller.

-- ---------------------------------------------------------------- catalogue

create table if not exists public.service_catalogue (
  id                    text primary key,
  name                  text not null,
  blurb                 text not null default '',
  founding_pence        integer,
  full_pence            integer,
  recurring             boolean not null default false,
  unit_label            text not null default 'each',
  active                boolean not null default true,
  sort                  integer not null default 0,
  updated_at            timestamptz not null default now(),
  constraint founding_nonneg check (founding_pence is null or founding_pence >= 0),
  constraint full_nonneg     check (full_pence     is null or full_pence     >= 0)
);

comment on table public.service_catalogue is
  'The only place a price may come from. The invoicing agent may cite an id from this table and nothing else.';

insert into public.service_catalogue (id, name, blurb, founding_pence, full_pence, recurring, unit_label, sort) values
  ('eyes-on-it',        'Eyes On It',                            'One site visit. Timestamped photo set, walk-through video, one-page written observation note. No opinion beyond what is visible.',                                    9500,  12500, false, 'visit',  1),
  ('deposit-check',     'Deposit Protection Check',              'Contractor and quote reviewed against real Jamaican material costs and day rates. Payment structure, deposit exposure, works scope, red flags. Written go/no-go.', 14900,  24900, false, 'each',   2),
  ('condition-report',  'Property Condition Report',             'Whole-property condition record: roof, structure, water, electrics, drainage, septic, security. Severity-rated.',                                                  24900,  34900, false, 'each',   3),
  ('setup-pack',        'Project Setup Pack',                    'Milestone payment schedule, evidence protocol, works scope written down, contractor briefed, reporting cadence agreed.',                                          39900,  54900, false, 'each',   4),
  ('retainer',          'Oversight Retainer',                    'Two documented site visits a month, monthly cost-and-progress report, contractor accountability call, WhatsApp line.',                                            39500,  49500, true,  'month',  5),
  ('retainer-ground',   'Oversight Retainer, On The Ground',     'As the Oversight Retainer, founder-attended. From December 2026.',                                                                                                60000,  75000, true,  'month',  6),
  ('care-standard',     'Property Care, standard home',          'Per-visit maintenance check on an empty or elder-occupied home.',                                                                                                  4500,   4500, false, 'visit',  7),
  ('care-large',        'Property Care, large home',             'Per-visit maintenance check on an empty or elder-occupied home.',                                                                                                  7000,   7000, false, 'visit',  8),
  ('care-villa',        'Property Care, villa',                  'Per-visit maintenance check on an empty or elder-occupied home.',                                                                                                  9500,   9500, false, 'visit',  9),
  ('document-check',    'Document Pack Check',                   'Completeness only: what is present, what is missing, what is undated or unsigned. Explicitly not a legal opinion.',                                                9900,  14900, false, 'each',  10)
on conflict (id) do nothing;

-- ----------------------------------------------------------------- invoices

create table if not exists public.invoices (
  id                text primary key,
  client_name       text not null,
  client_email      text not null,
  client_address    text not null default '',
  client_user       uuid references auth.users(id) on delete set null,
  service_id        text references public.services(id) on delete set null,
  job_id            text references public.jobs(id)     on delete set null,
  status            text not null default 'draft'
                      check (status in ('draft','sent','paid','void')),
  drafted_by        text not null default 'human'
                      check (drafted_by in ('human','ai')),
  currency          text not null default 'GBP' check (currency = 'GBP'),
  issue_date        date not null default (now() at time zone 'Europe/London')::date,
  due_date          date not null default ((now() at time zone 'Europe/London')::date + 14),
  period_label      text not null default '',
  subtotal_pence    integer not null default 0,
  vat_pence         integer not null default 0,
  total_pence       integer not null default 0,
  notes             text not null default '',
  covering_note     text not null default '',
  model_note        text not null default '',
  sent_at           timestamptz,
  paid_at           timestamptz,
  paid_reference    text not null default '',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on column public.invoices.drafted_by is
  'ai means the lines were proposed by the invoicing agent. An ai invoice may not carry a manually typed price: see invoice_line_price_guard.';
comment on column public.invoices.covering_note is
  'Plain-English note to the client, drafted by the agent, edited by a human before sending.';

create index if not exists invoices_client_email_idx on public.invoices (lower(client_email));
create index if not exists invoices_status_idx       on public.invoices (status);

create table if not exists public.invoice_lines (
  id                 bigint generated always as identity primary key,
  invoice_id         text not null references public.invoices(id) on delete cascade,
  catalogue_id       text references public.service_catalogue(id),
  description        text not null,
  qty                numeric(8,2) not null default 1 check (qty > 0),
  unit_amount_pence  integer not null default 0 check (unit_amount_pence >= 0),
  line_total_pence   integer not null default 0,
  price_source       text not null
                       check (price_source in ('catalogue_founding','catalogue_full','manual','needs_price')),
  sort               integer not null default 0
);

comment on column public.invoice_lines.price_source is
  'catalogue_* means the amount is taken from service_catalogue and overwritten on write. needs_price means the agent could not map it: zero, and it blocks sending. manual is a human-typed amount and is refused on an ai-drafted invoice.';

create index if not exists invoice_lines_invoice_idx on public.invoice_lines (invoice_id);

-- --------------------------------------------------------- numbering

create sequence if not exists public.invoice_seq start 1;

create or replace function public.new_invoice_number()
returns text language sql volatile as $$
  select 'INV-' || to_char(now() at time zone 'Europe/London', 'YYYY')
      || '-' || lpad(nextval('public.invoice_seq')::text, 4, '0');
$$;

-- ------------------------------------------------- the price guard

create or replace function public.invoice_line_price_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_drafted_by text;
  v_status     text;
  v_amount     integer;
begin
  select drafted_by, status into v_drafted_by, v_status
    from public.invoices where id = new.invoice_id;

  if v_status is null then
    raise exception 'invoice % does not exist', new.invoice_id;
  end if;

  -- Money on an invoice that has left the building does not move.
  if v_status <> 'draft' then
    raise exception 'invoice % is % and its lines are frozen', new.invoice_id, v_status;
  end if;

  if new.price_source in ('catalogue_founding','catalogue_full') then
    if new.catalogue_id is null then
      raise exception 'a catalogue-priced line must name a catalogue_id';
    end if;
    select case when new.price_source = 'catalogue_founding' then founding_pence else full_pence end
      into v_amount
      from public.service_catalogue
     where id = new.catalogue_id and active;
    if v_amount is null then
      raise exception 'no active % price for catalogue item %', new.price_source, new.catalogue_id;
    end if;
    -- Not a check, an overwrite. Whatever the caller sent is discarded.
    new.unit_amount_pence := v_amount;

  elsif new.price_source = 'needs_price' then
    new.unit_amount_pence := 0;

  elsif new.price_source = 'manual' then
    if v_drafted_by = 'ai' then
      raise exception 'a manually priced line cannot be added to an AI-drafted invoice. Set the invoice drafted_by to human first, which is a decision a person makes on the record.';
    end if;
  end if;

  new.line_total_pence := round(new.qty * new.unit_amount_pence);
  return new;
end $$;

drop trigger if exists invoice_lines_price_guard on public.invoice_lines;
create trigger invoice_lines_price_guard
  before insert or update on public.invoice_lines
  for each row execute function public.invoice_line_price_guard();

-- ------------------------------------------------- totals

create or replace function public.invoice_recalc()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_invoice text := coalesce(new.invoice_id, old.invoice_id);
  v_sub     integer;
begin
  select coalesce(sum(line_total_pence), 0) into v_sub
    from public.invoice_lines where invoice_id = v_invoice;

  -- Yaadly Ltd is not VAT registered. When that changes, this is the one
  -- place to change it, and app_settings.vat_rate_bp is where the rate goes.
  update public.invoices
     set subtotal_pence = v_sub,
         vat_pence      = 0,
         total_pence    = v_sub,
         updated_at     = now()
   where id = v_invoice;

  return null;
end $$;

drop trigger if exists invoice_lines_recalc on public.invoice_lines;
create trigger invoice_lines_recalc
  after insert or update or delete on public.invoice_lines
  for each row execute function public.invoice_recalc();

-- ------------------------------------------------- status guard

create or replace function public.invoice_status_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_unpriced integer;
  v_lines    integer;
begin
  if new.status = old.status then
    return new;
  end if;

  if old.status = 'draft' and new.status = 'sent' then
    select count(*) filter (where price_source = 'needs_price'), count(*)
      into v_unpriced, v_lines
      from public.invoice_lines where invoice_id = new.id;
    if v_lines = 0 then
      raise exception 'invoice % has no lines', new.id;
    end if;
    if v_unpriced > 0 then
      raise exception 'invoice % has % line(s) the agent could not price. Price them or remove them before sending.', new.id, v_unpriced;
    end if;
    new.sent_at := now();

  elsif old.status = 'sent' and new.status = 'paid' then
    -- The one step the machine never takes on its own.
    if not public.is_admin() then
      raise exception 'only a signed-in Yaadly admin may mark an invoice paid';
    end if;
    new.paid_at := now();

  elsif new.status = 'void' and old.status in ('draft','sent') then
    if not public.is_admin() then
      raise exception 'only a signed-in Yaadly admin may void an invoice';
    end if;

  else
    raise exception 'invoice % cannot go from % to %', new.id, old.status, new.status;
  end if;

  new.updated_at := now();
  return new;
end $$;

drop trigger if exists invoices_status_guard on public.invoices;
create trigger invoices_status_guard
  before update on public.invoices
  for each row execute function public.invoice_status_guard();

-- ------------------------------------------------- RLS

alter table public.service_catalogue enable row level security;
alter table public.invoices          enable row level security;
alter table public.invoice_lines     enable row level security;

drop policy if exists catalogue_read       on public.service_catalogue;
drop policy if exists catalogue_admin      on public.service_catalogue;
create policy catalogue_read  on public.service_catalogue for select to authenticated using (active or public.is_admin());
create policy catalogue_admin on public.service_catalogue for all    to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists invoices_admin       on public.invoices;
drop policy if exists invoices_client_read on public.invoices;
create policy invoices_admin       on public.invoices for all    to authenticated using (public.is_admin()) with check (public.is_admin());
-- A client sees their own invoices, and never a draft.
create policy invoices_client_read on public.invoices for select to authenticated
  using (status <> 'draft' and lower(client_email) = lower(auth.jwt() ->> 'email'));

drop policy if exists lines_admin       on public.invoice_lines;
drop policy if exists lines_client_read on public.invoice_lines;
create policy lines_admin       on public.invoice_lines for all    to authenticated using (public.is_admin()) with check (public.is_admin());
create policy lines_client_read on public.invoice_lines for select to authenticated
  using (exists (
    select 1 from public.invoices i
     where i.id = invoice_lines.invoice_id
       and i.status <> 'draft'
       and lower(i.client_email) = lower(auth.jwt() ->> 'email')
  ));

-- ------------------------------------------------- issuer details

insert into public.app_settings (key, value) values
  ('invoice_issuer_name',    'Yaadly Ltd'),
  ('invoice_issuer_number',  '17358077'),
  ('invoice_issuer_address', '55 Remington Road, London N15 6SS'),
  ('invoice_issuer_email',   'monique@yaadly.co.uk'),
  ('invoice_issuer_phone',   '+44 7767 171858'),
  ('invoice_vat_status',     'Not VAT registered'),
  ('invoice_payment_terms',  'Payment due within 14 days of the invoice date.'),
  ('invoice_pay_to',         'Pay by the Stripe link on this invoice, or by bank transfer to the account named in your engagement email.')
on conflict (key) do nothing;

-- ------------------------------------------------- deletion guard
-- A sent invoice is a document that exists in the world. Its lines do not
-- quietly disappear afterwards. Void it and raise a new one instead.
create or replace function public.invoice_line_delete_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_status text;
begin
  select status into v_status from public.invoices where id = old.invoice_id;
  if v_status is not null and v_status <> 'draft' then
    raise exception 'invoice % is % and its lines cannot be deleted. Void it and raise a new one.', old.invoice_id, v_status;
  end if;
  return old;
end $$;

drop trigger if exists invoice_lines_delete_guard on public.invoice_lines;
create trigger invoice_lines_delete_guard
  before delete on public.invoice_lines
  for each row execute function public.invoice_line_delete_guard();

-- ------------------------------------------------- advisor cleanup
create or replace function public.new_invoice_number()
returns text language sql volatile set search_path = public as $$
  select 'INV-' || to_char(now() at time zone 'Europe/London', 'YYYY')
      || '-' || lpad(nextval('public.invoice_seq')::text, 4, '0');
$$;

-- Trigger functions are for triggers. Nothing should reach them through
-- PostgREST, so the API's grant comes off. Postgres still runs them as
-- trigger bodies, which is the only place they are meant to run.
revoke execute on function public.invoice_line_price_guard()  from anon, authenticated;
revoke execute on function public.invoice_line_delete_guard() from anon, authenticated;
revoke execute on function public.invoice_recalc()            from anon, authenticated;
revoke execute on function public.invoice_status_guard()      from anon, authenticated;
