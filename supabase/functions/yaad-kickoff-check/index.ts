import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { Trace, SpanKind, httpAttrs } from "./otel.ts";

// Kickoff Pack dual agreement, step 4 of 5, third piece: the automatic
// trigger itself. Polled by pg_cron, same shape end to end as
// yaad-evidence-landed-check and yaad-followup-check: a scheduler's own
// secret held here only as its SHA-256 hash, or a signed-in admin for a
// manual run.
//
// Two separate jobs each tick, deliberately not combined into one query:
//
// 1. A job with a chosen worker and no draft yet gets one requested, from
//    yaad-kickoff, authenticated as the service role - not a shared secret
//    baked into a trigger the way the notify triggers work, and not a
//    weaker check inside yaad-kickoff either. The service role key is
//    already the single most-trusted secret in this system and already
//    never reaches a browser (CLAUDE.md §6); reusing it here adds no new
//    secret to leak or drift, unlike minting another shared one.
//
// 2. A finished draft that has never been linked gets checked against its
//    own guardrail flags and, only if clean, becomes the job's Kickoff
//    Pack directly at status 'approved' - the automatic half of what
//    link_kickoff_draft_to_job() does by hand for the admin desk. A dirty
//    draft is left exactly where it is, visible in the desk's own Kickoff
//    Drafts view, for a human to notice and fix; nothing here ever issues
//    flagged content, the same hard rule 20260831zzzz11 put on the manual
//    door.
//
// choose_worker() itself no longer requires a pack to exist first
// (20260831zzzz13): this function is what fills that gap in afterward,
// not synchronously with the choose, within one poll interval of it.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Job = {
  id: string; title: string | null; client_name: string | null; parish: string | null;
  descr: string | null; trade: string | null; urgency: string | null;
  access_type: string | null; access_contact: string | null;
};

// Only fields this repository actually has structured, correctly-named
// data for. client_location, property_type, ground_contact, constraints
// and already_agreed are deliberately left out rather than guessed from a
// field that means something adjacent but different: yaad-kickoff's own
// system prompt already turns an unanswered field into an open question
// for the client rather than inventing one, the same discipline the
// Pricing agent applies to a missing benchmark.
function jobToIntake(j: Job): Record<string, string> {
  const access = [j.access_type, j.access_contact].filter((v) => v && v.trim()).join(", ");
  const out: Record<string, string> = {};
  if (j.title) out.title = j.title;
  if (j.client_name) out.client_name = j.client_name;
  if (j.parish) out.parish = j.parish;
  if (j.descr) out.brief = j.descr;
  if (j.trade) out.trades = j.trade;
  if (j.urgency) out.timing = j.urgency;
  if (access) out.access = access;
  return out;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const trace = new Trace("yaad-kickoff-check", req);
  const root = trace.startSpan(`${req.method} /yaad-kickoff-check`, SpanKind.SERVER, httpAttrs(req));
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

    // Same auth shape as the other cron checks: this function's own secret,
    // checked against a hash in app_settings, or a signed-in admin for a
    // manual run from concierge.
    const presented = String(body.secret ?? "");
    let allowed = false;
    if (presented) {
      const { data: st } = await admin.from("app_settings").select("value").eq("key", "kickoff_check_cron_secret_sha256").maybeSingle();
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
        const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/is_admin`, {
          method: "POST",
          headers: { "Content-Type": "application/json", apikey: ANON_KEY, Authorization: `Bearer ${jwt}` },
          body: "{}",
        });
        allowed = r.ok && (await r.json().catch(() => false)) === true;
      }
    }
    if (!allowed) return json({ error: "Not authorised." }, 403);

    // ── Phase 1: request a draft for a job that has a chosen worker and
    // none yet, and hasn't already failed three times running. ──────────
    const { data: jobs } = await admin.from("jobs")
      .select("id,title,client_name,parish,descr,trade,urgency,access_type,access_contact")
      .not("worker_email", "is", null).eq("status", "in_progress") as { data: Job[] | null };

    const { data: draftRows } = await admin.from("kickoff_drafts")
      .select("job_id,status").not("job_id", "is", null);
    const { data: packRows } = await admin.from("kickoff_packs").select("job_id");

    const hasActiveOrReadyDraft = new Set((draftRows ?? []).filter((d) => d.status === "drafting" || d.status === "ready").map((d) => d.job_id));
    const hasPack = new Set((packRows ?? []).map((p) => p.job_id));
    const failedCounts = new Map<string, number>();
    for (const d of draftRows ?? []) {
      if (d.status === "failed") failedCounts.set(d.job_id, (failedCounts.get(d.job_id) ?? 0) + 1);
    }

    let requested = 0, skippedNoBrief = 0, skippedTooManyFailures = 0, requestFailed = 0;
    const requestErrors: string[] = [];
    for (const j of jobs ?? []) {
      if (hasActiveOrReadyDraft.has(j.id) || hasPack.has(j.id)) continue;
      if ((failedCounts.get(j.id) ?? 0) >= 3) { skippedTooManyFailures++; continue; }
      const intake = jobToIntake(j);
      if (!intake.brief) { skippedNoBrief++; continue; }

      const errMsg = await trace.span("yaad-kickoff request", SpanKind.INTERNAL, { "yaadly.kickoff_check.job_id": j.id }, async (s) => {
        // apikey and Authorization must carry the SAME key type: the
        // gateway itself refuses a mix ("Conflicting API keys"), caught
        // live the first time this actually ran, not from reading the docs.
        const r = await fetch(`${SUPABASE_URL}/functions/v1/yaad-kickoff`, {
          method: "POST",
          headers: { "Content-Type": "application/json", apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
          body: JSON.stringify({ jobId: j.id, intake }),
          signal: AbortSignal.timeout(15000),
        });
        s.setAttributes({ "http.response.status_code": r.status });
        if (r.ok) return "";
        const t = await r.text().catch(() => "");
        return `${j.id}: ${r.status} ${t.slice(0, 200)}`;
      });
      if (!errMsg) requested++; else { requestFailed++; requestErrors.push(errMsg); }
    }

    // ── Phase 2: a finished, guardrail-clean draft becomes the job's pack,
    // issued directly at 'approved'. A dirty one is left for a human. ────
    const { data: readyDrafts } = await admin.from("kickoff_drafts")
      .select("id,job_id,intake,docs,model,guardrail")
      .not("job_id", "is", null).eq("status", "ready");

    let linked = 0, heldForReview = 0, linkFailed = 0;
    for (const d of readyDrafts ?? []) {
      if (hasPack.has(d.job_id)) continue; // a second poll caught it mid-flight
      const g = (d.guardrail ?? {}) as Record<string, unknown>;
      const dirty = Boolean(g.price_language_detected) || Boolean(g.banned_language_detected) || Boolean(g.foreign_text_detected);
      if (dirty) { heldForReview++; continue; }

      const intake = (d.intake ?? {}) as Record<string, unknown>;
      const { data: job } = await admin.from("jobs").select("parish").eq("id", d.job_id).maybeSingle();
      const packId = "KO-" + Math.floor(Date.now() * 1) + "-" + Math.floor(Math.random() * 1000);
      const confirmCode = Array.from(crypto.getRandomValues(new Uint8Array(4)))
        .map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase().slice(0, 6);
      // Inserted at 'draft' and then updated to 'approved' as two steps, not
      // one insert straight at 'approved': trg_notify_kickoff_pack_ready
      // (20260831zzzz12) fires on the UPDATE transition into 'approved',
      // comparing OLD against NEW, and an insert has no OLD row to compare
      // against. Skipping the update step would auto-issue the pack
      // correctly but never tell the worker it exists, silently defeating
      // the one piece built specifically to solve that. Caught by checking
      // the actual pack status was right for the wrong reason, not assumed.
      const { error: insErr } = await admin.from("kickoff_packs").insert({
        id: packId,
        job_id: d.job_id,
        project_title: String(intake.title ?? "").trim() || "Untitled project",
        client_name: String(intake.client_name ?? "").trim() || null,
        parish: String(intake.parish ?? "").trim() || job?.parish || null,
        intake: d.intake,
        docs: d.docs,
        model: d.model,
        confirm_code: confirmCode,
      });
      if (insErr) { console.error(`yaad-kickoff-check: link failed for draft ${d.id}: ${insErr.message}`); linkFailed++; continue; }

      const { error: updErr } = await admin.from("kickoff_packs").update({
        status: "approved",
        approved_by: "system: auto-issued, guardrail-clean",
        approved_at: new Date().toISOString(),
      }).eq("id", packId);
      if (updErr) { console.error(`yaad-kickoff-check: approve failed for pack ${packId}: ${updErr.message}`); linkFailed++; }
      else { linked++; hasPack.add(d.job_id); }
    }

    root.setAttributes({
      "yaadly.kickoff_check.requested": requested,
      "yaadly.kickoff_check.linked": linked,
      "yaadly.kickoff_check.held_for_review": heldForReview,
    });
    return json({
      ok: true,
      requested, skippedNoBrief, skippedTooManyFailures, requestFailed, requestErrors,
      linked, heldForReview, linkFailed,
    });
  } catch (e) {
    root.recordError(e);
    return json({ error: String(e).slice(0, 200) }, 500);
  }
});
