/**
 * The supplier lane, as the supplier's portal reads it. Pure: no Supabase,
 * no React, so web/tests/supplier.test.mjs can prove the ordering.
 *
 * One order is one materials_releases row made out to a supplier
 * (20261015120000). Six steps, in this order. The dashed ones in the
 * prototype, released, evidenced and paid, are Yaadly's; the other three are
 * the supplier's. The step a row is "on" is the first one with no timestamp.
 */
export type SupplierOrder = {
  id: string;
  job_id: string;
  job_title: string | null;
  parish: string | null;
  stage: number | null;
  stages: number | null;
  collector: string | null;
  store_type: string | null;
  fulfilment: "collection" | "delivery";
  amount_jmd: number;
  lines: { item: string; qty: number; unit_jmd: number }[] | null;
  released_at: string | null;
  confirmed_at: string | null;
  ready_at: string | null;
  collected_at: string | null;
  evidenced_at: string | null;
  sent_at: string | null;
  sent_ref: string | null;
  receipt_ref: string | null;
  receipt_at: string | null;
};

export type StepKey = "released_at" | "confirmed_at" | "ready_at" | "collected_at" | "evidenced_at" | "sent_at";

export const STEPS: { key: StepKey; label: string; whose: "yaadly" | "supplier" }[] = [
  { key: "released_at", label: "Released by Yaadly", whose: "yaadly" },
  { key: "confirmed_at", label: "Confirmed", whose: "supplier" },
  { key: "ready_at", label: "Ready", whose: "supplier" },
  { key: "collected_at", label: "Collected", whose: "supplier" },
  { key: "evidenced_at", label: "Evidenced on site", whose: "yaadly" },
  { key: "sent_at", label: "Paid to you", whose: "yaadly" },
];

/** Index of the first step not yet done; STEPS.length when all are. */
export function stepOf(o: Pick<SupplierOrder, StepKey>): number {
  let i = 0;
  for (; i < STEPS.length; i++) if (!o[STEPS[i].key]) break;
  return i;
}

/** The label a supplier reads above an order, in their words. */
export function orderLabel(o: Pick<SupplierOrder, StepKey | "collector" | "fulfilment">): { text: string; tone: "waiting" | "moving" | "done" } {
  const n = stepOf(o);
  const who = o.collector || "the collector";
  if (n >= STEPS.length) return { text: "Paid", tone: "done" };
  if (n === 5) return { text: "Evidenced on site, payment is next", tone: "moving" };
  if (n === 4) return { text: `Collected, waiting on ${who}'s site evidence`, tone: "moving" };
  if (n === 3) return { text: o.fulfilment === "delivery" ? "Out for delivery" : `Ready, ${who} told to collect`, tone: "waiting" };
  if (n === 2) return { text: o.fulfilment === "delivery" ? "Confirmed, mark it out for delivery" : "Confirmed, mark it ready", tone: "waiting" };
  return { text: "Confirm price and stock", tone: "waiting" };
}

/** True while the next step is the supplier's to take. */
export function waitingOnSupplier(o: Pick<SupplierOrder, StepKey>): boolean {
  const n = stepOf(o);
  return n >= 1 && n <= 3;
}

/** The order's lines total, or the release amount when no lines were typed. */
export function orderTotal(o: Pick<SupplierOrder, "amount_jmd" | "lines">): number {
  const lines = o.lines ?? [];
  if (!lines.length) return Number(o.amount_jmd) || 0;
  return lines.reduce((t, l) => t + (Number(l.qty) || 0) * (Number(l.unit_jmd) || 0), 0);
}

/** Owed: collected and not yet paid. Paid: sent. Both in J$. */
export function statement(orders: SupplierOrder[]): { owed: number; paid: number; invoiced: number } {
  let owed = 0, paid = 0, invoiced = 0;
  for (const o of orders) {
    const amt = Number(o.amount_jmd) || 0;
    if (o.sent_at) paid += amt;
    else if (o.collected_at) owed += amt;
    if (o.receipt_ref && o.collected_at) invoiced += amt;
  }
  return { owed, paid, invoiced };
}
