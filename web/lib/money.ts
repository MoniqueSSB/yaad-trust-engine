/**
 * Money, formatted one way.
 *
 * There were nine hand written formatters across the portal before this: two
 * in the job room alone, and one each in the worker portal, the quote pack,
 * the public quotes page, QuotePanel, MoneyPanel, PackStageProgress,
 * FeeBreakdown, WorkerInvoices and WorkerMoneyPanel.
 *
 * Seven passed "en-JM" and two passed "en-US", which sounds like the bug and
 * is not: for a J$ amount both locales group identically, so the locale never
 * showed. What did show is that seven rounded and two did not. The job room
 * renders several of these panels at once, so one job could read
 * J$1,234,567.89 in one place and J$1,234,568 in another, on the same screen,
 * on a product whose whole premise is that the numbers can be trusted.
 *
 * Rounding wins, because Jamaican pricing is quoted in whole dollars and a
 * trailing .89 on a quote reads as a system leaking its own arithmetic.
 *
 * THREE SHAPES, because the call sites genuinely need three and collapsing
 * them would only push the null handling back out into the components:
 *
 *   jmd()         a number you already know you have
 *   jmdOrNull()   null in, null out, for a caller that renders nothing
 *   jmdOrBlank()  null in, empty string out, for a caller that concatenates
 *
 * amount() is the separate multi-currency case: invoices are raised in GBP,
 * USD, CAD or JMD, they are stored in minor units, and only J$ is rounded.
 * The others keep their two decimals because a card statement has them.
 */

/** J$ with thousands separators and no decimals. */
export function jmd(n: number): string {
  return "J$" + Math.round(n).toLocaleString("en-JM");
}

/** For a caller that wants to render nothing at all when there is no figure. */
export function jmdOrNull(n: number | null | undefined): string | null {
  return n == null ? null : jmd(n);
}

/** For a caller that concatenates the result into a string regardless. */
export function jmdOrBlank(n: number | null | undefined): string {
  return n == null ? "" : jmd(n);
}

/**
 * An invoice total, stored in minor units, in whatever currency it was raised.
 *
 * The fallback is GBP because that is what the client side of the business is
 * billed in. A missing total says so in words rather than printing a dash:
 * a lone dash in a money column is ambiguous between "nothing" and "zero", and
 * those are very different answers to somebody asking what they owe.
 */
export function amount(totalMinorUnits: number | null, currency: string | null): string {
  if (totalMinorUnits == null) return "not set";
  const n = totalMinorUnits / 100;
  const cur = (currency ?? "GBP").toUpperCase();
  if (cur === "JMD") return jmd(n);
  if (cur === "USD") return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2 });
  if (cur === "CAD") return "C$" + n.toLocaleString("en-US", { minimumFractionDigits: 2 });
  return "£" + n.toLocaleString("en-GB", { minimumFractionDigits: 2 });
}

/**
 * A GBP figure, stored in pence.
 *
 * Separate from amount() because the service pages hold a plain pence column
 * rather than an invoice with a currency beside it, and pretending otherwise
 * would mean passing a currency string that is always "GBP". Both decimals are
 * always shown: a price of £149.00 that renders as £149 looks like a different
 * price from the one on the marketing page.
 */
export function gbp(pence: number): string {
  return "£" + (pence / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
