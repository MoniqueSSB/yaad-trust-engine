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

/** Name the Messaging Service on any send that carries a ContentSid.
 *
 *  19 September 2026, and it cost four days to find. Twilio: "A Messaging
 *  Service is a prerequisite for using Content Templates." A send with a
 *  ContentSid and only a From is refused with 20422 Invalid Parameter, every
 *  time, before Twilio tries anything. A plain Body send has no such
 *  requirement, which is exactly why this hid: every ordinary message from
 *  the same number went out normally, so it read as a template fault.
 *
 *  The From number does NOT have to be in the service's sender pool. Naming
 *  the service is the whole of it.
 *
 *  Called on every params object, template or not: it does nothing when
 *  there is no ContentSid, so one call at each send site is enough and
 *  nobody has to remember which branch they are in. With no service
 *  configured it leaves the params alone and the send fails as it did
 *  before, loudly, rather than this quietly appearing to work. */
export function withMessagingService(params: URLSearchParams): URLSearchParams {
  if (!params.has("ContentSid")) return params;
  const mg = Deno.env.get("TWILIO_MESSAGING_SERVICE_SID") ?? "";
  if (mg) params.set("MessagingServiceSid", mg);
  return params;
}

/* ── What the message was ────────────────────────────────────────────────────
 *
 * Added 16 September 2026. The status callback says where a message got to,
 * never what it was: Twilio does not send the body back and we would not store
 * it if it did. So every row on the desk's "Did it arrive" page read "a
 * message" with no job, and the one question worth asking about a failure
 * (who was waiting on what) had no answer.
 *
 * The sender is the only thing that knows, so the sender says, at the moment
 * Twilio accepts. It goes through record_message_delivery(), the same function
 * the callback uses, which never moves a status backwards and never blanks a
 * kind, so it does not matter which of the two lands first.
 *
 * WHY NOT PUT THE KIND ON THE CALLBACK URL. It would be one line, and it
 * would break every callback: Twilio signs the full URL including the query
 * string, and checkTwilioSignature rebuilds the URL without one. The status
 * page would go quiet and nothing would say why.
 *
 * NEVER THROWS AND NEVER HOLDS A SEND UP FOR LONG. The message has already
 * gone by the time this runs. Failing to record it is logged and forgotten,
 * and the callback still writes the row, just without the kind. Call it
 * before reading the response body yourself: it reads a clone.
 */
export type SendMeta = { kind: string; job_id?: string | null };

export async function recordAccepted(
  res: Response,
  to: string,
  channel: "whatsapp" | "sms",
  meta: SendMeta,
): Promise<void> {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !key || !res.ok) return;
  try {
    const accepted = await res.clone().json().catch(() => null) as { sid?: string } | null;
    const sid = String(accepted?.sid ?? "");
    if (!sid) return;
    const digits = to.replace(/\D/g, "");
    const r = await fetch(`${url.replace(/\/+$/, "")}/rest/v1/rpc/record_message_delivery`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        p_sid: sid,
        p_to: digits ? `+${digits}` : "",
        p_channel: channel,
        p_kind: String(meta.kind ?? "").slice(0, 80),
        p_job: String(meta.job_id ?? ""),
        p_status: "accepted",
      }),
      signal: AbortSignal.timeout(3000),
    });
    if (!r.ok) console.error(`recordAccepted: could not record ${sid}:`, r.status, (await r.text()).slice(0, 200));
  } catch (e) {
    console.error("recordAccepted threw:", String(e).slice(0, 200));
  }
}
