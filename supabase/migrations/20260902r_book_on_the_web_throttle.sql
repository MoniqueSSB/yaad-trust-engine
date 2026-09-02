-- Booking directly on the web (2 Sep 2026, founder's own change of shape:
-- "should also be able to book directly on the web"). The bandwidth worry
-- that made convert-from-enquiry the only door is answered by the held
-- state, not by the door: a web booking lands exactly where a converted
-- enquiry lands, held, unpriced to the client's card, waiting on her
-- confirm. This table is only the throttle for that public door, the same
-- shape as enquiry_attempts: hashed caller key, no personal data, swept by
-- the function itself.

create table if not exists public.booking_attempts (
  id bigint generated always as identity primary key,
  caller_key text not null,
  created_at timestamptz not null default now()
);

create index if not exists booking_attempts_key_idx on public.booking_attempts (caller_key, created_at);
create index if not exists booking_attempts_created_idx on public.booking_attempts (created_at);

-- Service-role only: the edge function writes and counts, nobody reads.
alter table public.booking_attempts enable row level security;
