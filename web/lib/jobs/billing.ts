/**
 * How the client pays for a quote: in full, or by stage.
 *
 * Founder decisions, 13 Sep 2026 (DECISIONS.md, "The accepted quote writes
 * the stage schedule; billing follows it"):
 *   under J$ 100,000 client total  always in full
 *   J$ 100,000 and over            the quote says which, and accepting agrees it
 *
 * "Client total" is clientBill().total: labour, the 15% on labour, materials
 * at cost. The same line is enforced in Postgres by
 * quote_billing_mode_allowed() (20260914090641), with the threshold in
 * quote_billing_threshold_jmd(). Change one, change the other.
 *
 * This only decides and words the choice. Drafting the invoices it describes
 * is piece 3; until then the founder raises them from the desk.
 */

export const BILLING_THRESHOLD_JMD = 100_000;

export type BillingMode = "in_full" | "by_stage";

/** Whether stage billing may be offered on a quote with this client total. */
export function stageBillingAllowed(clientTotalJmd: number): boolean {
  return Number(clientTotalJmd) >= BILLING_THRESHOLD_JMD;
}

export type ResolvedBilling = { ok: true; mode: BillingMode } | { ok: false; error: string };

/** The mode a quote is saved with. Anything missing or unknown is in full. */
export function resolveBillingMode(clientTotalJmd: number, chosen: string | null | undefined): ResolvedBilling {
  if (chosen !== "by_stage") return { ok: true, mode: "in_full" };
  if (!stageBillingAllowed(clientTotalJmd)) {
    return {
      ok: false,
      error: "Under J$100,000 all in, the client pays in full. Stage billing starts at J$100,000.",
    };
  }
  return { ok: true, mode: "by_stage" };
}

/** Null or unknown reads as in full: that is how every job is billed today. */
export function billingModeOf(value: string | null | undefined): BillingMode {
  return value === "by_stage" ? "by_stage" : "in_full";
}

/** The one line the client reads beside the price. */
export function billingLineForClient(mode: BillingMode): string {
  return mode === "by_stage"
    ? "Paid by stage. The first stage is invoiced when you accept, and work starts once it is paid. Each later stage is invoiced as it is reached."
    : "Paid in full. One invoice when you accept, and work starts once it is paid.";
}
