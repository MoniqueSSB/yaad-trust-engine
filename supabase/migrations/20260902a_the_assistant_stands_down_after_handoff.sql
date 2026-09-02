-- The assistant did not stand down after a handoff.
--
-- When somebody asked to speak to a person, yaad-inbound told them Monique
-- would come back to them herself, and then answered their very next message
-- as a bot anyway, because wants_human was one model call's read of one
-- message and nothing remembered it. A person who asked for a person and
-- keeps getting the machine is in a phone tree, which is exactly the
-- experience this product promises not to be.
--
-- human_handling is the memory. yaad-inbound sets it true the moment it hands
-- a thread over (a client asking for a person, or three messages the
-- assistant could not make a job out of), and while it is true the function
-- keeps the transcript and the photos and pings Monique's phone, but never
-- runs the model and never asks another question. The desk's own reply lane
-- (yaad-desk-reply) also sets it, because a thread a human has spoken on is a
-- human's thread. Only the desk's "Hand back to the assistant" button clears
-- it. Deliberately no timeout: a bot barging back into the middle of a live
-- human conversation because a clock ran out is worse than a thread that
-- stays quiet until a person decides otherwise.
--
-- No RLS change needed: intake_threads_admin_all (20260829a) already lets the
-- desk read and write every column, and the client's own read policy
-- (20260829q) is select only.

alter table public.intake_threads
  add column if not exists human_handling boolean not null default false;

comment on column public.intake_threads.human_handling is
  'True while Monique has this conversation. yaad-inbound keeps the record and notifies, but does not answer. Cleared only from the desk.';
