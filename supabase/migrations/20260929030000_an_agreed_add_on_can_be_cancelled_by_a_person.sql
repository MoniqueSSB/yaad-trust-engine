-- An agreed add-on can be cancelled by a named person at Yaadly.
--
-- Found on the first live test, 28 September 2026: once both sides had agreed
-- an add-on (20260928235000) nothing could close it. decline_addon_as_me()
-- only works while it is still being agreed, so an agreed add-on the client
-- then changed their mind about, or a test one, held the job short of
-- complete for good. Monique: "clean up".
--
-- cancel_addon(p_addon, p_reason), admin only, the one way out:
--   * only while nothing on it has been paid. Money received is a refund
--     decision, and this function does not make it.
--   * a DRAFT client invoice for it is voided in the same step: it was never
--     sent, so nobody has been asked to pay it. A SENT one is refused, with
--     the invoice named: void it on Invoices first, deliberately, because the
--     client has it.
--   * the add-on becomes 'cancelled', with who, when and why recorded. It no
--     longer holds the job open (sync_job_status only counts with_worker,
--     with_client and agreed).
--   * no message is sent to either side. A cancellation after agreement is a
--     conversation, and the desk has it.

alter table public.job_addons drop constraint if exists job_addons_status_check;
alter table public.job_addons add constraint job_addons_status_check
  check (status in ('with_worker', 'with_client', 'agreed', 'declined', 'withdrawn', 'signed_off', 'cancelled'));

create or replace function public.cancel_addon(p_addon uuid, p_reason text)
returns table(status text, voided text)
language plpgsql
security definer
set search_path to 'public'
as $function$
#variable_conflict use_column
declare
  v_email  text := lower(nullif(btrim(auth.jwt() ->> 'email'), ''));
  v_a      job_addons%rowtype;
  v_sent   text;
  v_voided text;
begin
  if not public.is_admin() then
    raise exception 'Admin only.' using errcode = '28000';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Say why it is being cancelled. It is kept on the add-on.';
  end if;
  select * into v_a from job_addons where id = p_addon for update;
  if not found then
    raise exception 'No such add-on.';
  end if;
  if v_a.status not in ('with_worker', 'with_client', 'agreed') then
    raise exception 'This add-on is % already, so there is nothing to cancel.', replace(v_a.status, '_', ' ');
  end if;
  if exists (select 1 from invoices i where i.addon_id = p_addon and i.status = 'paid') then
    raise exception 'Money has been received or paid out on this add-on. Cancelling it is a refund decision, not this button.';
  end if;
  select string_agg(i.id, ', ' order by i.id) into v_sent
    from invoices i where i.addon_id = p_addon and i.status = 'sent';
  if v_sent is not null then
    raise exception 'The client has been sent % for this add-on. Void it on Invoices first, then cancel.', v_sent;
  end if;

  select string_agg(i.id, ', ' order by i.id) into v_voided
    from invoices i where i.addon_id = p_addon and i.status = 'draft';
  update invoices set status = 'void' where addon_id = p_addon and status = 'draft';

  update job_addons
     set status = 'cancelled', closed_by = v_email, closed_reason = left(btrim(p_reason), 500),
         closed_at = now(), updated_at = now()
   where id = p_addon;

  perform public._touch_job(v_a.job_id);
  return query select 'cancelled'::text, v_voided;
end $function$;

revoke all on function public.cancel_addon(uuid, text) from public, anon;
grant execute on function public.cancel_addon(uuid, text) to authenticated;

comment on function public.cancel_addon(uuid, text) is
  'Admin only. Cancels an add-on that nothing has been paid on, voiding its draft invoice; refuses a sent invoice (void it first) and any payment (a refund decision). Records who and why. Sends no message. 20260929030000.';
