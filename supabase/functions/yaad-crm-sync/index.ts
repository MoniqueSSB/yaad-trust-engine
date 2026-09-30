import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * The CRM hears about every job and every stage, from the database.
 *
 * WHY THIS EXISTS. Until 30 September 2026 HubSpot heard about exactly one
 * kind of event: a WhatsApp job whose client had confirmed the read-back,
 * sent inline from yaad-inbound. A job booked in the portal, a job from the
 * website form, a client paying, evidence landing, a stage being approved and
 * a worker being paid all happened in Postgres and the board never moved. The
 * stage webhook on the app was built, tested and called by nothing.
 *
 * WHY FROM THE DATABASE AND NOT FROM EACH SCREEN. A job row is a job row
 * whichever door wrote it: WhatsApp, the portal, the website form, the desk.
 * Triggers on the writes that change state (20260930160000) post here, in the
 * same shape yaad-notify-client and yaad-completion-flow already use, so a
 * new door added later is covered without anybody remembering to call this.
 *
 * WHAT THIS DOES. Signs and forwards. It reads the job's shape (name, number,
 * parish, trade, urgency, code, door) for a lead, or names an event for a
 * stage move, and posts it to the app's /api/hubspot/lead or /api/hubspot/stage
 * with the HMAC scheme web/lib/webhookSignature.ts verifies. The app is the
 * only thing that talks to HubSpot, and that stays true.
 *
 * WHAT THIS WILL NOT SEND. The description, the address, the photographs, the
 * client's email. That list is the data protection boundary set on 4
 * September and enforced by web/tests/hubspot-lead.test.mjs. Test jobs
 * (is_test) never leave at all.
 *
 * THE SENDER NAMES AN EVENT, NEVER A STAGE. The app decides which stage an
 * event implies and refuses to go backwards, so a redelivered trigger is
 * harmless and nothing here can walk a deal anywhere it likes. Recording
 * that a client paid or approved moves no money: the human decisions that do
 * are elsewhere and are not touched by this.
 *
 * DOOR. The notify trigger secret, checked against its SHA-256 in
 * app_settings, the same door as yaad-completion-flow. Deployed with
 * --no-verify-jwt because a trigger holds no session. Every failure is a log
 * line starting `crm sync:`; nothing here is on any client's path.
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const APP_URL = (Deno.env.get("YAADLY_APP_URL") ?? "https://app.yaadly.co.uk").replace(/\/+$/, "");
const LEAD_SECRET = Deno.env.get("HUBSPOT_LEAD_WEBHOOK_SECRET") ?? "";
const STAGE_SECRET = Deno.env.get("HUBSPOT_STAGE_WEBHOOK_SECRET") ?? "";

/** The events a trigger may name. Each maps to one event the stage route
 *  accepts; `lead` goes to the lead route instead. Anything else is 400. */
const STAGE_EVENTS = new Set(["client_paid", "evidence_submitted", "client_approved", "worker_paid"]);

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Sign the body the way the app verifies it: hex HMAC-SHA256 over
 *  `${timestamp}.${rawBody}`, timestamp inside the signed material. */
async function post(path: string, secret: string, payload: Record<string, unknown>): Promise<Response> {
  const body = JSON.stringify(payload);
  const ts = Math.floor(Date.now() / 1000);
  const sig = await hmacHex(secret, `${ts}.${body}`);
  return await fetch(`${APP_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-yaadly-signature": sig, "x-yaadly-timestamp": String(ts) },
    body,
    signal: AbortSignal.timeout(10000),
  });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch (_) { /* falls into validation */ }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

  // ── the door ────────────────────────────────────────────────────────────
  const secret = String(body.secret ?? "");
  const { data: setting } = await admin.from("app_settings").select("value")
    .eq("key", "notify_trigger_secret_sha256").maybeSingle();
  if (!secret || !setting?.value || setting.value !== await sha256Hex(secret)) {
    return json({ error: "Not authorised." }, 403);
  }

  const kind = String(body.kind ?? "");
  const jobId = String(body.jobId ?? "").trim().slice(0, 64);
  if (!jobId) return json({ error: "jobId is required" }, 400);
  if (kind !== "lead" && !STAGE_EVENTS.has(kind)) return json({ error: "Unknown kind" }, 400);

  // ── the job, read here rather than trusted from the trigger ─────────────
  // The trigger sends only the id. What leaves for the CRM is read fresh from
  // the row, so the field list lives in one place, this file, and a trigger
  // cannot widen it.
  const { data: job, error } = await admin.from("jobs")
    .select("id, client_name, client_phone, parish, trade, urgency, source, status, is_test")
    .eq("id", jobId).maybeSingle();
  if (error || !job) return json({ error: "No such job" }, 404);
  if (job.is_test) return json({ ok: true, skipped: "test job" });

  const s = (v: unknown) => String(v ?? "").trim();

  try {
    if (kind === "lead") {
      if (!LEAD_SECRET) return json({ ok: true, skipped: "HUBSPOT_LEAD_WEBHOOK_SECRET is not set" });
      // A draft is a conversation, not a job. The WhatsApp path syncs its own
      // confirmed read-back inline; everything else waits until the row has
      // left draft, which the trigger already checks and this checks again.
      if (job.status === "draft") return json({ ok: true, skipped: "draft" });
      const r = await post("/api/hubspot/lead", LEAD_SECRET, {
        jobId: job.id,
        phone: s(job.client_phone),
        name: s(job.client_name),
        parish: s(job.parish),
        trade: s(job.trade),
        urgency: s(job.urgency),
        source: s(job.source),
      });
      const text = (await r.text()).slice(0, 300);
      if (!r.ok) console.error(`crm sync: lead ${job.id} not synced, ${r.status}: ${text}`);
      return json({ ok: r.ok, status: r.status });
    }

    if (!STAGE_SECRET) return json({ ok: true, skipped: "HUBSPOT_STAGE_WEBHOOK_SECRET is not set" });
    const r = await post("/api/hubspot/stage", STAGE_SECRET, { jobId: job.id, event: kind });
    const text = (await r.text()).slice(0, 300);
    // 404 means no deal carries this job code: the lead never synced. Said in
    // the log so it can be found, and not retried, because it will not change.
    if (!r.ok) console.error(`crm sync: ${kind} on ${job.id} not recorded, ${r.status}: ${text}`);
    return json({ ok: r.ok, status: r.status });
  } catch (e) {
    console.error(`crm sync: ${kind} on ${jobId} threw:`, String(e).slice(0, 200));
    return json({ error: "The app could not be reached." }, 502);
  }
});
