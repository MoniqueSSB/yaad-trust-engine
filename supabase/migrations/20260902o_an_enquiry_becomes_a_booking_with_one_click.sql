-- An enquiry becomes a booking with one click (2 Sep 2026, founder's own
-- shape for the services lane). Services bookings are NOT created by the
-- public: "what if a lot of people click and I don't have the bandwidth".
-- The enquiry form stays the only public door. A booking is born when a
-- named admin converts an enquiry in the concierge desk, sits held until
-- that admin confirms the work, and goes live on its own the moment the
-- invoice is marked paid. Same three-beat shape as the marketplace payment
-- gate in 20260902f: human converts, human confirms, payment moves it.
--
-- services predates the migrations directory: it exists live with no
-- schema of record in the repo. The create below is a no-op against the
-- live database and exists so the repo finally carries the drawing of the
-- structure that is already standing.

create table if not exists public.services (
  id           text primary key,
  type         text,
  client_name  text,
  client_email text,
  parish       text,
  price        text,
  provider     text default 'Founder',
  stage        integer default 0,
  notes        text,
  updated_at   timestamptz default now(),
  portal_code  text default upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8))
);

-- What the booking lifecycle needs and the live table lacks. status is the
-- new spine: held (converted, waiting on the admin to confirm the work),
-- awaiting_payment (confirmed, invoice raised, waiting on money),
-- live (paid, being delivered), complete, cancelled. stage stays what it
-- already is, the client-facing rail position the portal draws.
alter table public.services add column if not exists created_at   timestamptz default now();
alter table public.services add column if not exists status       text default 'held';
alter table public.services add column if not exists client_phone text;
alter table public.services add column if not exists catalogue_id text references public.service_catalogue(id);
alter table public.services add column if not exists enquiry_id   uuid references public.enquiries(id);
alter table public.services add column if not exists due_at       date;

alter table public.services drop constraint if exists services_status_check;
alter table public.services add constraint services_status_check
  check (status is null or status = any (array[
    'held','awaiting_payment','live','complete','cancelled'
  ]));

-- Rows typed in by hand before this migration have status null. Null reads
-- as "predates the lifecycle", and the desk shows it that way rather than
-- pretending an old row went through a gate that did not exist yet.

-- One click in the desk: enquiry in, held booking out. The price is read
-- from service_catalogue, never typed, the same rule the invoice path
-- already enforces. The enquiry's contact line is split for the caller:
-- the desk offers it as a default and the admin corrects it in the drawer.
create or replace function public.convert_enquiry_to_service(
  p_enquiry uuid,
  p_catalogue_id text,
  p_client_name text default '',
  p_client_email text default '',
  p_phone text default '',
  p_parish text default ''
)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_enq  enquiries%rowtype;
  v_name text;
  v_full integer;
  v_id   text;
begin
  if not public.is_admin() then
    raise exception 'Admin only.' using errcode = '28000';
  end if;

  select * into v_enq from public.enquiries where id = p_enquiry for update;
  if not found then
    raise exception 'No such enquiry.';
  end if;
  if exists (select 1 from public.services s where s.enquiry_id = p_enquiry) then
    raise exception 'This enquiry is already a booking. Find it under Services.';
  end if;

  select name, full_pence into v_name, v_full
    from public.service_catalogue where id = p_catalogue_id and active;
  if v_full is null then
    raise exception 'No active price for catalogue item %.', p_catalogue_id
      using errcode = 'check_violation';
  end if;

  loop
    v_id := 'SVC-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
    exit when not exists (select 1 from public.services s where s.id = v_id);
  end loop;

  insert into public.services
    (id, type, catalogue_id, client_name, client_email, client_phone,
     parish, price, stage, status, notes, enquiry_id)
  values
    (v_id, v_name, p_catalogue_id,
     nullif(btrim(p_client_name), ''),
     nullif(btrim(lower(p_client_email)), ''),
     nullif(btrim(p_phone), ''),
     nullif(btrim(p_parish), ''),
     '£' || (v_full / 100)::text,
     0, 'held',
     'From enquiry: ' || coalesce(v_enq.message, ''),
     p_enquiry);

  update public.enquiries set status = 'converted' where id = p_enquiry;

  return v_id;
end $function$;

revoke all on function public.convert_enquiry_to_service(uuid, text, text, text, text, text) from public;
grant execute on function public.convert_enquiry_to_service(uuid, text, text, text, text, text) to authenticated;

-- The stop the founder asked for, made real. Confirming the work is one
-- named admin's click on a held booking: it raises the invoice against the
-- catalogue price (through raise_service_invoice, so the linkage and the
-- price rule both hold) and parks the booking at awaiting_payment. If the
-- money already landed, it goes straight to live. The invoice still gets
-- emailed from the Invoices view, the same send button as every invoice.
create or replace function public.confirm_service_booking(
  p_service text,
  p_due date default null
)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_svc  services%rowtype;
  v_inv  text;
  v_paid boolean;
begin
  if not public.is_admin() then
    raise exception 'Admin only.' using errcode = '28000';
  end if;

  select * into v_svc from public.services where id = p_service for update;
  if not found then
    raise exception 'No such booking.';
  end if;
  if coalesce(v_svc.status, '') <> 'held' then
    raise exception 'Only a held booking can be confirmed. This one is %.',
      coalesce(v_svc.status, 'from before bookings had a lifecycle');
  end if;
  if v_svc.catalogue_id is null then
    raise exception 'This booking is not linked to a catalogue service, so the invoice cannot be priced. Set catalogue_id first.';
  end if;
  if coalesce(v_svc.client_email, '') = '' then
    raise exception 'A client email is required before the invoice can be raised.';
  end if;

  select exists (
    select 1 from public.invoices i
     where i.service_id = p_service and i.status = 'paid'
  ) into v_paid;

  if not exists (
    select 1 from public.invoices i
     where i.service_id = p_service and i.status <> 'void'
  ) then
    select invoice_id into v_inv
      from public.raise_service_invoice(
        v_svc.catalogue_id,
        coalesce(v_svc.client_name, ''),
        v_svc.client_email,
        '',
        p_service,
        '')
     limit 1;
  end if;

  update public.services
     set status = case when v_paid then 'live' else 'awaiting_payment' end,
         stage  = case when v_paid then greatest(coalesce(stage, 0), 1) else stage end,
         due_at = coalesce(p_due, due_at),
         updated_at = now()
   where id = p_service;

  return coalesce(v_inv, p_service);
end $function$;

revoke all on function public.confirm_service_booking(text, date) from public;
grant execute on function public.confirm_service_booking(text, date) to authenticated;

-- The moment the invoice is marked paid by a named admin in the desk, the
-- booking goes live on its own: status live, rail at least at Intake. Only
-- a booking that was confirmed moves; a held one stays held even if money
-- lands early, because the founder's confirm is the gate, not the payment.
-- Mirror of start_job_on_agency_fee_paid in 20260902f.
create or replace function public.start_service_on_invoice_paid()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.service_id is not null
     and new.status = 'paid' and coalesce(old.status, '') is distinct from 'paid' then
    update public.services
       set status = 'live',
           stage = greatest(coalesce(stage, 0), 1),
           updated_at = now()
     where id = new.service_id and status = 'awaiting_payment';
  end if;
  return new;
end $function$;

drop trigger if exists trg_start_service_on_invoice_paid on public.invoices;
create trigger trg_start_service_on_invoice_paid
  after update on public.invoices
  for each row execute function public.start_service_on_invoice_paid();
