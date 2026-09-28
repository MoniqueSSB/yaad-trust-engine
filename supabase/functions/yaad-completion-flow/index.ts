import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { httpAttrs, SpanKind, Trace } from "./otel.ts";
import { chatWithFailover, firstJsonObject, pickTextProvider, providerAttrs } from "./textmodel.ts";
import * as guardrails from "./guardrails.ts";
import { screenWords } from "./screen.ts";

/* ── yaad-completion-flow ─────────────────────────────────────────────────
 *
 * The two automatic steps of the Completion Report, 28 September 2026
 * (migration 20260928210000). Founder: the report is the worker's document,
 * and she steps in only when something goes wrong or a dispute is raised.
 *
 *   start   A job has just completed. Draft a few care notes, then open the
 *           report with the worker, who gets a WhatsApp link (the trigger on
 *           completion_reports sends it through yaad-notify-client). If the
 *           model is down the report opens anyway with no care notes, and the
 *           worker writes their own. Nobody waits on a person.
 *
 *   screen  The worker has signed. Screen the words they signed, the care
 *           notes and their own account, against the banned-language list
 *           both runtimes share and for money amounts. Clean: the report is
 *           issued to the client. Anything found: it is HELD and Monique is
 *           alerted. This step can only ever hold a report back. It never
 *           writes, rewrites or removes a word, because the words are the
 *           worker's and they signed them.
 *
 * AUTH. Deployed WITH --no-verify-jwt, like yaad-notify-client: the database
 * triggers call it and hold no session. The door is the same trigger secret,
 * checked against app_settings.notify_trigger_secret_sha256, or a signed-in
 * admin's token (the desk's "Start it now" and "Screen it again"). The
 * database functions it calls (_start_completion_report,
 * _screen_completion_report) are granted to service_role only and carry
 * their own rules: a job must be complete, a screen must match the revision
 * the worker signed.
 *
 * MODEL. Care notes only, never facts, never money. The facts on the report
 * are read from the record by the page. Provider from _shared/textmodel.ts.
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SYSTEM = `You write the "looking after it" notes for a Yaadly Completion Report: the record a property owner, usually overseas, keeps for work done on their property in Jamaica. The worker who did the job reads your notes, may change them, and signs the report.

RULES:
1. Two to four notes. Each one sentence, plain English, general good practice for the kind of work described.
2. Use only what the input says the work was. Never invent a material, a product, a measurement or a date.
3. Never mention money, prices or costs.
4. Suggest, never certify. Anything beyond routine care points to a qualified tradesperson.
5. Never promise a result, and never use the words guarantee, guaranteed, warranty, 100%, escrow or fully covered.

Return STRICT JSON only: {"care_notes": ["...", "..."]}`;

async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// deno-lint-ignore no-explicit-any
async function allowed(req: Request, body: Record<string, unknown>, admin: any): Promise<boolean> {
  const secret = String(body.secret ?? "");
  if (secret) {
    const { data } = await admin.from("app_settings").select("value").eq("key", "notify_trigger_secret_sha256").maybeSingle();
    return !!data?.value && data.value === await sha256Hex(secret);
  }
  const tok = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!tok || !ANON_KEY) return false;
  const asCaller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${tok}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data } = await asCaller.rpc("is_admin");
  return data === true;
}

// deno-lint-ignore no-explicit-any
async function draftCareNotes(admin: any, jobId: string, trace: Trace): Promise<{ notes: string[]; model: string | null }> {
  const prov = pickTextProvider();
  if (!prov) return { notes: [], model: null };
  const { data: job } = await admin.from("jobs").select("title, trade, parish, descr").eq("id", jobId).maybeSingle();
  if (!job || !String(job.descr ?? "").trim()) return { notes: [], model: null };
  const { data: ev } = await admin.from("evidence").select("label, phase, kind").eq("job_id", jobId).order("created_at").limit(40);
  const user = [
    "Job: " + String(job.title ?? ""),
    "Trade: " + String(job.trade ?? ""),
    "Parish: " + String(job.parish ?? ""),
    "The work agreed: " + String(job.descr ?? ""),
    "Evidence on record:",
    // deno-lint-ignore no-explicit-any
    ...((ev ?? []) as any[]).map((e) => "- " + String(e.label ?? "") + (e.kind === "materials" ? " (materials receipt)" : e.phase ? " (" + e.phase + ")" : "")),
  ].join("\n").slice(0, 5000);
  try {
    return await trace.span(`chat ${prov.model}`, SpanKind.CLIENT, { ...providerAttrs(prov), "yaadly.agent.name": "completion-care-notes" }, async (s) => {
      const { provider, res } = await chatWithFailover(prov, {
        temperature: 0.3, max_tokens: 2500,
        messages: [{ role: "system", content: SYSTEM }, { role: "user", content: user }],
      }, { timeoutMs: 60_000, retries: 1, maxRetryWaitMs: 8_000 });
      s.setAttributes({ ...providerAttrs(provider), "http.response.status_code": res.status });
      if (!res.ok) return { notes: [], model: null };
      const j = await res.json().catch(() => ({}));
      const obj = firstJsonObject(j?.choices?.[0]?.message?.content ?? "");
      const notes = (Array.isArray(obj?.care_notes) ? obj!.care_notes as unknown[] : [])
        .map((x) => String(x ?? "").replace(/\s+/g, " ").trim()).filter((x) => x && x.length <= 400).slice(0, 4);
      // A draft that trips the screen is not offered to the worker at all:
      // it would only be held later, after they had signed it.
      if (screenWords(notes, null).length) return { notes: [], model: null };
      return { notes, model: notes.length ? provider.model : null };
    });
  } catch (_) {
    return { notes: [], model: null };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const trace = new Trace("yaad-completion-flow", req);
  const root = trace.startSpan("POST /yaad-completion-flow", SpanKind.SERVER, httpAttrs(req));
  const json = (b: unknown, status = 200) => {
    root.setAttributes({ "http.response.status_code": status });
    root.end();
    trace.flush();
    return new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });
  };
  if (req.method !== "POST") return json({ error: "POST only." }, 405);

  try {
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    const b = await req.json().catch(() => ({})) as Record<string, unknown>;
    if (!(await allowed(req, b, admin))) return json({ error: "Not authorised." }, 403);

    const jobId = String(b.jobId ?? "").trim();
    const step = String(b.step ?? "");
    if (!jobId) return json({ error: "Which job?" }, 400);
    root.setAttributes({ "yaadly.completion.step": step, "yaadly.job.id": jobId });

    if (step === "start") {
      const { data: existing } = await admin.from("completion_reports").select("job_id").eq("job_id", jobId).maybeSingle();
      if (existing) return json({ ok: true, outcome: "exists" });
      const { notes, model } = await draftCareNotes(admin, jobId, trace);
      const { data, error } = await admin.rpc("_start_completion_report", { p_job: jobId, p_notes: notes, p_model: model });
      if (error) return json({ error: error.message }, 500);
      root.setAttributes({ "yaadly.completion.outcome": String(data), "yaadly.completion.care_notes": notes.length });
      return json({ ok: true, outcome: data, care_notes: notes.length });
    }

    if (step === "screen") {
      const { data: r } = await admin.from("completion_reports")
        .select("rev, status, care_notes, worker_account").eq("job_id", jobId).maybeSingle();
      if (!r || r.status !== "worker_signed") return json({ ok: true, outcome: "not_waiting" });
      const findings = screenWords((r.care_notes ?? []) as string[], r.worker_account ?? null);
      root.setAttributes(guardrails.screenAttrs(guardrails.scan([...(r.care_notes ?? []), r.worker_account ?? ""].join("\n"))));
      const { data, error } = await admin.rpc("_screen_completion_report", {
        p_job: jobId, p_rev: r.rev, p_findings: findings,
      });
      if (error) return json({ error: error.message }, 500);
      root.setAttributes({ "yaadly.completion.outcome": String(data), "yaadly.completion.findings": findings.length });
      return json({ ok: true, outcome: data, findings });
    }

    return json({ error: "Unknown step." }, 400);
  } catch (e) {
    root.recordError(e);
    return json({ error: String(e) }, 500);
  }
});
