/* ── twilio-status ─────────────────────────────────────────────────────────
 *
 * Ask Twilio to say what actually happened to a message.
 *
 * A 201 from Twilio means Twilio accepted the request. It does not mean a
 * phone received anything. A number that has left WhatsApp, a handset that
 * never comes online, a carrier that drops the message: from the sending side
 * all three look exactly like success. yaad-message-status exists to catch
 * that, but it only ever hears about a message whose send asked it to.
 *
 * WHY THIS IS SHARED RATHER THAN TWO LINES IN EACH FUNCTION. Seven functions
 * in this repository send over Twilio, each with its own inline call, and on
 * 5 September 2026 exactly one of them attached a status callback. The desk's
 * "Messages that failed" tile therefore read zero for a reason nobody would
 * guess from looking at it: six of the seven paths were not reporting at all.
 * A number that says "none failed" when it means "nobody is checking" is worse
 * than no number, and six copies of the same two lines is how the seventh
 * copy gets forgotten.
 *
 * DELIBERATELY INERT UNTIL CONFIGURED. With TWILIO_STATUS_CALLBACK_URL unset
 * this adds nothing and every send behaves exactly as it did. That is what
 * makes it safe to put in front of the sign-in code and the client's own
 * notifications in one change.
 */

/** The same params, with Twilio asked to report delivery, when configured. */
export function withStatusCallback(params: URLSearchParams): URLSearchParams {
  const url = Deno.env.get("TWILIO_STATUS_CALLBACK_URL") ?? "";
  if (url) params.set("StatusCallback", url);
  return params;
}
