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
// 2. NOTHING is approved here. Every finished draft waits at 'ready' for a
//    person in the desk's Quote Pack Drafts view, and the desk is pushed
//    when any are waiting.
//
//    This function DID auto-approve anything the guardrail passed, until
//    4 September 2026, when roadmap item 7 of the agent audit removed it.
//    The guardrail is a banned-word scan and a currency regex: it knows
//    whether the draft said "escrow" or wrote a price, and it cannot know
//    whether the scope is right or the stages run in the order the building
//    demands. A clean scan was standing in for a judgement it never made.
//    The founder's own 1 September correction ("I never saw when the small
//    pack was issued for review") was already pointing here: a review step
//    existed and phase 2 approved past it.
//
//    The drafting is untouched, which is the part that saves the time.
//    QuotePanel.tsx's own usableDraft() check is a courtesy, not the gate:
//    RLS is what actually keeps an unapproved draft off a worker's screen
//    (20260901r), and a worker with no pack can still quote, so this delays
//    a courtesy rather than stalling the board.

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

/** One push to Monique's phone. A local helper rather than a shared module,
 *  matching this repository's house style for small per-function helpers
 *  (yaad-portal-code's header calls that out as deliberate). Never throws: a
 *  notification must never break the poll it rides on. */
async function pingDesk(admin: any, title: string, body: string): Promise<void> {
  try {
    const { data: st } = await admin.from("app_settings").select("value").eq("key", "ntfy_topic").single();
    if (!st?.value) return;
    await fetch(`https://ntfy.sh/${st.value}`, {
      method: "POST",
      headers: { Title: title.slice(0, 120), Priority: "high", Tags: "eyes" },
      body,
      signal: AbortSignal.timeout(4000),
    });
  } catch (_) { /* never let a notification break a scheduled run */ }
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

    // ── Phase 2: NOTHING IS APPROVED HERE ANY MORE. ────────────────────
    //
    // Until 4 September 2026 a guardrail-clean draft was approved by this
    // function and went straight to a worker. Removed by roadmap item 7 of
    // the agent audit, and the reason is worth stating plainly: the guardrail
    // is a banned-word scan and a currency regex. It can tell whether the
    // draft said "escrow" or wrote a price. It cannot tell whether the SCOPE
    // is right, whether the exclusions protect the trade, or whether the
    // payment stages make sense in the order the building actually demands.
    // A clean scan was standing in for a judgement it never made.
    //
    // The founder's own correction of 1 September was already pointing here,
    // live: "I never saw when the small pack was issued for review." A review
    // step was added and then phase 2 auto-approved anything clean, so in
    // practice a clean pack still went out unread. This closes that.
    //
    // What is NOT removed is the drafting. The model still writes the pack
    // within a poll of the job going live, which is the part that saves the
    // time. All that changed is that a person decides it may be seen.
    //
    // Cost of getting this wrong in the other direction: a worker with no
    // approved pack simply sees no scoping document (RLS, 20260901r). He can
    // still quote. So this delays a courtesy, it does not stall the board.
    const { data: readyDrafts } = await admin.from("quote_pack_drafts")
      .select("id,job_id,guardrail").eq("status", "ready");
    const heldForReview = (readyDrafts ?? []).length;
    const dirty = (readyDrafts ?? []).filter((d) => {
      const g = (d.guardrail ?? {}) as Record<string, unknown>;
      return Boolean(g.price_language_detected) || Boolean(g.banned_language_detected);
    }).length;

    // Told once per poll, and only when something is actually waiting, so the
    // queue cannot quietly become the bottleneck the audit warned it could.
    if (heldForReview > 0) {
      await pingDesk(admin,
        `${heldForReview} quote pack${heldForReview === 1 ? "" : "s"} waiting on you`,
        `${heldForReview} draft${heldForReview === 1 ? " is" : "s are"} ready and no worker can see ${heldForReview === 1 ? "it" : "them"} until you approve. `
          + `${dirty > 0 ? `${dirty} flagged by the guardrail. ` : "None flagged. "}`
          + `Desk, Quote Pack Drafts.`);
    }

    root.setAttributes({
      "yaadly.quote_pack_check.requested": requested,
      "yaadly.quote_pack_check.held_for_review": heldForReview,
      "yaadly.quote_pack_check.flagged": dirty,
    });
    return json({ ok: true, requested, skippedNoBrief, skippedTooManyFailures, requestFailed, requestErrors, heldForReview, flagged: dirty });
  } catch (e) {
    root.recordError(e);
    return json({ error: String(e).slice(0, 200) }, 500);
  }
});
