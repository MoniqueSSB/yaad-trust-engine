/**
 * The small, testable parts of yaad-payout-setup. No imports, no network.
 */

/** Global Payouts is on the Stripe API v2, which needs a preview version. */
export const DEFAULT_STRIPE_V2_VERSION = "2026-08-26.preview";

export type RecipientState = "none" | "started" | "ready" | "needs_info";

/**
 * What Stripe says about a worker as a recipient, in Yaadly's four words.
 * Ready only when local bank payouts are active: that is the one capability
 * asked for, and the one a J$ payout to a Jamaican bank account uses.
 */
// deno-lint-ignore no-explicit-any
export function recipientState(account: any): RecipientState {
  if (!account || typeof account.id !== "string" || !account.id) return "none";
  const status = account?.configuration?.recipient?.capabilities?.bank_accounts?.local?.status;
  return status === "active" ? "ready" : "needs_info";
}

/**
 * Only ever send a worker to Stripe's own pages. The sign-up link is single
 * use and grants access to their details, so anything else is refused.
 */
export function isStripeHostedUrl(u: string): boolean {
  try {
    const url = new URL(u);
    return url.protocol === "https:" && (url.hostname === "stripe.com" || url.hostname.endsWith(".stripe.com"));
  } catch {
    return false;
  }
}

/**
 * The recipient Yaadly creates for a worker: a person in Jamaica, paid in J$
 * to a local bank. Stripe support confirmed 15 Sep 2026 that the worker
 * receives J$ with Stripe doing the GBP to JMD conversion, never GBP left
 * for their bank to convert. Fees (0.50 GBP + 0.50% + 2% FX) fall on
 * Yaadly's financial account, not on the worker. See DECISIONS.md.
 */
export function recipientBody(email: string, name: string) {
  return {
    contact_email: email,
    display_name: name.trim() || email,
    identity: { country: "jm", entity_type: "individual" },
    configuration: { recipient: { capabilities: { bank_accounts: { local: { requested: true } } } } },
    include: ["configuration.recipient"],
  };
}
