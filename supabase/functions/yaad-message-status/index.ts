/* ── yaad-message-status ───────────────────────────────────────────────────
 *
 * What actually happened to a message Yaadly sent.
 *
 * WHY. Every WhatsApp send in this system has been fire and forget: Twilio
 * returns 201, and that is the last anybody knows. A 201 means Twilio accepted
 * the request, not that a phone received anything. A number that has left
 * WhatsApp, a handset that never comes online, a message a carrier drops, all
 * look exactly like success from the sending side.
 *
 * It matters most for the one message somebody is waiting on. When Monique
 * replies from the desk, the assistant has already promised that client she
 * would come back to them on this number. If the send silently fails, she has
 * no way to know and they are left with a promise nobody kept.
 *
 * Twilio posts here as the status moves: queued, sent, delivered, read,
 * failed, undelivered. Each one updates the row keyed on Twilio's own MessageSid.
 *
 * THE SIGNATURE IS THE ONLY DOOR, exactly as in yaad-inbound. This runs with
 * --no-verify-jwt because Twilio holds no Supabase session, so it verifies the
 * HMAC over the full URL and the sorted POST parameters using the same shared
 * module. And exactly as yaad-inbound does since 3 September, a request that
 * could NOT be verified because the token is missing is refused rather than
 * waved through: an endpoint that cannot tell who is calling does not get a
 * development mode.
 *
 * Worst case if someone forged one: a wrong delivery status on a message,
 * which is misleading but moves nothing. That is why this is a 200-and-record
 * endpoint rather than one that acts on what it is told.
 *
 * ALWAYS 200 TO TWILIO once verified. Twilio retries a callback that does not
 * get one, and a retry storm over a database blip would turn a cosmetic
 * problem into a real one. Failures are logged, not returned.
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import { httpAttrs, SpanKind, Trace } from "./otel.ts";
import { checkTwilioSignature } from "./twilio-signature.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

Deno.serve(async (req: Request) => {
  const trace = new Trace("yaad-message-status", req);
  const root = trace.startSpan(`${req.method} /yaad-message-status`, SpanKind.SERVER, httpAttrs(req));
  const done = (body: string, status: number, type = "text/plain") => {
    root.setAttributes({ "http.response.status_code": status });
    root.end(); trace.flush();
    return new Response(body, { status, headers: { "Content-Type": type } });
  };

  if (req.method !== "POST") return done("POST only.", 405);
  if (!SUPABASE_URL || !SERVICE_KEY) return done("Not configured.", 500);

  try {
    const raw = await req.text();
    const sig = await checkTwilioSignature(req, raw, Deno.env.get("TWILIO_AUTH_TOKEN") ?? "", SUPABASE_URL);
    root.setAttributes({ "yaadly.status.signature_checked": sig.checked, "yaadly.status.signature_ok": sig.ok });

    // Same call yaad-inbound makes, for the same reason. Unverifiable is our
    // misconfiguration, so 503 rather than 403: the two must not look the same
    // in a log.
    if (!sig.checked) {
      console.error("yaad-message-status: TWILIO_AUTH_TOKEN is not set, refusing every callback until it is.");
      return done("Verification is not configured.", 503);
    }
    if (!sig.ok) return done("Signature check failed.", 403);

    const f = new URLSearchParams(raw);
    const sid = (f.get("MessageSid") ?? f.get("SmsSid") ?? "").trim();
    if (!sid) return done("<Response></Response>", 200, "text/xml");

    const status = (f.get("MessageStatus") ?? f.get("SmsStatus") ?? "").trim().toLowerCase();
    const to = (f.get("To") ?? "").replace(/^whatsapp:/, "");
    const errorCode = (f.get("ErrorCode") ?? "").trim();

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    const channel = (f.get("To") ?? "").startsWith("whatsapp:") ? "whatsapp" : "sms";

    // Through record_message_delivery, 16 Sep 2026, not a plain upsert.
    // Twilio's callbacks are not guaranteed to arrive in order, and a plain
    // upsert let a late "sent" overwrite an earlier "undelivered": two refused
    // messages read as fine on the desk for days. The function only moves a
    // status forward, keeps an error code once one is known, and still creates
    // the row for a SID nothing recorded, because a send from a path nobody
    // told this function about is a fact worth keeping.
    let { error } = await admin.rpc("record_message_delivery", {
      p_sid: sid, p_to: to, p_channel: channel,
      p_status: status || "unknown", p_error_code: errorCode,
    });

    // Until migration 20260916140000 is applied the function does not exist.
    // Fall back to the old write rather than stop recording deliveries, so
    // deploying this before the migration loses nothing.
    if (error && /record_message_delivery|PGRST202|does not exist/i.test(`${error.code ?? ""} ${error.message}`)) {
      ({ error } = await admin.from("message_deliveries").upsert({
        message_sid: sid, to_addr: to, channel,
        status: status || "unknown", error_code: errorCode,
        updated_at: new Date().toISOString(),
      }, { onConflict: "message_sid" }));
    }

    if (error) console.error(`yaad-message-status: could not record ${sid} (${status}):`, error.message);

    // The account half of the desk's link to this message in the Twilio
    // console (migration 20260916230000). Every blank row, not just this one:
    // there is one Twilio account behind the business, so this also mends the
    // rows written before the column existed. Only rows still blank, so a row
    // is written once. Best effort: a failure here costs a link, never a status.
    const accountSid = (f.get("AccountSid") ?? "").trim();
    if (/^AC[0-9a-f]{32}$/i.test(accountSid)) {
      const { error: accErr } = await admin.from("message_deliveries")
        .update({ account_sid: accountSid }).eq("account_sid", "");
      if (accErr && !/account_sid/i.test(accErr.message)) {
        console.error("yaad-message-status: could not record the account id:", accErr.message);
      }
    }

    root.setAttributes({
      "yaadly.status.sid": sid, "yaadly.status.value": status || "unknown",
      "yaadly.status.error_code": errorCode || "none",
    });

    // A real delivery failure is the one worth shouting about: somebody is
    // waiting on a message that is not coming.
    if (status === "failed" || status === "undelivered") {
      console.error(`message ${sid} to ${to} came back ${status}${errorCode ? ` (Twilio ${errorCode})` : ""}`);
    }

    // Always 200 once verified. Twilio retries anything else, and a retry
    // storm over a database blip would make a cosmetic problem a real one.
    return done("<Response></Response>", 200, "text/xml");
  } catch (e) {
    console.error("yaad-message-status: threw:", String(e).slice(0, 300));
    root.recordError(e);
    return done("<Response></Response>", 200, "text/xml");
  }
});
