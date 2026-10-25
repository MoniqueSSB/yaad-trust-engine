-- Sign in by WhatsApp, for workers and clients. 25 Oct 2026.
--
-- Founder: "make it so people can sign in through whatsapp or email", then
-- "workers and clients". The sign in page takes a phone number instead of an
-- email; yaad-portal-code finds the one account that number belongs to,
-- sends that account's sign in code to the number on WhatsApp (and by email
-- if there is one), and, when the code comes back, checks it with Supabase
-- and only then hands the browser a session.
--
-- Two things live here.

-- 1. Tries, counted per number and per caller, the same shape as
--    apply_link_attempts (20261025160000). Keys are hashes, never the number
--    itself, and nothing joins to them. Service role only: RLS on with no
--    policy, so the anon and authenticated roles see nothing.
create table if not exists public.phone_sign_in_attempts (
  id bigserial primary key,
  phone_key text not null,
  caller_key text not null,
  kind text not null check (kind in ('send', 'verify')),
  created_at timestamptz not null default now()
);
alter table public.phone_sign_in_attempts enable row level security;
revoke all on public.phone_sign_in_attempts from anon, authenticated;
create index if not exists phone_sign_in_attempts_phone on public.phone_sign_in_attempts (phone_key, kind, created_at);
create index if not exists phone_sign_in_attempts_caller on public.phone_sign_in_attempts (caller_key, kind, created_at);

create or replace function public.phone_sign_in_attempts_sweep()
returns void
language sql
security definer
set search_path to 'public'
as $function$
  delete from phone_sign_in_attempts where created_at < now() - interval '1 day';
$function$;
revoke all on function public.phone_sign_in_attempts_sweep() from public, anon, authenticated;

-- 2. Which sign in emails a number could belong to. Returns candidates by the
--    last nine digits (the worker_profiles_phone_tail_idx shape), and the
--    function decides on the exact number with the same e164Digits() every
--    sender uses, so a UK and a Jamaican number sharing nine digits never
--    match. A worker counts only with a live profile; a client only with a
--    job. Whether the client already has an account is checked by the
--    caller with email_has_account(). Service role only.
create or replace function public.sign_in_candidates_for_phone(p_tail text)
returns table(email text, phone text, source text)
language sql
stable security definer
set search_path to 'public'
as $function$
  select lower(btrim(w.worker_email)), w.phone, 'worker'
    from worker_profiles w
   where w.active is true
     and coalesce(btrim(w.worker_email), '') <> ''
     and length(p_tail) = 9
     and right(regexp_replace(coalesce(w.phone, ''), '\D', '', 'g'), 9) = p_tail
  union
  select lower(btrim(j.client_email)), j.client_phone, 'client'
    from jobs j
   where coalesce(btrim(j.client_email), '') <> ''
     and length(p_tail) = 9
     and right(regexp_replace(coalesce(j.client_phone, ''), '\D', '', 'g'), 9) = p_tail;
$function$;
revoke all on function public.sign_in_candidates_for_phone(text) from public, anon, authenticated;
grant execute on function public.sign_in_candidates_for_phone(text) to service_role;
