-- A worker gives their bank details to Stripe, never to Yaadly.
--
-- Founder, 14 Sep 2026: Yaadly does not store worker bank details, and "make
-- this live" for the route that lets it avoid them: Stripe Global Payouts.
-- The worker opens a page in their own portal, presses one button, and types
-- their bank details into Stripe's hosted form. Stripe keeps them. Yaadly
-- keeps only Stripe's reference for that worker and whether they are ready to
-- be paid, so a payout can be sent to them later without anybody here ever
-- seeing an account number.
--
-- WHAT CHANGES
--   worker_profiles.stripe_recipient_id          Stripe's v2 Account id for
--                                                this worker (acct_...). Not
--                                                a secret, not a bank detail.
--   worker_profiles.stripe_recipient_status      none, started, ready or
--                                                needs_info, as Stripe last
--                                                reported it.
--   worker_profiles.stripe_recipient_checked_at  when that was last read.
--
-- Written only by yaad-payout-setup with the service role. The existing
-- policies already let a worker read their own profile and let only an admin
-- write it (wp_select_own_or_admin, wp_admin_update), so a worker cannot mark
-- themselves ready.
--
-- NOTHING HERE PAYS ANYBODY. Sending a payout is a later piece and is a named
-- person's click on the desk, as every payment is (CLAUDE.md §2).

begin;

alter table public.worker_profiles
  add column if not exists stripe_recipient_id         text,
  add column if not exists stripe_recipient_status     text not null default 'none',
  add column if not exists stripe_recipient_checked_at timestamptz;

alter table public.worker_profiles drop constraint if exists worker_profiles_stripe_recipient_status_check;
alter table public.worker_profiles add constraint worker_profiles_stripe_recipient_status_check
  check (stripe_recipient_status in ('none', 'started', 'ready', 'needs_info'));

comment on column public.worker_profiles.stripe_recipient_id is
  'Stripe Global Payouts recipient (v2 Account id). The worker''s bank details live with Stripe, never in this database. Written by yaad-payout-setup. 20260914200000.';
comment on column public.worker_profiles.stripe_recipient_status is
  'none, started, ready or needs_info, as Stripe last reported the recipient''s local bank payout capability. ready means Stripe can pay them.';
comment on column public.worker_profiles.stripe_recipient_checked_at is
  'When yaad-payout-setup last read the recipient''s status from Stripe.';

commit;
