/**
 * The small, testable parts of yaad-payout-send. No imports, no network.
 *
 * Everything here turns Stripe's answers into the few facts a person on the
 * desk needs before pressing Send, and turns their invoice into the exact
 * request Stripe gets. Nothing here talks to anything.
 */

/** Global Payouts is on the Stripe API v2, which needs a preview version. */
export const DEFAULT_STRIPE_V2_VERSION = "2026-08-26.preview";

/** Stripe's published rates for a UK sender paying Jamaica, read 15 Sep 2026
 *  from docs.stripe.com/global-payouts/pricing. Used ONLY to label an
 *  estimate when Stripe will not quote in advance; a real quote wins. */
export const PUBLISHED_FEES_UK_TO_JM = {
  standard_payout_fee_gbp_minor: 50,
  cross_border_rate: 0.005,
  fx_rate: 0.02,
} as const;

// deno-lint-ignore no-explicit-any
type Any = any;

export type Fee = { type: string; value: number; currency: string };

export type QuoteSummary = {
  quote_id: string | null;
  expires_at: string | null;
  /** What the worker receives, minor units, and its currency. */
  credited: { value: number; currency: string } | null;
  /** What leaves Yaadly's financial account, minor units, and its currency. */
  debited: { value: number; currency: string } | null;
  fees: Fee[];
  fees_total: { value: number; currency: string } | null;
  fx_rate: string | null;
  estimate: boolean;
};

/**
 * The one financial account a payout is drawn from: open, a storage account,
 * and able to hold GBP. Yaadly has exactly one; if that ever changes, the
 * env STRIPE_FINANCIAL_ACCOUNT names it and this is skipped.
 */
export function pickFinancialAccount(list: Any[]): Any | null {
  const open = (list ?? []).filter((fa) =>
    fa?.status === "open" && fa?.type === "storage" &&
    Array.isArray(fa?.storage?.holds_currencies) && fa.storage.holds_currencies.includes("gbp")
  );
  return open[0] ?? null;
}

/** Available GBP on a financial account, in pence. Null if unreadable. */
export function availableGbp(fa: Any): number | null {
  const v = fa?.balance?.available?.gbp?.value;
  return typeof v === "number" ? v : null;
}

/**
 * Which of the worker's payout methods to pay. Stripe's default outbound
 * destination first; otherwise the first bank account Stripe says is usable
 * for payments. Null means the worker has nothing Stripe can pay, and the
 * desk says so instead of guessing.
 */
export function pickPayoutMethod(account: Any, methods: Any[]): string | null {
  const def = account?.configuration?.recipient?.default_outbound_destination?.id;
  if (typeof def === "string" && def) return def;
  for (const m of methods ?? []) {
    if (typeof m?.id !== "string") continue;
    if (m?.usage_status?.payments && m.usage_status.payments !== "eligible") continue;
    if (m?.type && m.type !== "bank_account") continue;
    return m.id;
  }
  return null;
}

/** The recipient is only payable when local bank payouts are active. */
export function recipientReady(account: Any): boolean {
  return account?.configuration?.recipient?.capabilities?.bank_accounts?.local?.status === "active";
}

/**
 * The body for a quote and for the payment itself. The same shape, on
 * purpose: Stripe refuses a payment whose from, to or amount differ from its
 * quote (outbound_payment_quote_mismatch), which is exactly the protection
 * wanted. The amount is what the worker receives, so the invoice figure is
 * the figure that lands.
 */
export function moneyBody(p: {
  financialAccount: string;
  recipient: string;
  payoutMethod: string;
  amountMinor: number;
  currency: string;
}) {
  const cur = p.currency.toLowerCase();
  return {
    from: { financial_account: p.financialAccount, currency: "gbp" },
    to: { recipient: p.recipient, payout_method: p.payoutMethod, currency: cur },
    amount: { value: p.amountMinor, currency: cur },
  };
}

/** Bank statements allow 3 to 22 characters. "YAADLY INV-2026-0005" is 20. */
export function statementDescriptor(invoiceId: string): string {
  const s = `YAADLY ${invoiceId}`.replace(/[^A-Za-z0-9 -]/g, "").slice(0, 22).trim();
  return s.length >= 3 ? s : "YAADLY";
}

export function paymentBody(p: Parameters<typeof moneyBody>[0] & { invoiceId: string; what: string; quoteId?: string | null }) {
  return {
    ...moneyBody(p),
    description: `Yaadly ${p.invoiceId}: ${p.what}`.slice(0, 200),
    statement_descriptor: statementDescriptor(p.invoiceId),
    // The worker hears from Yaadly on WhatsApp, in Yaadly's words. Not from
    // Stripe as well, in a second voice.
    recipient_notification: { setting: "none" },
    metadata: { yaadly_invoice: p.invoiceId },
    ...(p.quoteId ? { outbound_payment_quote: p.quoteId } : {}),
  };
}

/** Stripe's quote, reduced to what a person needs to read before Send. */
export function summariseQuote(q: Any): QuoteSummary {
  const fees: Fee[] = Array.isArray(q?.estimated_fees)
    ? q.estimated_fees
      .filter((f: Any) => typeof f?.amount?.value === "number")
      .map((f: Any) => ({ type: String(f.type ?? "fee"), value: Number(f.amount.value), currency: String(f.amount.currency ?? "gbp").toUpperCase() }))
    : [];
  const feeCur = fees[0]?.currency ?? "GBP";
  const feesTotal = fees.length ? { value: fees.reduce((s, f) => s + f.value, 0), currency: feeCur } : null;
  const rates = q?.fx_quote?.rates ?? {};
  const rateKey = Object.keys(rates)[0];
  const rate = rateKey && rates[rateKey]?.exchange_rate != null ? String(rates[rateKey].exchange_rate) : null;
  return {
    quote_id: typeof q?.id === "string" ? q.id : null,
    expires_at: typeof q?.fx_quote?.lock_expires_at === "string" ? q.fx_quote.lock_expires_at : null,
    credited: q?.to?.credited?.value != null ? { value: Number(q.to.credited.value), currency: String(q.to.credited.currency ?? "").toUpperCase() } : null,
    debited: q?.from?.debited?.value != null ? { value: Number(q.from.debited.value), currency: String(q.from.debited.currency ?? "").toUpperCase() } : null,
    fees,
    fees_total: feesTotal,
    fx_rate: rate,
    estimate: false,
  };
}

/**
 * When Stripe will not quote in advance (the quotes endpoint is gated on some
 * accounts and answers 404), the desk still has to show the person what the
 * published fees are. This is labelled an estimate, carries no rate, and the
 * real figures are read back off the payout afterwards.
 */
export function estimateSummary(amountMinor: number, currency: string): QuoteSummary {
  return {
    quote_id: null,
    expires_at: null,
    credited: { value: amountMinor, currency: currency.toUpperCase() },
    debited: null,
    fees: [
      { type: "standard_payout_fee", value: PUBLISHED_FEES_UK_TO_JM.standard_payout_fee_gbp_minor, currency: "GBP" },
    ],
    fees_total: null,
    fx_rate: null,
    estimate: true,
  };
}

export type PayoutStatus = "processing" | "posted" | "failed" | "canceled" | "returned";

/** Stripe's payout, reduced to what the record keeps. */
export function statusFromPayout(obp: Any): {
  id: string | null;
  status: PayoutStatus;
  detail: string | null;
  receipt_url: string | null;
  trace_id: string | null;
  expected_arrival: string | null;
  debited: { value: number; currency: string } | null;
} {
  const raw = String(obp?.status ?? "processing");
  const status: PayoutStatus = (["processing", "posted", "failed", "canceled", "returned"] as const).includes(raw as PayoutStatus)
    ? (raw as PayoutStatus)
    : "processing";
  const sd = obp?.status_details ?? {};
  const detail = sd?.failed?.reason ?? sd?.returned?.reason ?? sd?.canceled?.reason ?? null;
  const trace = obp?.trace_id?.value ?? (typeof obp?.trace_id === "string" ? obp.trace_id : null);
  return {
    id: typeof obp?.id === "string" ? obp.id : null,
    status,
    detail: detail == null ? null : String(detail),
    receipt_url: typeof obp?.receipt_url === "string" ? obp.receipt_url : null,
    trace_id: trace == null ? null : String(trace),
    expected_arrival: typeof obp?.expected_arrival_date === "string" ? obp.expected_arrival_date : null,
    debited: obp?.from?.debited?.value != null ? { value: Number(obp.from.debited.value), currency: String(obp.from.debited.currency ?? "").toUpperCase() } : null,
  };
}

/** A Stripe 404 on the quotes endpoint means "not enabled for you", not "no such thing". */
export function quoteUnavailable(status: number, body: Any): boolean {
  return status === 404 || body?.error?.code === "not_found";
}
