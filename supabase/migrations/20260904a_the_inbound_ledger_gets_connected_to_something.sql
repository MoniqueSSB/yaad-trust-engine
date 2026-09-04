-- The inbound ledger gets connected to something.
--
-- 20260830a created public.wa_inbound_seen and said, in its own last
-- paragraph, exactly what was meant to happen next: "channel is here because
-- yaad-inbound has the same hole on the Twilio and Resend paths and will use
-- the same ledger, keyed on their own message ids."
--
-- It never did. yaad-whatsapp-webhook wrote the 29 rows that are in there, and
-- that function was deleted on 1 September 2026. Since then the table has been
-- a control that exists on paper: named in supabase/functions/README.md as the
-- thing that stops a redelivered message being read as the client's next
-- answer, and read or written by nothing at all. A control nobody runs is
-- worse than no control, because it reads as covered.
--
-- yaad-inbound now writes it, keyed on Twilio's MessageSid and Resend's
-- email_id. This migration adds the two things that path needs and the table
-- does not have yet.
--
-- ONE. An index for the throttle. The same ledger answers "how many messages
-- has this number sent in the last hour", which is the other thing yaad-inbound
-- was missing: the website chat door has been throttled three ways since 2
-- September on the reasoning that every message through it is a model call
-- somebody pays for, and that reasoning is identical on WhatsApp, where the
-- call carries a larger budget and five or six table reads in front of it. One
-- table, two jobs, no new table to keep swept.
--
-- TWO. A sweep. The ledger only has to remember long enough to recognise a
-- redelivery, and long enough to hold an hour's throttle window. Seven days is
-- generously past both. Without this it grows forever, on a free plan, holding
-- rows whose only remaining purpose is to be counted.

create index if not exists wa_inbound_seen_from_seen_idx
  on public.wa_inbound_seen (from_addr, seen_at desc);

comment on table public.wa_inbound_seen is
  'Inbound message ledger for yaad-inbound. Two jobs: a repeat delivery of the same provider message id is recognised and does nothing, and the row count per from_addr per hour is the WhatsApp and SMS throttle. Written before any state changes, on the service role. No message body, ever.';

create or replace function public.wa_inbound_seen_sweep()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  n integer;
begin
  delete from public.wa_inbound_seen where seen_at < now() - interval '7 days';
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Called by yaad-inbound on the service role, one request in twenty, never on
-- the critical path. Nothing client-side has any business calling it.
revoke all on function public.wa_inbound_seen_sweep() from anon, authenticated, public;
grant execute on function public.wa_inbound_seen_sweep() to service_role;
