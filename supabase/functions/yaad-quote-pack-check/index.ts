import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { Trace, SpanKind, httpAttrs } from "./otel.ts";

// Quote Kickoff Pack, step 2 of 3: the automatic trigger. Same shape as
// yaad-kickoff-check: a scheduler's own secret held here only as its
// SHA-256 hash, or a signed-in admin for a manual run.
//
// Two phases now, not one. Founder's own correction, 1 Sep 2026, live:
// "I never saw when the small pack was issued for review" - the design as
// first built had no review step anywhere, a guardrail-clean 'ready'
// draft went straight into a worker's quote form the instant it finished.
//
// 1. A job that is open, unassigned and at stage 0 (exactly open_jobs' own
//    definition of "live", see the migration) with no draft yet, gets one
//    requested.
//
// 2. A finished, guardrail-clean draft is auto-approved directly, the
//    automatic half of what approve_quote_pack_draft() does by hand for
//    the admin desk - same shape as yaad-kickoff-check's own Phase 2 for
//    the big pack. A dirty draft is left exactly where it is, visible in
//    the desk's own Quote Pack Drafts view, for a human to notice and
//    fix; nothing here ever approves flagged content, the same hard rule
//    the manual door enforces. QuotePanel.tsx's own usableDraft() check
//    is a courtesy, not the gate: RLS is what actually keeps an
//    unapproved draft off a worker's screen (20260901r).

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Job = { id: string; title: string | null; parish: string | null; descr: string | null; trade: string | null; urgency: string | null; access_type: string | null };

// Same field discipline as yaad-kickoff-check's jobToIntake: only what this
// repository actually has structured data for, client_name and any contact
// field deliberately left out. A worker deciding whether to quote has not
// been chosen yet and open_jobs itself redacts contact details from descr
// for exactly this audience; this prompt carries the same redaction.
function jobToPrompt(j: Job): Record<string, string> {
  const out: Record<string, string> = {};
  if (j.title) out.title = j.title;
  if (j.parish) out.parish = j.parish;
  if (j.descr) out.brief = j.descr;
  if (j.trade) out.trades = j.trade;
  if (j.urgency) out.timing = j.urgency;
  if (j.access_type) out.access = j.access_type;
  return out;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const trace = new Trace("yaad-quote-pack-check", req);
  const root = trace.startSpan(`${req.method} /yaad-quote-pack-check`, SpanKind.SERVER, httpAttrs(req));
  const done = (res: Response, status: number) => { root.setAttributes({ "http.response.status_code": status }); root.end(); trace.flush(); return res; };
  const json = (b: unknown, status = 200) =>
    done(new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } }), status);

  try {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
    if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: "Not configured." }, 500);

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

    const presented = String(body.secret ?? "");
    let allowed = false;
    if (presented) {
      const { data: st } = await admin.from("app_settings").select("value").eq("key", "quote_pack_check_cron_secret_sha256").maybeSingle();
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

    // Live, unassigned, stage 0: exactly open_jobs' own definition
    // (COALESCE(worker_email,'') = '').
    const { data: jobRows } = await admin.from("jobs")
      .select("id,title,parish,descr,trade,urgency,access_type,worker_email")
      .eq("open", true).eq("stage", 0) as { data: (Job & { worker_email: string | null })[] | null };
    const jobs = (jobRows ?? []).filter((j) => !j.worker_email || !j.worker_email.trim());

    const { data: draftRows } = await admin.from("quote_pack_drafts").select("job_id,status");
    const hasActiveOrReadyDraft = new Set((draftRows ?? []).filter((d) => d.status === "drafting" || d.status === "ready").map((d) => d.job_id));
    const failedCounts = new Map<string, number>();
    for (const d of draftRows ?? []) if (d.status === "failed") failedCounts.set(d.job_id, (failedCounts.get(d.job_id) ?? 0) + 1);

    let requested = 0, skippedNoBrief = 0, skippedTooManyFailures = 0, requestFailed = 0;
    const requestErrors: string[] = [];
    for (const j of jobs) {
      if (hasActiveOrReadyDraft.has(j.id)) continue;
      if ((failedCounts.get(j.id) ?? 0) >= 3) { skippedTooManyFailures++; continue; }
      const prompt = jobToPrompt(j);
      if (!prompt.brief) { skippedNoBrief++; continue; }

      const errMsg = await trace.span("yaad-quote-pack request", SpanKind.INTERNAL, { "yaadly.quote_pack_check.job_id": j.id }, async (s) => {
        const r = await fetch(`${SUPABASE_URL}/functions/v1/yaad-quote-pack`, {
          method: "POST",
          headers: { "Content-Type": "application/json", apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
          body: JSON.stringify({ jobId: j.id, job: prompt }),
          signal: AbortSignal.timeout(15000),
        });
        s.setAttributes({ "http.response.status_code": r.status });
        if (r.ok) return "";
        const t = await r.text().catch(() => "");
        return `${j.id}: ${r.status} ${t.slice(0, 200)}`;
      });
      if (!errMsg) requested++; else { requestFailed++; requestErrors.push(errMsg); }
    }

    // ── Phase 2: a finished, guardrail-clean draft is approved directly.
    // A dirty one is left at 'ready' for a human in the concierge desk's
    // Quote Pack Drafts view. ──────────────────────────────────────────
    const { data: readyDrafts } = await admin.from("quote_pack_drafts")
      .select("id,guardrail").eq("status", "ready");
    let approved = 0, heldForReview = 0, approveFailed = 0;
    for (const d of readyDrafts ?? []) {
      const g = (d.guardrail ?? {}) as Record<string, unknown>;
      const dirty = Boolean(g.price_language_detected) || Boolean(g.banned_language_detected);
      if (dirty) { heldForReview++; continue; }
      const { error: updErr } = await admin.from("quote_pack_drafts").update({
        status: "approved",
        approved_by: "system: auto-issued, guardrail-clean",
        approved_at: new Date().toISOString(),
      }).eq("id", d.id).eq("status", "ready"); // second poll caught it mid-flight
      if (updErr) { console.error(`yaad-quote-pack-check: approve failed for draft ${d.id}: ${updErr.message}`); approveFailed++; }
      else approved++;
    }

    root.setAttributes({ "yaadly.quote_pack_check.requested": requested, "yaadly.quote_pack_check.approved": approved });
    return json({ ok: true, requested, skippedNoBrief, skippedTooManyFailures, requestFailed, requestErrors, approved, heldForReview, approveFailed });
  } catch (e) {
    root.recordError(e);
    return json({ error: String(e).slice(0, 200) }, 500);
  }
});
