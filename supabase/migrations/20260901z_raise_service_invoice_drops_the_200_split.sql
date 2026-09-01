-- Founder's instruction, 1 Sep 2026, same session as the job agency fee
-- change above: no invoice on this account is split into milestone or
-- payment-term pieces, jobs or services alike. The deposit/balance split
-- this function raised for anything £200 and over is retired; a service
-- now always raises exactly one invoice for its full published price. The
-- recurring/monthly branch is untouched, a month's retainer was already one
-- invoice, never a split, so it already matched the rule being set here.

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
  v_recurring boolean;
  v_period text;
  v_id1 text;
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

  else
    v_id1 := public.new_invoice_number();
    insert into public.invoices (id, client_name, client_email, client_address, service_id, drafted_by, period_label, notes)
    values (v_id1, p_client_name, p_client_email, coalesce(p_client_address, ''), p_service_id, 'human', p_period_label,
      'Paid in full before work starts, per Yaadly''s published payment terms.');
    insert into public.invoice_lines (invoice_id, catalogue_id, description, qty, price_source)
    values (v_id1, p_catalogue_id, v_name, 1, 'catalogue_full');

    return query select v_id1, 'full', v_full;
  end if;
end $function$;

revoke all on function public.raise_service_invoice(text, text, text, text, text, text) from public;
grant execute on function public.raise_service_invoice(text, text, text, text, text, text) to authenticated;
