-- The founder prices her own invoices (2 Sep 2026, her instruction: "make
-- it so I can edit the invoices, just put whatever price, and add invoices
-- at what I want it to be"). The machinery already had the right idea:
-- price_source 'manual' has meant "a human-set amount" since 20260826, and
-- the price guard already refuses it only on AI-drafted invoices. What was
-- missing was any door that used it. Two doors open here; the desk's line
-- editor gains the third tier in the same commit.
--
-- The AI-invents-a-price rule is untouched. 'manual' still requires
-- drafted_by = 'human', catalogue tiers are still overwritten from the
-- catalogue on write, and nothing in any agent path can reach these.

-- Technical Sign-off joins the catalogue so it is bookable like the rest
-- (her instruction, same message). Priced as the services page prints it:
-- £245 per sign-off, no separate founding rate shown, so both tiers carry
-- the same figure and the founding tier is simply not a discount here.
insert into public.service_catalogue (id, name, full_pence, founding_pence, active, sort)
values ('technical-signoff', 'Technical Sign-off', 24500, 24500, true, 11)
on conflict (id) do nothing;

-- Confirm the work, now with the price decision attached, which is where
-- it always actually happened in her head: full price, founding rate, or
-- her own figure in pounds. The two catalogue tiers stay guard-priced from
-- service_catalogue; the typed figure becomes a manual line on a
-- human-drafted invoice, exactly what 'manual' was built to mean. The old
-- two-argument version is dropped so there is exactly one door.
drop function if exists public.confirm_service_booking(text, date);

create or replace function public.confirm_service_booking(
  p_service text,
  p_due date default null,
  p_price text default 'full'
)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_svc    services%rowtype;
  v_choice text;
  v_pence  integer;
  v_name   text;
  v_inv    text;
  v_total  integer;
  v_paid   boolean;
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

  v_choice := lower(btrim(coalesce(p_price, 'full')));
  if v_choice in ('', 'full') then
    v_choice := 'catalogue_full';
  elsif v_choice = 'founding' then
    v_choice := 'catalogue_founding';
  else
    -- Her own figure, in pounds, optionally with a £ sign and pence.
    v_choice := regexp_replace(v_choice, '[£,\s]', '', 'g');
    if v_choice !~ '^\d+(\.\d{1,2})?$' then
      raise exception 'The price must be full, founding, or a figure in pounds like 149 or 149.50.'
        using errcode = 'check_violation';
    end if;
    v_pence := round(v_choice::numeric * 100);
    if v_pence <= 0 then
      raise exception 'A zero invoice is not an invoice. Type a real figure.' using errcode = 'check_violation';
    end if;
    v_choice := 'manual';
  end if;

  select name into v_name from public.service_catalogue where id = v_svc.catalogue_id;

  select exists (
    select 1 from public.invoices i
     where i.service_id = p_service and i.status = 'paid'
  ) into v_paid;

  if not exists (
    select 1 from public.invoices i
     where i.service_id = p_service and i.status <> 'void'
  ) then
    v_inv := public.new_invoice_number();
    insert into public.invoices (id, client_name, client_email, client_address, service_id, drafted_by, notes)
    values (v_inv, coalesce(v_svc.client_name, ''), v_svc.client_email, '', p_service, 'human',
      case v_choice
        when 'manual' then 'Priced by the founder for this booking.'
        when 'catalogue_founding' then 'Founding rate, per the published service list.'
        else 'Full price, per the published service list.'
      end);
    if v_choice = 'manual' then
      insert into public.invoice_lines (invoice_id, catalogue_id, description, qty, unit_amount_pence, price_source)
      values (v_inv, v_svc.catalogue_id, coalesce(v_name, v_svc.type, 'Service'), 1, v_pence, 'manual');
    else
      insert into public.invoice_lines (invoice_id, catalogue_id, description, qty, price_source)
      values (v_inv, v_svc.catalogue_id, coalesce(v_name, v_svc.type, 'Service'), 1, v_choice);
    end if;

    select total_pence into v_total from public.invoices where id = v_inv;
    -- The row's display price follows what was actually invoiced, so the
    -- desk and the portal never show a figure the invoice contradicts.
    update public.services
       set price = '£' || trim(trailing '.' from trim(trailing '0' from (v_total / 100.0)::text))
     where id = p_service;
  end if;

  update public.services
     set status = case when v_paid then 'live' else 'awaiting_payment' end,
         stage  = case when v_paid then greatest(coalesce(stage, 0), 1) else stage end,
         due_at = coalesce(p_due, due_at),
         updated_at = now()
   where id = p_service;

  return coalesce(v_inv, p_service);
end $$;

revoke all on function public.confirm_service_booking(text, date, text) from public;
grant execute on function public.confirm_service_booking(text, date, text) to authenticated;
