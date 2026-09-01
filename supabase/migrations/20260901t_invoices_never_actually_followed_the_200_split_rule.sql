-- Founder's own instruction, live: "the payment terms should be on the
-- portal once it is agreed and the invoices should be raised to align
-- with this." The terms she means are already published, word for word,
-- on docs/payments.html: reports under £200 paid in full before work
-- starts, £200 and over is half before and half on delivery. Nothing in
-- yaad-invoice's own drafting flow knew that rule - an admin types a
-- free-text instruction, the AI proposes catalogue lines, and the split
-- exists only if the admin remembers it and types two invoices by hand.
--
-- This is a second, narrower door onto the same invoices/invoice_lines
-- tables 20260826_invoicing.sql built, not a new invoicing system: one
-- RPC that reads the real catalogue price (never a typed number) and
-- raises either one invoice (under £200, full amount, due before start)
-- or two (£200 and over, 50/50, deposit before start and balance on
-- delivery), each carrying the policy in its own notes so a client
-- reading it sees why it is priced the way it is.
--
-- price_source = 'manual' is used for the half-amounts, not a new
-- 'catalogue_half' branch on the price guard: 'manual' already means
-- exactly "a human-set amount, not the model's", which is what a
-- policy-computed half genuinely is, and drafted_by is set to 'human'
-- here regardless of caller, since this whole path IS a human (the
-- admin invoking it) choosing to raise these invoices, not an AI
-- drafting freeform lines. The full-amount, under-£200 case still goes
-- through 'catalogue_full', so it is still impossible for a full-price
-- line to silently carry a wrong number.

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
  v_id1 text;
  v_id2 text;
begin
  if not public.is_admin() then
    raise exception 'Admin only.' using errcode = '28000';
  end if;

  select name, full_pence into v_name, v_full
    from public.service_catalogue where id = p_catalogue_id and active;
  if v_full is null then
    raise exception 'No active price for catalogue item %.', p_catalogue_id using errcode = 'check_violation';
  end if;
  if p_client_email is null or btrim(p_client_email) = '' then
    raise exception 'A client email is required.' using errcode = 'check_violation';
  end if;

  if v_full < 20000 then
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

revoke all on function public.raise_service_invoice(text, text, text, text, text, text) from public;
grant execute on function public.raise_service_invoice(text, text, text, text, text, text) to authenticated;
