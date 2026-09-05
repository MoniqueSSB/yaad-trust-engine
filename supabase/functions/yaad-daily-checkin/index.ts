import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { Trace, SpanKind, httpAttrs } from "./otel.ts";
import { withStatusCallback } from "./twilio-status.ts";

// The daily worker prompt. Founder's own instruction, 1 Sep 2026: "when a
// job is live and has been accepted by a worker, there should be a ping
// every single day asking for a follow-up report, by voicemail or by
// words and pictures."
//
// Deliberately not yaad-job-health with a shorter clock. That function
// waits for silence, three days of nothing, before it says a word: this
// one asks every day, on every live job, whether or not anything has
// come in, because the ask itself is the point, not a symptom of a job
// having gone quiet. One table (daily_checkin_log) keeps the two
// mechanisms from ever double-messaging a worker on the same day.
//
// WhatsApp will not deliver a business-initiated message to someone who
// has not messaged in the last 24 hours as free text, Twilio error 63016,
// the same wall yaad-job-health's own nudge already hits. A daily,
// scheduled ping is business-initiated by definition, every time, so this
// always sends through a Meta-approved Content Template rather than
// gambling on the 24 hour window: TWILIO_CONTENT_SID_DAILY_CHECKIN. That
// template does not exist yet; submitting it for approval is a Twilio
// console action outside this repository, not something a migration can
// do. Until the secret is set, this function says so plainly and sends
// nothing, rather than quietly doing half the job.
//
// A worker's reply lands back through yaad-inbound exactly like any other
// WhatsApp message, and it already goes through the same draft, confirm and
// relay loop a photo update gets. This comment used to say that was "the
// next piece, not this one." It was wrong on the day it was written: the
// worker text and voice lane shipped in the SAME commit as this function
// (78a3910, "Add geotagged arrival check-in, a daily worker prompt and
// text/voice reports"). A text or voice reply from a worker with one active
// job is transcribed if needed, filed into evidence with no file attached,
// and picked up by schedule_evidence_landed_notify() exactly as a photo is,
// so it does produce a report and the worker still confirms it before the
// client sees a word. Corrected 4 Sep 2026: a comment naming a gap that does
// not exist sends the next session off building something twice.
//
// Meant to be called on a schedule, same shape as yaad-job-health: a
// pg_cron job inside this database, presenting a secret held here only as
// its SHA-256 hash, or a signed-in admin for a manual run from concierge.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CRON_SECRET = Deno.env.get("YAAD_CRON_SECRET") ?? "";
const CONTENT_SID = Deno.env.get("TWILIO_CONTENT_SID_DAILY_CHECKIN") ?? "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Same helper shape as yaad-job-health's own copy, kept separate rather
// than shared: this repository's own house style for small per-function
// helpers, called out by name in yaad-portal-code's header.
async function sendTwilioTemplate(to: string, vars: Record<string, string>, trace: Trace) {
  const sid = Deno.env.get("TWILIO_ACCOUNT_SID") ?? "";
  const tok = Deno.env.get("TWILIO_AUTH_TOKEN") ?? "";
  const from = Deno.env.get("TWILIO_WHATSAPP_FROM") ?? "";
  if (!sid || !tok || !from) return { sent: false, reason: "Twilio not configured" };
  const digits = to.replace(/\D/g, "");
  if (digits.length < 7) return { sent: false, reason: "number not usable" };
  return await trace.span("twilio.send.whatsapp", SpanKind.CLIENT, {
    "server.address": "api.twilio.com", "messaging.system": "twilio",
  }, async (s) => {
    try {
      const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: "POST",
        headers: { Authorization: "Basic " + btoa(`${sid}:${tok}`), "Content-Type": "application/x-www-form-urlencoded" },
        body: withStatusCallback(new URLSearchParams({
          To: `whatsapp:+${digits}`, From: from, ContentSid: CONTENT_SID, ContentVariables: JSON.stringify(vars),
        })),
        signal: AbortSignal.timeout(15000),
      });
      s.setAttributes({ "http.response.status_code": r.status });
      if (r.ok) return { sent: true };
      const d = await r.json().catch(() => null) as { code?: number; message?: string } | null;
      s.recordError(d?.message ?? `twilio ${r.status}`);
      return { sent: false, reason: d?.message ?? `twilio ${r.status}` };
    } catch (e) {
      s.recordError(String(e).slice(0, 200));
      return { sent: false, reason: String(e).slice(0, 160) };
    }
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const trace = new Trace("yaad-daily-checkin", req);
  const root = trace.startSpan(`${req.method} /yaad-daily-checkin`, SpanKind.SERVER, httpAttrs(req));
  const done = (res: Response, status: number) => {
    root.setAttributes({ "http.response.status_code": status });
    root.end(); trace.flush(); return res;
  };
  const json = (b: unknown, status = 200) =>
    done(new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } }), status);

  try {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
    if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: "Not configured." }, 500);

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

    // Same auth shape as yaad-job-health: the scheduler's shared secret,
    // checked against a hash held in app_settings, or a signed-in admin
    // for a manual run.
    const presented = String(body.secret ?? "");
    let allowed = Boolean(CRON_SECRET) && presented === CRON_SECRET;
    if (!allowed && presented) {
      const { data: st } = await admin.from("app_settings").select("value").eq("key", "daily_checkin_cron_secret_sha256").maybeSingle();
      const expected = String(st?.value ?? "").toLowerCase();
      if (expected) {
        const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(presented));
        const got = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
        if (got.length === expected.length) {
          let diff = 0;
          for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ expected.charCodeAt(i);
          allowed = diff === 0;
        }
      }
    }
    if (!allowed) {
      const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
      if (jwt) {
        const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
        const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/is_admin`, {
          method: "POST",
          headers: { "Content-Type": "application/json", apikey: anon, Authorization: `Bearer ${jwt}` },
          body: "{}",
        });
        const isAdmin = r.ok && (await r.json().catch(() => false)) === true;
        allowed = isAdmin;
      }
    }
    if (!allowed) return json({ error: "Not authorised." }, 403);

    if (!CONTENT_SID) {
      return json({
        ok: false,
        error: "TWILIO_CONTENT_SID_DAILY_CHECKIN is not set. Nothing sent.",
        detail: "This ping only ever sends through an approved WhatsApp Content Template. Submit one in the Twilio console, set the secret to its ContentSid, then re-run.",
      }, 200);
    }

    const { data: live, error: liveErr } = await admin
      .from("jobs")
      .select("id, title, worker_email")
      .eq("status", "in_progress")
      .not("worker_email", "is", null);
    if (liveErr) { root.recordError(liveErr.message); return json({ error: liveErr.message }, 500); }

    const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Jamaica" }); // YYYY-MM-DD, Jamaica-local

    let sent = 0, skippedAlready = 0, skippedNoPhone = 0, failed = 0;

    for (const j of (live ?? []) as { id: string; title: string | null; worker_email: string }[]) {
      const { data: already } = await admin.from("daily_checkin_log").select("id").eq("job_id", j.id).eq("sent_on", today).maybeSingle();
      if (already) { skippedAlready++; continue; }

      const { data: profile } = await admin.from("worker_profiles").select("phone").ilike("worker_email", j.worker_email).maybeSingle();
      if (!profile?.phone) { skippedNoPhone++; continue; }

      const result = await sendTwilioTemplate(String(profile.phone), { "1": j.title ?? j.id }, trace);
      // Logged once per job per day regardless of delivery, same reasoning
      // as mark_job_nudged: this is a once-a-day ask, not a retry queue,
      // and a Twilio outage should not turn into the same worker getting
      // three pings the moment it recovers.
      await admin.from("daily_checkin_log").insert({ job_id: j.id, sent_on: today });
      if (result.sent) sent++; else failed++;
    }

    root.setAttributes({
      "yaadly.daily_checkin.candidates": (live ?? []).length,
      "yaadly.daily_checkin.sent": sent,
      "yaadly.daily_checkin.failed": failed,
      "yaadly.daily_checkin.skipped_already": skippedAlready,
      "yaadly.daily_checkin.skipped_no_phone": skippedNoPhone,
    });
    return json({ ok: true, candidates: (live ?? []).length, sent, failed, skippedAlready, skippedNoPhone });
  } catch (e) {
    root.recordError(e);
    return json({ error: String(e).slice(0, 200) }, 500);
  }
});
