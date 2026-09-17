/**
 * Whether Yaadly can pay a worker yet, in one line, for the worker portal's
 * right-hand panel (17 Sep 2026).
 *
 * The design had a bank details form here. That form is not built: Yaadly
 * stores no bank details (founder, 14 Sep 2026). The worker gives them to
 * Stripe or Wise on /portal/worker/payouts, and a person at Yaadly calls the
 * worker back to check them before any money goes. This only reads the three
 * columns that page already reads and says which of those steps is next.
 *
 * The call back decides "ready", not Stripe. A worker Stripe calls ready but
 * nobody has phoned is not ready to be paid, and saying so would be the panel
 * making a promise the payouts page does not.
 */

export type PayoutProfile = {
  wise_recipient_set_at?: string | null;
  bank_callback_at?: string | null;
  stripe_recipient_status?: string | null;
};

export type PayoutReadiness = {
  state: "ready" | "awaiting_call" | "stripe_unfinished" | "not_set_up";
  title: string;
  detail: string;
  cta: string;
};

export function payoutReadiness(p: PayoutProfile | null): PayoutReadiness {
  const stripe = p?.stripe_recipient_status ?? "none";
  const wise = Boolean(p?.wise_recipient_set_at);
  const given = wise || stripe === "ready";

  if (p?.bank_callback_at && given) {
    return {
      state: "ready",
      title: "Ready to be paid",
      detail: "Your bank details are with " + (stripe === "ready" ? "Stripe" : "Wise") + " and Yaadly has checked them with you by phone.",
      cta: "See how you are paid",
    };
  }
  if (given) {
    return {
      state: "awaiting_call",
      title: "Waiting on Yaadly's call",
      detail: "Your details are in. Yaadly calls you to check them before any money goes.",
      cta: "See how you are paid",
    };
  }
  if (stripe === "started" || stripe === "needs_info") {
    return {
      state: "stripe_unfinished",
      title: "Stripe is not finished",
      detail: "Stripe still needs something from you before it can pay you.",
      cta: "Carry on",
    };
  }
  return {
    state: "not_set_up",
    title: "Not set up yet",
    detail: "Tell Stripe or Wise where to pay you. Yaadly never keeps your bank details.",
    cta: "Set it up",
  };
}
