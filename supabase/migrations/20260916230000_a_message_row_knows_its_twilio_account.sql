-- The desk's "Look it up in Twilio" button opened Twilio's general logs page
-- instead of the message, 16 Sep 2026.
--
-- Twilio's page for one message is addressed by the account AND the message:
-- /console/sms/logs/<AccountSid>/<MessageSid>. The desk only ever had the
-- message half, so Twilio had nothing to open.
--
-- The account id is not typed into the desk's source. It is not a credential,
-- but a committed identifier stays public for the life of the repository, and
-- Twilio already sends it, signed, with every delivery receipt. So
-- yaad-message-status records it here, and the desk reads it from the row.
--
-- Rows written before this migration have no account id. yaad-message-status
-- fills every blank row on each receipt it verifies: there is one Twilio
-- account behind this business, so the first receipt after deploy mends the
-- history too.
--
-- No new grant or policy: the table's existing admin-read policy and the
-- table-level grants cover a new column.

alter table public.message_deliveries
  add column if not exists account_sid text not null default '';

comment on column public.message_deliveries.account_sid is
  'Twilio AccountSid from the signed status receipt. Only used to build the desk''s link to this message in the Twilio console.';
