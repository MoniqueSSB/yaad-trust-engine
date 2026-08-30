-- The WhatsApp agent asked for everything at once, which meant it asked for
-- nothing.
--
-- A client opening with "I would like to start a job" got a job card built
-- from that one line: no location, no access contact, no timing, and a title
-- like "WhatsApp job, needs review". The client was never asked a single
-- question. All the asking landed on Monique, by hand, after the fact, which
-- is the manual work the agent exists to end. And a client shown six blanks
-- in one message fills in two of them; a client asked one short question at a
-- time answers all six. That is the founder's instruction of 29 August 2026:
-- greet, then ask one by one, then build the job from the full set.
--
-- Asking one question at a time needs the one thing the webhook never had:
-- memory between messages. This table is that memory. One row per WhatsApp
-- number mid-intake, holding the answers gathered so far; the row is deleted
-- the moment the job is created, so at rest this table is nearly always
-- empty. It is working state, not a record: the record is the job.
--
-- No anon grants and no authenticated writes. The only writer is the webhook
-- on the service role. Admin can read, because a half-finished intake is a
-- useful thing to see on the desk when somebody phones up mid-conversation.

create table if not exists public.wa_intake_sessions (
  wa_id       text primary key,
  answers     jsonb not null default '{}'::jsonb,
  photo_count integer not null default 0,
  started_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- One request must not be able to park a megabyte in a row. Same budget
-- reasoning as the caps on enquiries.
alter table public.wa_intake_sessions
  add constraint wa_intake_sessions_sane_size
  check (pg_column_size(answers) <= 20000 and photo_count between 0 and 500);

alter table public.wa_intake_sessions enable row level security;

create policy "admin reads intake sessions"
  on public.wa_intake_sessions for select to authenticated
  using (is_admin());
