-- A sent invoice is reissued, never edited.
--
-- Founder decision, 14 September 2026, asked "once an invoice has been sent,
-- should you be able to edit it?": "No, void and reissue". A sent invoice is
-- the copy the client holds, so its lines stay frozen (invoice_line_price_guard,
-- unchanged). To correct one, it is voided and an editable copy is opened as a
-- new numbered draft, in one step, and each names the other so the record
-- shows both.
--
-- WHAT CHANGES
--   invoices.replaces      on a reissued draft, the sent invoice it replaced.
--   reissue_invoice(id)    voids a sent client invoice and returns the new
--                          draft. All or nothing: if any part fails, nothing
--                          is voided and nothing is written.
--
-- THREE SHAPES
--   An invoice on its own (a service, or a job bill never split): copied line
--   for line into a new draft, then voided.
--   A job bill that has parts: copied the same way, and its live parts move to
--   point at the new bill, so the job's balance stays whole and nothing is on
--   two documents. Then the old bill is voided, which the void guard now allows
--   because it has no live parts left.
--   A part: voided while its bill is still a draft, which puts its amount back
--   on the bill (invoice_part_void_restore, unchanged), and the same amounts are
--   requested again through request_invoice_part, so every rule that applies to
--   a part (the fee moves whole, starts_job goes with it) applies to the new one.
--   A part whose bill has already gone out is refused, as the void guard
--   already refuses to void it.
--
-- REFUSED
--   anything not sent: a draft is edited as it is, a paid invoice is money in,
--   and a void one is already gone;
--   what Yaadly owes a tradesperson (payable_to = 'worker'), which is not a
--   client invoice;
--   an invoice Stripe has recorded a card payment against: mark it paid, or
--   refund it in Stripe, first. Otherwise the money would sit against a void.
--
-- NO HUMAN GATE MOVES. Reissuing writes a draft and emails nobody. Sending it,
-- marking it paid and voiding it are the same named-human clicks as before.
-- It is admin only, and the status guard still requires an admin to void.
--
-- Catalogue lines are copied as catalogue lines, so the price guard reads them
-- from the service list as it stands today, the same rule as any new line.
-- A line whose service is no longer on the list is copied at its old amount as
-- a "my figure" line rather than failing the whole reissue.
--
-- Live definitions of invoice_status_guard(), invoice_line_price_guard(),
-- new_invoice_number() and request_invoice_part() were read on 14 September
-- 2026 before this was written; request_invoice_part matches 20260913233000.

-- ------------------------------------------------------------------ column

alter table public.invoices
  add column if not exists replaces text references public.invoices(id);

create index if not exists invoices_replaces_idx on public.invoices(replaces) where replaces is not null;

comment on column public.invoices.replaces is
  'On a reissued invoice, the sent invoice it replaced, which is now void. NULL otherwise. 20260914210000.';

-- ------------------------------------------------------------------ reissue

create or replace function public.reissue_invoice(p_id text)
returns table(invoice_id text, total integer)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_old   invoices%rowtype;
  v_bill  invoices%rowtype;
  v_id    text;
  v_items jsonb := '[]'::jsonb;
  l       record;
  v_line  bigint;
begin
  if not public.is_admin() then
    raise exception 'Admin only.' using errcode = '28000';
  end if;

  select * into v_old from invoices where id = p_id for update;
  if not found then
    raise exception 'No such invoice.' using errcode = 'check_violation';
  end if;
  if v_old.status <> 'sent' then
    raise exception '% is %. Only a sent invoice is reissued: a draft is edited as it is, and a paid one is money in.', p_id, v_old.status
      using errcode = 'check_violation';
  end if;
  if coalesce(v_old.payable_to, 'yaadly') <> 'yaadly' then
    raise exception '% is what Yaadly owes a tradesperson, not a client invoice, so it is not reissued.', p_id
      using errcode = 'check_violation';
  end if;
  if exists (select 1 from invoice_payments p where p.invoice_id = p_id and p.status = 'succeeded') then
    raise exception 'Stripe has recorded a card payment against %. Mark it paid, or refund it in Stripe, before reissuing it.', p_id
      using errcode = 'check_violation';
  end if;

  -- ---------------------------------------------------------- a part
  if v_old.part_of is not null then
    select * into v_bill from invoices where id = v_old.part_of for update;
    if v_bill.status <> 'draft' then
      raise exception 'The rest of this job has already gone out on %, which is %, so % cannot be reissued: its amount would have nowhere to go.', v_old.part_of, v_bill.status, p_id
        using errcode = 'check_violation';
    end if;

    -- Voiding puts every amount back on the bill: onto the line it came from,
    -- or as a new line when the whole line had been taken (from_line is then
    -- null, or no longer on the bill). The same amounts are then requested
    -- again, from wherever they landed.
    update invoices set status = 'void' where id = p_id;

    for l in select * from invoice_lines where invoice_lines.invoice_id = p_id order by sort, id loop
      if l.from_line is not null and exists (
        select 1 from invoice_lines b where b.id = l.from_line and b.invoice_id = v_old.part_of
      ) then
        v_line := l.from_line;
      else
        select b.id into v_line from invoice_lines b
         where b.invoice_id = v_old.part_of and b.sort = 100 + l.sort
           and b.description = regexp_replace(l.description, ', part$', '')
         order by b.id desc limit 1;
        if v_line is null then
          raise exception 'The line "%" on % could not be found on % after it was put back, so nothing was changed.', l.description, p_id, v_old.part_of
            using errcode = 'check_violation';
        end if;
      end if;
      v_items := v_items || jsonb_build_array(jsonb_build_object('line', v_line, 'amount', l.line_total_pence));
    end loop;

    select r.invoice_id into v_id from public.request_invoice_part(v_old.part_of, v_items) r;
    update invoices set replaces = p_id where id = v_id;

  -- ---------------------------------------------- a bill, or an invoice on its own
  else
    v_id := public.new_invoice_number();
    insert into public.invoices (id, client_name, client_email, client_address, client_user, service_id, job_id,
                                 drafted_by, currency, period_label, notes, covering_note, stage,
                                 client_company, po_number, payable_to, worker_email, replaces)
    values (v_id, v_old.client_name, v_old.client_email, coalesce(v_old.client_address, ''), v_old.client_user, v_old.service_id, v_old.job_id,
            'human', v_old.currency, v_old.period_label, v_old.notes, v_old.covering_note, v_old.stage,
            v_old.client_company, v_old.po_number, 'yaadly', v_old.worker_email, p_id);

    -- The insert trigger sets starts_job for any whole-job bill. Follow the
    -- old one instead: if its fee went out on a part, the part still starts
    -- the job, not this copy.
    update invoices set starts_job = v_old.starts_job where id = v_id;

    for l in select * from invoice_lines where invoice_lines.invoice_id = p_id order by sort, id loop
      if l.price_source in ('catalogue_founding', 'catalogue_full')
         and not exists (select 1 from service_catalogue c where c.id = l.catalogue_id and c.active) then
        insert into public.invoice_lines (invoice_id, catalogue_id, description, qty, unit_amount_pence, price_source, sort, is_fee)
        values (v_id, null, l.description, l.qty, l.unit_amount_pence, 'manual', l.sort, l.is_fee);
      else
        insert into public.invoice_lines (invoice_id, catalogue_id, description, qty, unit_amount_pence, price_source, sort, is_fee)
        values (v_id, l.catalogue_id, l.description, l.qty, l.unit_amount_pence, l.price_source, l.sort, l.is_fee);
      end if;
    end loop;

    -- Live parts follow the bill. Void ones stay where they were, as history.
    update invoices set part_of = v_id where part_of = p_id and status <> 'void';

    update invoices set status = 'void' where id = p_id;
  end if;

  return query select i.id, i.total_pence from public.invoices i where i.id = v_id;
end $function$;

comment on function public.reissue_invoice(text) is
  'Voids a sent client invoice and opens an editable copy as a new numbered draft that names it in replaces. A bill''s live parts move to the copy; a part is put back on its draft bill and requested again. Refuses a card-paid invoice. Emails nobody. 20260914210000.';

-- ------------------------------------------------------------------ grants
--
-- Supabase grants anon and authenticated directly on every new public
-- function, and "revoke from public" does not touch a direct grant
-- (20260913223042). So each is named.

revoke all on function public.reissue_invoice(text) from public, anon;
grant execute on function public.reissue_invoice(text) to authenticated;
