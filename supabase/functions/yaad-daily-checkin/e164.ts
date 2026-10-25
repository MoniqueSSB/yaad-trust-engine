/* ── e164.ts ──────────────────────────────────────────────────────────────
 *
 * A number as a person typed it, turned into the digits Twilio will accept.
 *
 * WHY. On 25 October 2026 a worker applied with their number written the UK
 * way, 07776171858, and the form saved it exactly like that. Every sender in
 * this project then did the same thing: strip the non-digits and put a plus
 * in front. Twilio got +07776171858, which is not a number anywhere, and
 * refused it with code 21211. The desk showed "Not sent" and the person
 * could not be reached from Yaadly at all. A Jamaican number typed as
 * 876 555 1234 fails the same way, as +8765551234 without its leading 1.
 *
 * WHAT THIS DOES. Takes whatever was stored and returns the international
 * digits, with no plus: "447776171858", "18765551234". Numbers that already
 * carry a country code come back unchanged apart from the formatting.
 *
 * THE RULES, in the order they are tried:
 *   - "00" at the front is the international dial prefix: dropped.
 *   - Eleven digits starting "07" is a UK mobile written nationally: the 0
 *     goes and 44 goes on. Yaadly's clients are mostly in the UK and this is
 *     how a UK person writes their number.
 *   - Ten digits starting "7" is the same number typed without the 0, which
 *     a form with a +44 picker produces. 44 goes on.
 *   - Ten digits starting "876" or "658" is a Jamaican number without its
 *     country code (Jamaica is +1, area codes 876 and 658). 1 goes on.
 *   - Anything else is returned as its digits. If it is wrong, Twilio says
 *     so, and that is the right place for the error to surface.
 *
 * WHAT IT DOES NOT DO. It does not guess a country from nothing, so a seven
 * digit local number stays seven digits and fails at Twilio with a clear
 * message rather than reaching a stranger. It never changes a number that
 * already has a country code: "447776171858" and "18765551234" are left alone.
 *
 * Twilio itself hands this project numbers in E.164 already, so inbound
 * messages are not the problem; numbers typed into forms are.
 */

/** International digits for a stored phone number, no plus sign. Empty
 *  string when nothing usable was given. */
export function e164Digits(raw: unknown): string {
  let d = String(raw ?? "").replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 11 && d.startsWith("07")) return "44" + d.slice(1);
  if (d.length === 10 && d.startsWith("7")) return "44" + d;
  if (d.length === 10 && (d.startsWith("876") || d.startsWith("658"))) return "1" + d;
  return d;
}

/** The same, with the plus, for storing or for an SMS "To". */
export function e164(raw: unknown): string {
  const d = e164Digits(raw);
  return d ? "+" + d : "";
}
