-- Monique answers back inside the website chat, 2 Sep 2026.
--
-- Founder, minutes after "just use the whatsapp for now": "and a way I can
-- answer back the person in the chat if they require a human". So the
-- reply lane exists after all, alongside the WhatsApp button rather than
-- instead of it, because a visitor who closed the tab cannot see a reply
-- in it and WhatsApp is where that person is reachable.
--
-- Her words need a structured home. intake_threads.transcript is one text
-- blob and the widget cannot safely pick her sentences out of it, so a web
-- reply is a row here: keyed by the visitor token the widget polls with,
-- tied to the job so it goes when the job goes. Written by yaad-desk-reply
-- under the admin's own token (the policy below is what allows that), read
-- back by yaad-inbound on the service role for the one visitor whose token
-- matches. No anon access of any kind: the token is the visitor's proof,
-- and only the function that checks it can read.

create table if not exists public.web_chat_replies (
  id          bigint generated always as identity primary key,
  visitor_key text        not null,
  job_id      text        not null references public.jobs(id) on delete cascade,
  body        text        not null check (length(body) between 1 and 1500),
  created_at  timestamptz not null default now()
);

create index if not exists web_chat_replies_visitor_idx
  on public.web_chat_replies (visitor_key, id);

alter table public.web_chat_replies enable row level security;

drop policy if exists "web_chat_replies_admin_all" on public.web_chat_replies;
create policy "web_chat_replies_admin_all" on public.web_chat_replies
  for all to authenticated
  using (is_admin()) with check (is_admin());

comment on table public.web_chat_replies is
  'Monique''s typed replies into a website chat thread. One row per reply, read back to the one visitor whose token matches by yaad-inbound. No model call writes here.';
