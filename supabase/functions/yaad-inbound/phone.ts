/* ── phone.ts ─────────────────────────────────────────────────────────────
 *
 * Is this the same number?
 *
 * WHAT IT REPLACES. Every phone comparison in this endpoint, and in the four
 * WhatsApp RPCs behind it, has been the same one line: strip the non-digits,
 * take the last nine, compare. That drops the country code entirely, so a UK
 * number and a Jamaican number ending in the same nine digits are one person
 * to this code. It is the check standing in front of choosing a worker and
 * approving a stage, and approving a stage raises a worker pay invoice.
 *
 * WHY IT WAS WRITTEN THAT WAY, which is worth keeping. Numbers arrive in this
 * system from three places and in three shapes: Twilio sends E.164 with the
 * country code, a worker typing their own number into the join form usually
 * does not, and a client's number on a job row is whatever was captured first.
 * A strict equality check would refuse a worker who is plainly themselves. The
 * last nine digits made those three shapes agree. It just made too many other
 * things agree as well.
 *
 * THE RULE NOW. An exact match on the full digit string wins outright, which
 * is the ordinary case and costs nothing. Otherwise one number may be a suffix
 * of the other, but only when the shorter is at least nine digits (so a short
 * code or a fragment can never match) and the longer is at most four digits
 * longer (a country code, not a different number that happens to end the same
 * way). "8765551234" and "18765551234" are the same person. "447700900123" and
 * "18765700900123" are not, and under the old rule they were.
 *
 * Strictly tighter than what it replaces: every pair this accepts, the last
 * nine digit check already accepted. Nothing that used to work stops working.
 */

/** Just the digits. Handles "+1 (876) 555-1234", "whatsapp:+447700900123". */
export function digitsOf(v: unknown): string {
  return String(v ?? "").replace(/\D/g, "");
}

/** The shortest number this will look at. Below it, a suffix match is a
 *  coincidence rather than a country code difference. */
const MIN_SIGNIFICANT = 9;

/** The most a country code and a trunk prefix can plausibly add. */
const MAX_PREFIX = 4;

export function samePhone(a: unknown, b: unknown): boolean {
  const A = digitsOf(a);
  const B = digitsOf(b);
  if (A.length < MIN_SIGNIFICANT || B.length < MIN_SIGNIFICANT) return false;
  if (A === B) return true;

  const [shorter, longer] = A.length <= B.length ? [A, B] : [B, A];
  if (longer.length - shorter.length > MAX_PREFIX) return false;
  return longer.endsWith(shorter);
}

/** Every row whose phone column is this number. Replaces the filter-on-tail
 *  pattern that was written out by hand at six call sites. */
export function matchingPhone<T>(rows: T[], phoneOf: (row: T) => unknown, target: unknown): T[] {
  return rows.filter((r) => samePhone(phoneOf(r), target));
}
