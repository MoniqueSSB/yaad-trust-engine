-- Follow-on to 20260901t, same evening: the published payment terms name
-- three shapes, not two. "Reports under £200 are paid in full before we
-- start. £200 and over is half before and half on delivery." covered the
-- first two. "The Oversight Retainer is billed monthly, and you can
-- cancel with 30 days notice" is the third, and raise_service_invoice()
-- had no idea it existed - a retainer would have gone through the £200
-- split branch and come out as a one-off deposit and balance, which is
-- not what a monthly retainer is.
--
-- service_catalogue.recurring already says which items this applies to;
-- nothing new to ask an admin. A recurring item raises exactly one
-- invoice for the period given (defaulting to the current month), never
-- split, its own notes naming the cancellation term rather than the
-- £200 rule that does not apply to it.

create or replace function public.raise_service_invoice(
  p_catalogue_id text,
  p_client_name text,
  p_client_email text,
  p_client_address text default '',
  p_service_id text default null,
  p_period_label text default ''
)
returns table(invoice_id text, kind text, total_pence integer)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_name text;
  v_full integer;
  v_half integer;
  v_recurring boolean;
  v_period text;
  v_id1 text;
  v_id2 text;
begin
  if not public.is_admin() then
    raise exception 'Admin only.' using errcode = '28000';
  end if;

  select name, full_pence, recurring into v_name, v_full, v_recurring
    from public.service_catalogue where id = p_catalogue_id and active;
  if v_full is null then
    raise exception 'No active price for catalogue item %.', p_catalogue_id using errcode = 'check_violation';
  end if;
  if p_client_email is null or btrim(p_client_email) = '' then
    raise exception 'A client email is required.' using errcode = 'check_violation';
  end if;

  if v_recurring then
    v_period := nullif(btrim(p_period_label), '');
    if v_period is null then
      v_period := to_char(now() at time zone 'Europe/London', 'Mon YYYY');
    end if;

    v_id1 := public.new_invoice_number();
    insert into public.invoices (id, client_name, client_email, client_address, service_id, drafted_by, period_label, notes)
    values (v_id1, p_client_name, p_client_email, coalesce(p_client_address, ''), p_service_id, 'human', v_period,
      'Billed monthly, per Yaadly''s published payment terms. Cancel with 30 days notice.');
    insert into public.invoice_lines (invoice_id, catalogue_id, description, qty, price_source)
    values (v_id1, p_catalogue_id, v_name || ' — ' || v_period, 1, 'catalogue_full');

    return query select v_id1, 'monthly', v_full;

  elsif v_full < 20000 then
    v_id1 := public.new_invoice_number();
    insert into public.invoices (id, client_name, client_email, client_address, service_id, drafted_by, period_label, notes)
    values (v_id1, p_client_name, p_client_email, coalesce(p_client_address, ''), p_service_id, 'human', p_period_label,
      'Paid in full before work starts: under £200, per Yaadly''s published payment terms.');
    insert into public.invoice_lines (invoice_id, catalogue_id, description, qty, price_source)
    values (v_id1, p_catalogue_id, v_name, 1, 'catalogue_full');

    return query select v_id1, 'full', v_full;
  else
    v_half := v_full / 2;

    v_id1 := public.new_invoice_number();
    insert into public.invoices (id, client_name, client_email, client_address, service_id, drafted_by, period_label, notes)
    values (v_id1, p_client_name, p_client_email, coalesce(p_client_address, ''), p_service_id, 'human', p_period_label,
      'Deposit, half the total, due before work starts: £200 and over is split, per Yaadly''s published payment terms.');
    insert into public.invoice_lines (invoice_id, catalogue_id, description, qty, unit_amount_pence, price_source)
    values (v_id1, p_catalogue_id, v_name || ' — deposit, 50% of the total', 1, v_half, 'manual');

    v_id2 := public.new_invoice_number();
    insert into public.invoices (id, client_name, client_email, client_address, service_id, drafted_by, period_label, notes)
    values (v_id2, p_client_name, p_client_email, coalesce(p_client_address, ''), p_service_id, 'human', p_period_label,
      'Balance, due on delivery, same published terms as the deposit invoice ' || v_id1 || '.');
    insert into public.invoice_lines (invoice_id, catalogue_id, description, qty, unit_amount_pence, price_source)
    values (v_id2, p_catalogue_id, v_name || ' — balance, 50% of the total, on delivery', 1, v_full - v_half, 'manual');

    return query select v_id1, 'deposit', v_half
      union all select v_id2, 'balance', v_full - v_half;
  end if;
end $function$;
