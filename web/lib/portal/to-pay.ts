/**
 * What a client has to pay right now, for the portal's right-hand panel.
 *
 * Founder, 17 Sep 2026, from the Portal Overview design. The design's box
 * said "Held for you". That wording is banned: since 3 Sep 2026 Yaadly is
 * the principal and holds nobody's money. What IS true, and what a client
 * actually wants to know, is what they owe Yaadly today. So the figure is
 * the sum of invoices that have been sent to them and not yet paid.
 *
 * Rules held in place by tests/to-pay.test.mjs:
 *
 * ONE: currencies are never added together. A J$ job bill and a pound
 * service invoice are two lines, not one number. JMD is stored in whole
 * dollars and the others in pence, so adding them is wrong twice.
 *
 * TWO: only invoices payable to Yaadly, only status "sent", only the reader's
 * own. RLS already limits what comes back, but an admin reading their own
 * portal gets every invoice, so the email is checked again here.
 *
 * THREE: a part of a job bill counts like any other invoice. A part takes its
 * amount off the bill (20260913233000), so each amount is on one document
 * only and summing one by one counts it once.
 *
 * FOUR: an invoice Stripe has reported a successful card payment against is
 * not "to pay". It stays "sent" until a person marks it paid, so it is
 * counted separately, as received and waiting on Yaadly's sign off, rather
 * than asking the client to pay it again.
 */

export type ToPayInvoice = {
  id: string;
  status: string | null;
  total_pence: number | null;
  currency: string | null;
  payable_to: string | null;
  client_email: string | null;
  job_id: string | null;
  service_id: string | null;
};

export type ToPay = {
  /** One entry per currency, largest count first, each in its stored units. */
  totals: { currency: string; minor: number; count: number }[];
  /** The unpaid invoices, oldest first as given. */
  unpaid: ToPayInvoice[];
  /** Sent invoices with a card payment received, awaiting a person's sign off. */
  receivedCount: number;
};

export function toPay(
  invoices: ToPayInvoice[],
  email: string,
  succeededCardPayments: Set<string>,
): ToPay {
  const me = email.trim().toLowerCase();
  const mine = invoices.filter(
    (i) =>
      i.status === "sent" &&
      i.payable_to !== "worker" &&
      (i.client_email ?? "").trim().toLowerCase() === me,
  );
  const unpaid = mine.filter((i) => !succeededCardPayments.has(i.id));
  const receivedCount = mine.length - unpaid.length;

  const byCur = new Map<string, { minor: number; count: number }>();
  for (const i of unpaid) {
    const cur = (i.currency ?? "GBP").toUpperCase();
    const t = byCur.get(cur) ?? { minor: 0, count: 0 };
    t.minor += i.total_pence ?? 0;
    t.count += 1;
    byCur.set(cur, t);
  }
  const totals = [...byCur.entries()]
    .map(([currency, t]) => ({ currency, ...t }))
    .sort((a, b) => b.count - a.count);

  return { totals, unpaid, receivedCount };
}
