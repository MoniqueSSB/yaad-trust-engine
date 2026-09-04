/* ── button-tap.ts ────────────────────────────────────────────────────────
 *
 * A tapped WhatsApp button, read as if it had been typed.
 *
 * THE PROBLEM IT SOLVES. Approving a stage means sending the job's own code,
 * `JOB-WA-1757000000000`, and that code is deliberately hard to produce by
 * accident: approval-match.ts refuses ordinals, titles and a bare "yes",
 * because every plain message a client sends passes through that check and a
 * stray "1" must never approve anything. The safety is right. The cost is that
 * a client has to type thirteen digits correctly, on a phone, to move money.
 *
 * WHAT A TAP ACTUALLY IS. Twilio delivers a WhatsApp Quick Reply tap as an
 * ordinary inbound message: `ButtonPayload` carries whatever the template's
 * button was built with, and `Body` carries the button's visible label. So if
 * the payload is the job's own code, a tap and a correctly typed code arrive
 * as the same string.
 *
 * WHY THAT SHAPE, AND NOT A NEW LANE. Because a button must not be a new
 * authority. Everything downstream is untouched: the same matchApprovingJob(),
 * the same phone check, the same security definer RPCs, the same refusals in
 * the same words. A tap cannot do anything a typed code could not, and it
 * cannot reach a job the sender's number is not on. It is a way of typing.
 *
 * The alternative, giving buttons their own branch that trusts the payload,
 * would have made the button the thing being trusted rather than the code plus
 * the number, and that is exactly the gate this product sells.
 */

/** Was this message a button tap rather than something they wrote? */
export function wasTapped(buttonPayload: unknown): boolean {
  return String(buttonPayload ?? "").trim().length > 0;
}

/** The text to treat as the message.
 *
 *  The payload when there is one, the body otherwise. Nothing is concatenated:
 *  a payload of `JOB-WA-123` and a label of "Approve" would otherwise arrive
 *  as "Approve JOB-WA-123", which still matches, but only by luck, and it
 *  would put the label inside the transcript as if the client had written it.
 *
 *  A payload of only whitespace is not a tap. Twilio sends the parameter on
 *  some message types with nothing in it, and treating that as a tap would
 *  blank the body of an ordinary message. */
export function inboundText(buttonPayload: unknown, body: unknown): string {
  const payload = String(buttonPayload ?? "").trim();
  return payload || String(body ?? "").trim();
}
