/**
 * Add-on work on a booked job: the arithmetic and the wording, in one place.
 *
 * Founder decisions, 28 Sep 2026 (supabase/migrations/20260928235000). The
 * client writes the extra work and the amount; the worker accepts, edits or
 * turns it down; an edit goes back to the client; nothing is booked until
 * both have agreed the same version. Once agreed it is billed on the job as
 * its own invoice, with Yaadly's 15% on top of the agreed amount, and the
 * worker is paid the amount less 7%, the same as the main job (5% on work agreed
 * before 4 Oct 2026; the database decides that, see worker_fee_rate()).
 *
 * The money here must match _draft_addon_client_invoice() and
 * sign_off_addon() in that migration. If one changes, change the other, or
 * the page and the invoice disagree.
 */
import { CLIENT_FEE_RATE } from "./client-bill";
import { WORKER_FEE_RATE, workerFeeRate } from "./worker-fee";

export { WORKER_FEE_RATE };

export type AddonStatus = "with_worker" | "with_client" | "agreed" | "declined" | "withdrawn" | "signed_off" | "cancelled";
export type AddonTerms = "in_full" | "half_now_half_on_signoff";
export type Side = "client" | "worker";

export const TERMS_LABEL: Record<AddonTerms, string> = {
  in_full: "Paid in full before the work starts",
  half_now_half_on_signoff: "Half before the work starts, half once it is signed off",
};

/** What the client pays for an add-on of this amount, split as the invoices will be. */
export function addonClientBill(amountJmd: number, terms: AddonTerms) {
  const amount = Math.round(Number(amountJmd) || 0);
  const parts = terms === "in_full" ? [amount] : [Math.floor((amount + 1) / 2), amount - Math.floor((amount + 1) / 2)];
  const invoices = parts.map((work) => ({ work, fee: Math.round(work * CLIENT_FEE_RATE), total: work + Math.round(work * CLIENT_FEE_RATE) }));
  return {
    amount,
    fee: invoices.reduce((t, x) => t + x.fee, 0),
    total: invoices.reduce((t, x) => t + x.total, 0),
    invoices,
  };
}

/** What the worker is paid for it: the agreed amount less 7%, or 5% when it
 *  was agreed before 4 Oct 2026. Pass the add-on's agreed_at (else its
 *  created_at), as _sign_off_addon() does; no date means today's rate. */
export function addonWorkerPay(amountJmd: number, agreedAt?: string | null) {
  const amount = Math.round(Number(amountJmd) || 0);
  return amount - Math.round(amount * workerFeeRate(agreedAt));
}

/** Whose move it is, or null once it is settled. */
export function waitingOn(status: AddonStatus): Side | null {
  if (status === "with_worker") return "worker";
  if (status === "with_client") return "client";
  return null;
}

/** Plain-English state, written for the person reading it. */
export function addonStateLine(status: AddonStatus, me: Side, other: string): string {
  const mine = waitingOn(status) === me;
  switch (status) {
    case "with_worker":
    case "with_client":
      return mine ? "Waiting on you to accept, change or turn it down" : `Waiting on ${other}`;
    case "agreed":
      return "Agreed by both of you";
    case "declined":
      return "Turned down";
    case "withdrawn":
      return "Withdrawn";
    case "signed_off":
      return "Done and signed off";
    case "cancelled":
      return "Cancelled by Yaadly";
  }
}

/** Still open: it holds the job short of complete (sync_job_status). */
export function addonHoldsJob(status: AddonStatus): boolean {
  return status === "with_worker" || status === "with_client" || status === "agreed";
}
