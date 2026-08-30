-- A retry could answer the same question twice.
--
-- Meta retries a webhook delivery whenever it does not get a prompt 2xx, and a
-- retry carries the same message.id as the first attempt. The webhook does slow
-- work before it answers: it transcribes voice notes and calls a model. So a
-- retry was not a rare edge, it was the ordinary consequence of a slow message.
--
-- Nothing downstream noticed. A retry re-entered the guided intake and was
-- treated as the client's next reply, so one answer advanced the questionnaire
-- two steps and a question was never asked. On the last step it ran finalise
-- twice and inserted a second JOB-WA- job for one client. A photo was counted
-- twice. None of it was visible from the chat: the client saw a question
-- skipped and assumed they had mistyped.
--
-- The fix is a ledger of message ids, written before any state changes and
-- before the slow work starts. First sighting inserts and carries on. A repeat
-- conflicts, returns no row, and the handler answers 200 without touching
-- anything. The cost of a retry is one insert.
--
-- The id is the primary key because the ledger has exactly one job. Not a
-- client table: no name, no message body, nothing but the id, where it came
-- from and when it was seen. RLS on with no policies, so anon and authenticated
-- see nothing at all and only the service role the webhook runs as can write.
--
-- channel is here because yaad-inbound has the same hole on the Twilio and
-- Resend paths and will use the same ledger, keyed on their own message ids.

create table if not exists public.wa_inbound_seen (
  wa_message_id text primary key,
  channel       text not null default 'whatsapp',
  from_addr     text not null default '',
  seen_at       timestamptz not null default now()
);

alter table public.wa_inbound_seen enable row level security;

-- Webhook-side ledger, not client data. Service role only.
revoke all on public.wa_inbound_seen from anon, authenticated;
grant  all on public.wa_inbound_seen to service_role;
