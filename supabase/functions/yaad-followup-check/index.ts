import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { Trace, SpanKind, httpAttrs } from "./otel.ts";

// The reporting agent's own "Next:" line finally does something.
//
// yaad-notify-client's evidence_landed composition asks the reporting
// agent for a plain-English "what happens next," and until 31 Aug 2026
// that text went out in a WhatsApp draft and was never looked at again.
// This is what looks at it again: create_job_followup() (20260831zzzz3)
// flags a job and stage with a due date whenever the agent names a real
// next step; this function checks which of those dates have arrived with
// nothing having moved since, and re-runs the SAME worker-confirms-first
// draft/relay loop evidence_landed already uses, rather than inventing a
// second way to prompt a worker for an update.
//
// Same shape as yaad-job-health end to end: a pg_cron job presenting a
// secret held here only as its SHA-256 hash, or a signed-in admin for a
// manual run, clear-then-check-then-act, nothing here touches jobs.status,
// stage_approvals or evidence directly.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
// The same secret yaad-job-health already uses to call yaad-notify-client
// from outside a database trigger; both are HTTP callers rather than
// pg_net triggers, so both need the plaintext yaad-notify-client checks
// against notify_trigger_secret_sha256, not a cron-only secret of their own.
const NOTIFY_SECRET = Deno.env.get("YAAD_CRON_SECRET") ?? "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

async function reRunEvidenceLanded(jobId: string, trace: Trace): Promise<boolean> {
  try {
    return await trace.span("notify-client", SpanKind.INTERNAL, { "yaadly.notify.kind": "evidence_landed" }, async () => {
      const r = await fetch(`${SUPABASE_URL}/functions/v1/yaad-notify-client`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: NOTIFY_SECRET, jobId, kind: "evidence_landed" }),
        signal: AbortSignal.timeout(45000),
      });
      return r.ok;
    });
  } catch (_) { return false; }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const trace = new Trace("yaad-followup-check", req);
  const root = trace.startSpan(`${req.method} /yaad-followup-check`, SpanKind.SERVER, httpAttrs(req));
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

    // Same auth shape as yaad-job-health: the scheduler's own secret,
    // checked against a hash held in app_settings, or a signed-in admin
    // for a manual run from concierge.
    const presented = String(body.secret ?? "");
    let allowed = false;
    if (presented) {
      const { data: st } = await admin.from("app_settings").select("value").eq("key", "followup_cron_secret_sha256").maybeSingle();
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

    const cleared = await admin.rpc("clear_resolved_followups");
    const { data: due, error: dueErr } = await admin.rpc("due_job_followups");
    if (dueErr) { root.recordError(dueErr.message); return json({ error: dueErr.message }, 500); }

    let fired = 0, reRan = 0;
    for (const f of (due ?? []) as { id: string; job_id: string; stage: number; reason: string }[]) {
      const ok = await reRunEvidenceLanded(f.job_id, trace);
      if (ok) reRan++;
      // Marked fired either way: a failed HTTP call here is the same class
      // of thing as a failed Twilio send elsewhere in this repository, "we
      // attempted this," not "it definitely worked." Retrying forever on a
      // job that keeps failing to notify would be its own kind of stall.
      await admin.rpc("mark_followup_fired", { p_id: f.id });
      fired++;
    }

    root.setAttributes({
      "yaadly.followup.due": (due ?? []).length,
      "yaadly.followup.fired": fired,
      "yaadly.followup.re_ran": reRan,
      "yaadly.followup.cleared": cleared.data ?? 0,
    });
    return json({ ok: true, due: (due ?? []).length, fired, reRan, cleared: cleared.data ?? 0 });
  } catch (e) {
    root.recordError(e);
    return json({ error: String(e).slice(0, 200) }, 500);
  }
});
