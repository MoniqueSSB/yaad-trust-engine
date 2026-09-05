import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { Trace, SpanKind, httpAttrs } from "./otel.ts";

// Burst-photo debounce, the other half of it (schedule_evidence_landed_notify
// and evidence_landed_pending, 20260831zzzz6).
//
// evidence_landed used to fire straight off the jobs UPDATE trigger the
// moment the first evidence photo on a stage landed. Right for one photo,
// wrong for a worker sending several back to back: the AI review and the
// report going out were built from whatever had landed by the time that
// FIRST photo's trigger fired, not the whole burst. Every evidence insert
// now resets a 90-second quiet timer instead; this function, run once a
// minute by pg_cron, fires evidence_landed once nothing new has landed for
// the full 90 seconds, so one notification covers the whole burst.
//
// Same shape end to end as yaad-followup-check: a pg_cron job presenting a
// secret held here only as its SHA-256 hash, or a signed-in admin for a
// manual run, check-then-act, nothing here touches jobs.status,
// stage_approvals or evidence directly.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
// The same secret yaad-job-health and yaad-followup-check already use to
// call yaad-notify-client from outside a database trigger: this is an HTTP
// caller, not a pg_net trigger, so it needs the plaintext
// notify_trigger_secret_sha256 checks against, not a cron-only secret of
// its own.
const NOTIFY_SECRET = Deno.env.get("YAAD_CRON_SECRET") ?? "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

async function fireEvidenceLanded(jobId: string, trace: Trace): Promise<boolean> {
  try {
    return await trace.span("notify-client", SpanKind.INTERNAL, { "yaadly.notify.kind": "evidence_landed" }, async (s) => {
      const r = await fetch(`${SUPABASE_URL}/functions/v1/yaad-notify-client`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: NOTIFY_SECRET, jobId, kind: "evidence_landed" }),
        signal: AbortSignal.timeout(45000),
      });
      s.setAttributes({ "http.response.status_code": r.status });
      if (!r.ok) {
        const errText = await r.text().catch(() => "");
        console.error(`yaad-evidence-landed-check: notify-client ${r.status} for ${jobId}: ${errText.slice(0, 300)}`);
      }
      return r.ok;
    });
  } catch (e) {
    console.error(`yaad-evidence-landed-check: notify-client threw for ${jobId}: ${String(e).slice(0, 300)}`);
    return false;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const trace = new Trace("yaad-evidence-landed-check", req);
  const root = trace.startSpan(`${req.method} /yaad-evidence-landed-check`, SpanKind.SERVER, httpAttrs(req));
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

    // Same auth shape as yaad-job-health and yaad-followup-check: the
    // scheduler's own secret, checked against a hash held in app_settings,
    // or a signed-in admin for a manual run from concierge.
    const presented = String(body.secret ?? "");
    let allowed = false;
    if (presented) {
      const { data: st } = await admin.from("app_settings").select("value").eq("key", "evidence_landed_check_cron_secret_sha256").maybeSingle();
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

    const { data: due, error: dueErr } = await admin.rpc("due_evidence_landed_notifies");
    if (dueErr) { root.recordError(dueErr.message); return json({ error: dueErr.message }, 500); }

    let fired = 0, notified = 0, stale = 0;
    for (const p of (due ?? []) as { id: string; job_id: string; stage: number; should_notify: boolean }[]) {
      let sent = false;
      if (p.should_notify) {
        // Marked fired either way: a failed HTTP call here is the same
        // class of thing as a failed Twilio send elsewhere in this
        // repository, "we attempted this," not "it definitely worked."
        // Retrying forever on a job that keeps failing to notify would be
        // its own kind of stall.
        const ok = await fireEvidenceLanded(p.job_id, trace);
        if (ok) notified++;
        // An ATTEMPT, deliberately, not a confirmed delivery. This is what
        // stops the stage being emailed a second time (20260906015600), and
        // it has to mean the same thing as fired_at does: we tried. A retry
        // loop that keeps emailing a client until something returns 200 is
        // worse than one email that may have failed.
        sent = true;
      } else {
        // The stage moved on (approved, disputed, or a new stage started)
        // in the 90 seconds this timer was open. Cleared silently, the
        // same way a resolved job_followups row clears: real activity
        // already answered whatever this timer was waiting to say.
        stale++;
      }
      await admin.rpc("mark_evidence_landed_fired", { p_id: p.id, p_notified: sent });
      fired++;
    }

    root.setAttributes({
      "yaadly.evidence_landed_check.due": (due ?? []).length,
      "yaadly.evidence_landed_check.fired": fired,
      "yaadly.evidence_landed_check.notified": notified,
      "yaadly.evidence_landed_check.stale": stale,
    });
    return json({ ok: true, due: (due ?? []).length, fired, notified, stale });
  } catch (e) {
    root.recordError(e);
    return json({ error: String(e).slice(0, 200) }, 500);
  }
});
