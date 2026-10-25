// The pure parts of yaad-apply-link, kept apart from Deno.serve so they can
// be tested without a database.

/** What a worker types into the box, turned into the reference the database
 *  holds, or null. Forgiving on purpose: a tradesperson reading the reference
 *  off a screenshot will type it in lower case, with spaces, or without the
 *  APP- in front. The row holds `APP-` plus six characters in upper case
 *  (yaad-vetting-upload mints it from a UUID), so that is the one shape this
 *  returns. Anything else is not a reference and is never looked up. */
export function normaliseReference(input: unknown): string | null {
  const raw = String(input ?? "").toUpperCase().replace(/[\s‐-―]/g, "").trim();
  if (raw.length > 12) return null;
  const m = /^(?:APP-?)?([0-9A-Z]{6})$/.exec(raw);
  return m ? `APP-${m[1]}` : null;
}

/** The one sentence the browser is ever told on success. The same words
 *  whether the reference exists, does not exist, or exists and is closed, so
 *  the box tells nobody which references are real. The 429 is the only other
 *  answer and it counts tries, not rows. */
export const SAME_ANSWER = "If that reference is ours, your link is on its way to the phone number or email on the application.";

/** At most this many requests per reference per hour, and per caller per hour.
 *  Three is enough for a real person who mistypes once and then waits for a
 *  text that is slow to arrive. */
export const PER_REFERENCE_PER_HOUR = 3;
export const PER_CALLER_PER_HOUR = 3;

/** Which statuses still have a page to come back to. `started` is Phase 1
 *  never sent; `received` is sent and waiting on the check. Anything else
 *  (decided, published, withdrawn) has nothing to open and gets no link. */
export function isOpenApplication(status: unknown): boolean {
  return status === "started" || status === "received";
}
