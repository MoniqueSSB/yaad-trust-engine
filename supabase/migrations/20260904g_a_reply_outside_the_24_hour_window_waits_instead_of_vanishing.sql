-- A reply outside the 24 hour window waits instead of vanishing.
--
-- THE PROBLEM, and it is WhatsApp's rule rather than Twilio's or ours. A
-- business may send free text only within 24 hours of the person's last
-- message. Outside that, Twilio refuses with code 63016 and nothing is
-- delivered. yaad-desk-reply has always reported that honestly, which was the
-- right thing to do and also the end of the road: Monique's typed reply was
-- simply lost, and she had to remember to send it again later.
--
-- WHY IT BITES HERE PARTICULARLY. She works a few focused hours a day, in the
-- evenings, around a baby. A client messages on Tuesday afternoon; she gets to
-- the desk on Wednesday night. That is outside the window, every time, and it
-- is the ordinary shape of her week rather than an edge case. The assistant
-- has meanwhile promised the client "she will come back to you on this
-- number".
--
-- WHAT THIS TABLE IS. A reply that could not be delivered, kept until it can
-- be. yaad-desk-reply writes the row and sends an approved template nudge
-- instead; the moment that number sends anything at all, the window reopens
-- and yaad-inbound flushes whatever is waiting, in the order it was written.
--
-- WHY NOT PUT HER WORDS IN THE TEMPLATE. Because a template has fixed variable
-- slots approved for one specific sentence, and yaad-notify-client's own
-- header already records why reusing one to carry a different sentence is how
-- a WhatsApp sender gets flagged. The template says a reply is waiting. The
-- reply itself goes as free text once the client has reopened the window,
-- which is the only way it arrives in her actual words.
--
-- NOT A RETRY QUEUE. There is no timer and no cron. Nothing here fires on its
-- own; it is drained by the client's own next message, which is the event that
-- makes delivery legal in the first place. A row that is never drained is a
-- client who never wrote back, and that is a fact worth being able to see
-- rather than a job for a scheduler.

create table if not exists public.pending_desk_replies (
  id          bigint generated always as identity primary key,
  channel     text        not null check (channel in ('whatsapp', 'sms')),
  to_addr     text        not null,
  job_id      text        not null default '',
  body        text        not null,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz,
  attempts    integer     not null default 0,
  last_error  text        not null default ''
);

comment on table public.pending_desk_replies is
  'Monique''s typed replies that WhatsApp would not deliver because the 24 hour window had closed. Drained by yaad-inbound the moment that number sends anything, which is what reopens the window. No timer, no cron: the client''s own message is the trigger.';

-- The drain is "everything still waiting for this number, oldest first", so
-- that is what the index serves.
create index if not exists pending_desk_replies_waiting_idx
  on public.pending_desk_replies (to_addr, created_at)
  where sent_at is null;

alter table public.pending_desk_replies enable row level security;

-- The desk reads it, so Monique can see a reply is still waiting to land and
-- is not left assuming it went. Writes come from yaad-desk-reply and
-- yaad-inbound on the service role.
drop policy if exists "pending_desk_replies_admin_read" on public.pending_desk_replies;
create policy "pending_desk_replies_admin_read" on public.pending_desk_replies
  for select using (is_admin());

revoke all on public.pending_desk_replies from anon;
grant select on public.pending_desk_replies to authenticated;
grant all on public.pending_desk_replies to service_role;
