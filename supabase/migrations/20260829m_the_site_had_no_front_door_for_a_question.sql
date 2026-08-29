-- The site had no front door for a plain question.
--
-- Every way in was a commitment. Post a job builds a job card. Book a call
-- puts a slot in a diary. Join the waiting list says you want to be sold to
-- later. Feedback is anonymous by design and is read as opinion, not as
-- somebody waiting on an answer. Somebody who simply wants to ask "do you
-- cover Mandeville" or "my contractor has gone quiet, what would you do"
-- had to pick one of those and mean something they did not mean.
--
-- Most of them just left. The ones who did not left through WhatsApp, which
-- is the right channel but only reaches the phone, so an enquiry that arrives
-- while she is not looking at it is an enquiry that is remembered or not.
--
-- This is the fourth inbox table and deliberately the plainest: who, how to
-- reach them, roughly what about, and what they said. Same shape as calls and
-- waitlist so the concierge desk renders it with the code it already has.
--
-- status exists so an enquiry can be marked answered from the desk. Without
-- it the list only ever grows and nobody can tell what has been dealt with,
-- which is how calls earned its status column too.

create table if not exists public.enquiries (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz default now(),
  name        text,
  contact     text,
  topic       text,
  message     text,
  status      text default 'new'
);

-- Length caps, not validation. Anyone on the internet can write here, exactly
-- as they can to calls, waitlist and feedback. What these stop is one request
-- putting a megabyte of text in the row: the free tier is the budget.
alter table public.enquiries
  add constraint enquiries_sane_lengths check (
    coalesce(length(name), 0)    <= 120 and
    coalesce(length(contact), 0) <= 200 and
    coalesce(length(topic), 0)   <= 120 and
    coalesce(length(message), 0) <= 4000
  );

create index if not exists enquiries_created_idx on public.enquiries (created_at desc);

alter table public.enquiries enable row level security;

-- Write only, and never read back. The form on the marketing site runs on the
-- publishable key, so anything anon can select is public. An enquiry carries
-- somebody's phone number and what is going wrong at their property, and that
-- is nobody's business but hers.
create policy "public sends an enquiry"
  on public.enquiries for insert to anon with check (true);

create policy "admin reads enquiries"
  on public.enquiries for all to authenticated
  using (is_admin()) with check (is_admin());

grant insert on public.enquiries to anon;
