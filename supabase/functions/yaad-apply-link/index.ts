/* ── yaad-apply-link ──────────────────────────────────────────────────────
 *
 * "Continue on another device" for the worker apply page, 25 October 2026.
 *
 * WHY. The apply page keeps the application (its id and its upload token) in
 * the browser that started it. The pair is the credential: the applications
 * table is unreadable to anon by design, the token is minted by the database
 * and only ever handed to the browser that created the row. From any other
 * browser there was no way back. The reference APP-XXXXXX was printed on the
 * sent screen, and nothing accepted it. Monique hit this herself on 25 Oct
 * 2026 with her own test application after signing out in another browser.
 *
 * WHAT THIS DOES. It takes a reference and nothing else. If an application
 * with that reference is still open, it asks
 * yaad-notify-client to send the applicant their own link, to the phone and
 * the email ALREADY ON THE ROW, by the same channel ladder every other worker
 * message uses: WhatsApp inside the 24 hour window, a text message outside
 * it, and email through Resend from jobs@in.yaadly.co.uk. The link carries
 * the upload token, which is why it goes only to a contact the applicant gave
 * when they applied, and why the token never appears in this function's
 * response.
 *
 * WHAT THE BROWSER IS TOLD. The same sentence whether the reference exists,
 * does not exist, or exists and is closed, and the lookup and the send run
 * AFTER the response has gone (EdgeRuntime.waitUntil), so neither the words
 * nor the timing say which references are real. The only other answer is a
 * 429, and that counts tries against a reference and against a caller, not
 * rows in the table. Three an hour each way.
 *
 * verify_jwt IS OFF. The person pressing the button has no session; that is
 * the whole situation. What stands in for authentication is that nothing
 * this function returns is worth having, the throttle, and the fact that the
 * link can only ever land with the applicant.
 *
 * ONE SEND PATH, NOT TWO. This function does not talk to Twilio or Resend.
 * It proves itself to yaad-notify-client with the trigger secret (read from
 * the vault through notify_trigger_secret(), service role only) and that
 * function composes the words, reads the WhatsApp window, records the send on
 * the desk's "Did it arrive" page and falls back to SMS and email, exactly as
 * it does for the day three check reminder. One place that knows how to reach
 * a worker, as the top of that file says.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { httpAttrs, SpanKind, Trace } from "./otel.ts";
import { normaliseReference, PER_CALLER_PER_HOUR, PER_REFERENCE_PER_HOUR, SAME_ANSWER } from "./apply-link.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
// The gateway in front of yaad-notify-client wants an apikey header even with
// verify_jwt off. The anon key is what the database's own callers send
// (remind_unfinished_applications, 20260930110000); it is public by design.
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** A throttle key, not a visitor log. Hashed, truncated, never stored raw,
 *  and nothing joins to it. Same recipe as yaad-enquiry. */
async function callerKey(req: Request): Promise<string> {
  const raw = req.headers.get("cf-connecting-ip")
           ?? (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim()
           ?? "";
  const bytes = new TextEncoder().encode("yaadly-apply-link:" + raw);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).slice(0, 16)
    .map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Look the application up and, if it is open, have yaad-notify-client send
 *  the link. Runs after the response, on its own trace so the request's own
 *  spans are not exported twice. Never throws, and nothing it learns reaches
 *  the browser. */
// deno-lint-ignore no-explicit-any
async function sendIfOpen(admin: any, reference: string, req: Request): Promise<void> {
  const trace = new Trace("yaad-apply-link", req);
  const s = trace.startSpan("apply_link.send", SpanKind.INTERNAL, {});
  try {
    const { data: app } = await admin.from("applications")
      .select("id, status").eq("app_id", reference).maybeSingle();
    // Whether this application gets a link at all is ruled in one place,
    // applyLinkPhase in yaad-notify-client, which answers told:false for one
    // that is not open. Only a reference with no row stops here.
    if (!app) {
      s.setAttributes({ "yaadly.apply_link.outcome": "no_such_reference" });
      return;
    }
    const { data: secret } = await admin.rpc("notify_trigger_secret");
    if (!secret) {
      s.setAttributes({ "yaadly.apply_link.outcome": "no_secret" });
      console.error("yaad-apply-link: notify_trigger_secret() returned nothing, link not sent");
      return;
    }
    const r = await fetch(`${SUPABASE_URL}/functions/v1/yaad-notify-client`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
      body: JSON.stringify({ secret, kind: "worker_apply_link", applicationId: app.id }),
      signal: AbortSignal.timeout(20000),
    });
    const d = await r.json().catch(() => ({})) as { told?: boolean; whatsapp?: boolean; emailed?: boolean; reason?: string };
    s.setAttributes({
      "yaadly.apply_link.outcome": r.ok ? (d.told ? "sent" : "not_told") : `notify ${r.status}`,
      "yaadly.apply_link.whatsapp": Boolean(d.whatsapp),
      "yaadly.apply_link.emailed": Boolean(d.emailed),
    });
    if (!r.ok || !d.told) console.error("yaad-apply-link: not told", reference, r.status, d.reason ?? "");
  } catch (e) {
    s.recordError(e);
    console.error("yaad-apply-link: send threw", String(e).slice(0, 200));
  } finally {
    s.end();
    trace.flush();
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const trace = new Trace("yaad-apply-link", req);
  const root = trace.startSpan(`${req.method} /yaad-apply-link`, SpanKind.SERVER, httpAttrs(req));
  const json = (b: unknown, status = 200) => {
    root.setAttributes({ "http.response.status_code": status });
    root.end();
    trace.flush();
    return new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });
  };

  if (req.method !== "POST") return json({ error: "POST only." }, 405);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch (_) { /* falls into validation */ }

  const reference = normaliseReference(body.reference);
  if (!reference) {
    root.setAttributes({ "yaadly.apply_link.outcome": "not_a_reference" });
    return json({ error: "A reference is APP- followed by six letters or numbers." }, 400);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

  // ── throttle, counted before anything is looked up ─────────────────────
  const key = await callerKey(req);
  const hourAgo = new Date(Date.now() - 3600_000).toISOString();
  const [{ count: byRef }, { count: byCaller }] = await Promise.all([
    admin.from("apply_link_attempts").select("id", { count: "exact", head: true }).eq("ref_key", reference).gt("created_at", hourAgo),
    admin.from("apply_link_attempts").select("id", { count: "exact", head: true }).eq("caller_key", key).gt("created_at", hourAgo),
  ]);
  if ((byRef ?? 0) >= PER_REFERENCE_PER_HOUR || (byCaller ?? 0) >= PER_CALLER_PER_HOUR) {
    root.setAttributes({ "yaadly.apply_link.throttled": (byRef ?? 0) >= PER_REFERENCE_PER_HOUR ? "reference" : "caller" });
    return json({ error: "That is three tries in an hour. Check your messages, then try again later." }, 429);
  }
  await admin.from("apply_link_attempts").insert({ caller_key: key, ref_key: reference });

  // ── the lookup and the send, after the answer has gone ─────────────────
  const after = (async () => {
    await sendIfOpen(admin, reference, req);
    try { await admin.rpc("apply_link_attempts_sweep"); } catch (_) { /* housekeeping only */ }
  })();
  const rt = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(after);

  return json({ ok: true, message: SAME_ANSWER });
});
