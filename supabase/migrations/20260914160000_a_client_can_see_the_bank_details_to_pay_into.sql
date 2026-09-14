-- A client can see the bank details to pay an invoice into, and nothing else
-- from app_settings.
--
-- Founder's instruction, 14 Sep 2026: bank transfer to the business account
-- is the second way to pay an invoice from the portal, beside card.
--
-- app_settings is admin only ("app_settings are admin only", is_admin()), and
-- it should stay that way: it holds the desk phone, the notification topic and
-- the invoice issuer's details. So instead of opening the table, one setting
-- is added and one function returns that setting and nothing else.
--
--   invoice_bank_details  free text the founder writes, as it should appear to
--                         a client: bank, account name, sort code or routing,
--                         account number. Starts EMPTY. Nothing is invented:
--                         while it is empty the portal shows no bank box.
--   client_bank_details() returns that one value to a signed-in user, or ''
--                         when it is not set. SECURITY DEFINER so it can read
--                         the admin-only table; it reads exactly one key.
--
-- NOTHING ABOUT PAYING CHANGES. Showing the details moves no money and marks
-- nothing paid. A transfer is still marked paid by a person at the desk.

insert into public.app_settings (key, value)
values ('invoice_bank_details', '')
on conflict (key) do nothing;

create or replace function public.client_bank_details()
returns text
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce((select btrim(value) from public.app_settings where key = 'invoice_bank_details'), '');
$function$;

comment on function public.client_bank_details() is
  'The business bank details a client pays an invoice into, as written in app_settings.invoice_bank_details, and nothing else from that admin-only table. Empty when not set. 20260914160000.';

revoke execute on function public.client_bank_details() from public, anon;
grant execute on function public.client_bank_details() to authenticated;
