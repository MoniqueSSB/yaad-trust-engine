-- A worker's new Stripe recipient, or a new bank account inside Stripe,
-- clears the call-back, the same as new Wise details.
--
-- Founder, 2 Oct 2026: "commit and pr", then "also fix anything outstanding".
--
-- THE GAP, TWO PARTS.
--   1. worker_bank_callback_guard() (20260914240000, restated by
--      20261001194258) clears worker_profiles.bank_callback_at when
--      wise_recipient_id changes, and when the cash pick-up name or parish
--      change. It does not look at stripe_recipient_id. So a worker whose
--      Wise details were checked by phone could set up Stripe with a
--      different bank account, and the old call-back would still count:
--      worker_bank_checked() says yes, yaad-payout-send sends, and
--      mark_worker_paid() records it. That is exactly the case the call-back
--      exists for: somebody who gets into a worker's login and puts in their
--      own account.
--   2. Once a worker has a Stripe recipient, yaad-payout-setup gives them
--      Stripe's update form, and the bank account can change inside Stripe
--      while stripe_recipient_id stays exactly the same. yaad-payout-send
--      paid whichever account Stripe had on file at the moment of sending.
-- Read live on 2 Oct 2026: no worker has a Stripe recipient yet and no Stripe
-- payout has been sent, so nobody has been paid either way.
--
-- WHAT CHANGES
--   1. worker_profiles.stripe_payout_method_id: Stripe's id for the bank
--      account it would pay this worker (a payout method), as Yaadly last saw
--      it. An id, not a bank detail. Written with the service role by
--      yaad-payout-setup when it reads the worker back from Stripe, and by
--      yaad-payout-send when it finds Stripe would pay a different account.
--   2. One small trigger of its own, after the guard. When stripe_recipient_id
--      or stripe_payout_method_id changes in any way (first set, replaced,
--      removed), the call-back is cleared and somebody has to phone the
--      worker again. stripe_recipient_status and stripe_recipient_checked_at,
--      written on every read from Stripe, do not clear it.
--   yaad-payout-send then pays only the account recorded here, and refuses
--   when Stripe would pay a different one (in the same commit).
--
-- WHY A SEPARATE TRIGGER, NOT A THIRD RESTATEMENT OF THE GUARD. Restating the
-- guard here would make this file and 20261001194258 overwrite each other
-- depending on which is applied last. Triggers on one table fire in name
-- order, so trg_worker_bank_callback_stripe runs after
-- trg_worker_bank_callback_guard whichever version of the guard is live, and
-- has the last word.
--
-- NO HUMAN GATE MOVES; THIS ONE GETS STRICTER. A named person still records
-- every call-back and still presses every payment.

begin;

alter table public.worker_profiles
  add column if not exists stripe_payout_method_id text;

comment on column public.worker_profiles.stripe_payout_method_id is
  'Stripe''s id for the bank account it would pay this worker, as Yaadly last saw it. Not a bank detail. A change clears the call-back, and yaad-payout-send pays only this account. 20261002102157.';

create or replace function public.worker_bank_callback_stripe()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if new.stripe_recipient_id is distinct from old.stripe_recipient_id
     or new.stripe_payout_method_id is distinct from old.stripe_payout_method_id then
    new.bank_callback_at := null;
    new.bank_callback_by := '';
  end if;
  return new;
end
$function$;

comment on function public.worker_bank_callback_stripe() is
  'A changed Stripe recipient or Stripe bank account on a worker profile clears the bank call-back, so changed details are never paid unchecked. Runs after worker_bank_callback_guard. 20261002102157.';

revoke all on function public.worker_bank_callback_stripe() from public, anon, authenticated;

drop trigger if exists trg_worker_bank_callback_stripe on public.worker_profiles;
create trigger trg_worker_bank_callback_stripe
  before update on public.worker_profiles
  for each row execute function public.worker_bank_callback_stripe();

commit;
