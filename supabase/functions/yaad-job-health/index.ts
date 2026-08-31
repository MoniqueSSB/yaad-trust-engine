import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { Trace, SpanKind, httpAttrs } from "./otel.ts";

// The daily stall check. Founder's own framing, 31 Aug 2026: "prompt to the
// workers ensuring he does this so the client is updated... if there is
// something that need escalating I will be contact direct."
//
// One clock (job_silence_hours, in the migration), two thresholds, three
// audiences: the worker gets nudged first, and if that does not produce
// activity, the founder gets told directly and the client gets an honest
// heads up, in that order, on the same run.
//
// Money is untouched. approve_stage() already refuses to release a stage
// with nothing filed; a stalled job simply never reaches that gate. This
// function writes to job_stall_state and nowhere else load-bearing.
//
// Meant to be called on a schedule, same shape as yaad-vetting-purge: a
// pg_cron job inside this database, presenting a secret held here only as
// its SHA-256 hash, or a signed-in admin for a manual run from concierge.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CRON_SECRET = Deno.env.get("YAAD_CRON_SECRET") ?? "";
const APP_URL = Deno.env.get("YAAD_APP_URL") ?? "https://app.yaadly.co.uk";

// Three days silent gets the worker a nudge. Four more on top of that, a
// week silent in total, and it stops being something a reminder alone can
// fix: the founder is told directly and the client is told there is a
// delay, honestly, before they have to notice the silence themselves.
const NUDGE_HOURS = 72;
const ESCALATE_HOURS = 168;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Same shape as yaad-notify-client's own copy. Kept separate rather than
// shared, matching this repository's own house style for small per-function
// helpers: yaad-portal-code's header calls this out by name as deliberate.
async function sendTwilioWhatsApp(to: string, body: string, trace: Trace) {
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
        body: new URLSearchParams({ To: `whatsapp:+${digits}`, From: from, Body: body }),
        signal: AbortSignal.timeout(15000),
      });
      s.setAttributes({ "http.response.status_code": r.status });
      if (r.ok) return { sent: true };
      const d = await r.json().catch(() => null) as { code?: number } | null;
      const reason = d?.code === 63016 ? "outside WhatsApp's 24 hour window" : `twilio ${r.status}`;
      s.recordError(reason);
      return { sent: false, reason };
    } catch (e) {
      s.recordError(String(e).slice(0, 200));
      return { sent: false, reason: String(e).slice(0, 160) };
    }
  });
}

async function notifyClient(jobId: string, kind: string, trace: Trace) {
  try {
    return await trace.span("notify-client", SpanKind.INTERNAL, { "yaadly.notify.kind": kind }, async () => {
      const r = await fetch(`${SUPABASE_URL}/functions/v1/yaad-notify-client`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: CRON_SECRET, jobId, kind }),
        signal: AbortSignal.timeout(15000),
      });
      return r.ok;
    });
  } catch (_) { return false; }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const trace = new Trace("yaad-job-health", req);
  const root = trace.startSpan(`${req.method} /yaad-job-health`, SpanKind.SERVER, httpAttrs(req));
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

    // Same auth shape as yaad-vetting-purge: the scheduler's shared secret,
    // checked against a hash held in app_settings because pg_cron cannot
    // read this function's own environment, or a signed-in admin for a
    // manual run.
    const presented = String(body.secret ?? "");
    let allowed = Boolean(CRON_SECRET) && presented === CRON_SECRET;
    if (!allowed && presented) {
      const { data: st } = await admin.from("app_settings").select("value").eq("key", "job_health_cron_secret_sha256").maybeSingle();
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

    const cleared = await admin.rpc("clear_resolved_job_stalls", { p_nudge_hours: NUDGE_HOURS });
    const { data: candidates, error: candErr } = await admin.rpc("stalled_job_candidates", { p_nudge_hours: NUDGE_HOURS });
    if (candErr) { root.recordError(candErr.message); return json({ error: candErr.message }, 500); }

    let nudged = 0, escalated = 0, clientsTold = 0;

    for (const c of (candidates ?? []) as any[]) {
      if (c.hours_silent >= ESCALATE_HOURS && !c.already_escalated) {
        await admin.rpc("mark_job_escalated", { p_job: c.job_id });
        escalated++;

        try {
          const { data: st } = await admin.from("app_settings").select("value").eq("key", "ntfy_topic").maybeSingle();
          if (st?.value) {
            await fetch(`https://ntfy.sh/${st.value}`, {
              method: "POST",
              headers: { Title: "A job may be stalled", Priority: "high", Tags: "warning" },
              body: `${c.title} (${c.job_id}), worker ${c.worker_email}, quiet for ${Math.round(c.hours_silent)} hours. Nudged already, no activity since. ${APP_URL}/portal/jobs/${encodeURIComponent(c.job_id)}`,
              signal: AbortSignal.timeout(4000),
            });
          }
        } catch (_) { /* never let a push failure stop the run */ }

        if (c.client_email) {
          const told = await notifyClient(c.job_id, "job_delayed", trace);
          if (told) clientsTold++;
        }
      } else if (c.hours_silent >= NUDGE_HOURS && !c.already_nudged) {
        await admin.rpc("mark_job_nudged", { p_job: c.job_id });
        nudged++;

        const { data: profile } = await admin.from("worker_profiles").select("phone").ilike("worker_email", c.worker_email).maybeSingle();
        if (profile?.phone) {
          await sendTwilioWhatsApp(
            String(profile.phone),
            `Yaadly here. Nothing has come in on ${c.title} for a few days. Send a photo or check in on site when you can, the client is waiting to see progress.`,
            trace,
          );
        }
      }
    }

    root.setAttributes({
      "yaadly.job_health.candidates": (candidates ?? []).length,
      "yaadly.job_health.nudged": nudged,
      "yaadly.job_health.escalated": escalated,
      "yaadly.job_health.clients_told": clientsTold,
      "yaadly.job_health.cleared": cleared.data ?? 0,
    });
    return json({ ok: true, candidates: (candidates ?? []).length, nudged, escalated, clientsTold, cleared: cleared.data ?? 0 });
  } catch (e) {
    root.recordError(e);
    return json({ error: String(e).slice(0, 200) }, 500);
  }
});
