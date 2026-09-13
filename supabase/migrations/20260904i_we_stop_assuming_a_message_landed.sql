-- We stop assuming a message landed.
--
-- Every WhatsApp send in this system has been fire and forget. Twilio accepts
-- the request, returns 201, and that is the last anybody knows. A 201 means
-- Twilio took it, not that it reached a phone: a number that has left WhatsApp,
-- a handset that never comes online, a message the carrier drops, all look
-- identical to success from here.
--
-- That matters most for the one message a person is waiting on. When Monique
-- replies from the desk, the assistant has already told that client "she will
-- come back to you on this number". If it silently fails she has no way to
-- know, and the client is left with a promise nobody kept.
--
-- Twilio will post the real outcome to a callback URL as it changes: queued,
-- sent, delivered, read, failed, undelivered. This table is where those land.
--
-- KEYED ON TWILIO'S OWN MESSAGE SID, because that is the only identifier the
-- callback carries. The sending code records the row when Twilio accepts the
-- message; the callback updates the same row as the status moves. A callback
-- for a SID we never recorded is stored anyway rather than dropped, because a
-- send from somewhere this migration does not know about is a fact worth
-- keeping, not an error.
--
-- NO MESSAGE BODY, EVER. The status of a message is operational; its contents
-- are a client's own words and already live on the thread. Storing them twice
-- would be two places to leak them from.

create table if not exists public.message_deliveries (
  message_sid text primary key,
  to_addr     text        not null default '',
  channel     text        not null default 'whatsapp',
  kind        text        not null default '',
  job_id      text        not null default '',
  status      text        not null default 'accepted',
  error_code  text        not null default '',
  sent_at     timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.message_deliveries is
  'What actually happened to each outbound Twilio message, keyed on Twilio''s own SID. Written when a send is accepted and updated by yaad-message-status as Twilio reports queued, sent, delivered, read, failed or undelivered. Never carries the message body: the status is operational, the words belong to the thread.';

create index if not exists message_deliveries_to_idx  on public.message_deliveries (to_addr, sent_at desc);
create index if not exists message_deliveries_job_idx on public.message_deliveries (job_id, sent_at desc) where job_id <> '';

alter table public.message_deliveries enable row level security;

-- The desk reads it, so a failed reply is visible rather than assumed
-- delivered. Written only by the functions, on the service role.
drop policy if exists "message_deliveries_admin_read" on public.message_deliveries;
create policy "message_deliveries_admin_read" on public.message_deliveries
  for select using (is_admin());

revoke all on public.message_deliveries from anon;
grant select on public.message_deliveries to authenticated;
grant all on public.message_deliveries to service_role;
