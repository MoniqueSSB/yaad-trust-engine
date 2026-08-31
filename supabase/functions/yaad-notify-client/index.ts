/* ── yaad-notify-client ────────────────────────────────────────────────────
 *
 * One place that knows how to reach a client, for every state change that
 * happens to their job without them being the one who caused it. Stage 5.3.
 *
 * WHO CALLS THIS, AND WHY THAT DECIDES THE SHAPE. "Fire from the same
 * functions that change state, never from the UI." Called from Postgres
 * triggers via pg_net.http_post, the same mechanism yaad-vetting-purge's
 * cron job already uses (20260827f), so a state change notifies whether it
 * happened through the portal, a future WhatsApp reply, or the admin desk,
 * with nothing in any of those three places having to remember to call it.
 *
 * A trigger has no user session and cannot read this function's environment,
 * so it cannot prove itself the way a signed-in browser can. It proves
 * itself the same way the purge cron job does: a shared secret, generated
 * once, stored here only as its SHA-256 hash, baked as plaintext into the
 * trigger function bodies that call this. The database holds nothing usable
 * on its own.
 *
 * WHY A KIND ENUM AND NOT A FREE MESSAGE BODY. The caller sends {secret,
 * jobId, kind, meta}, never a string to display. Every sentence a client
 * receives is composed here, from data this function looks up itself. A
 * leaked secret then lets an attacker trigger a REAL notification about a
 * REAL job state, which is bad enough, but never lets them make Yaadly say
 * an arbitrary thing to somebody's phone.
 *
 * CHANNELS: the same order yaad-quote-landed already proved. Twilio
 * WhatsApp, then Meta's API, then Twilio SMS, then Resend email regardless.
 * None of the four kinds below has an approved WhatsApp Content Template of
 * its own yet, only the quote-landed wording does (yaadly_quote_landed_v2),
 * and this function does not reuse it: reusing a template approved for one
 * sentence to send a different sentence is exactly the kind of thing that
 * gets a WhatsApp sender flagged. So all four go over WhatsApp as free text,
 * which works inside the 24 hour window and fails honestly outside it, same
 * as everything else on this number until Trust Hub KYC clears (RUNBOOK.md).
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import { httpAttrs, SpanKind, Trace } from "./otel.ts";
import { pickTextProvider, providerAttrs } from "./textmodel.ts";
import * as guardrails from "./guardrails.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const RESEND_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM_EMAIL = Deno.env.get("YAAD_FROM_EMAIL") ?? "jobs@in.yaadly.co.uk";
const REPLY_TO = Deno.env.get("YAAD_REPLY_TO") ?? "monique@yaadly.co.uk";
const APP_URL = Deno.env.get("YAAD_APP_URL") ?? "https://app.yaadly.co.uk";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const KINDS = ["quote_arrived", "evidence_landed", "dispute_raised", "stage_released", "worker_on_site", "walkthrough_notes_ready", "job_delayed"] as const;
type Kind = (typeof KINDS)[number];

const money = (n: number | null) => (n == null ? "" : "J$" + Number(n).toLocaleString("en-JM"));

async function sha256Hex(s: string): Promise<string> {
  const bytes = new TextEncoder().encode(s);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sendTwilio(
  to: string, body: string, channel: "whatsapp" | "sms", trace: Trace, mediaUrls: string[] = [],
) {
  const sid = Deno.env.get("TWILIO_ACCOUNT_SID") ?? "";
  const tok = Deno.env.get("TWILIO_AUTH_TOKEN") ?? "";
  const from = channel === "whatsapp"
    ? (Deno.env.get("TWILIO_WHATSAPP_FROM") ?? "")
    : (Deno.env.get("TWILIO_SMS_FROM") ?? "");
  if (!sid || !tok) return { sent: false, reason: "TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN not set" };
  if (!from) return { sent: false, reason: `TWILIO_${channel === "whatsapp" ? "WHATSAPP" : "SMS"}_FROM not set` };
  const digits = to.replace(/\D/g, "");
  if (digits.length < 7) return { sent: false, reason: "number not usable" };
  const dest = channel === "whatsapp" ? `whatsapp:+${digits}` : `+${digits}`;
  return await trace.span(`twilio.send.${channel}`, SpanKind.CLIENT, {
    "server.address": "api.twilio.com", "messaging.system": "twilio",
  }, async (s) => {
    try {
      const params = new URLSearchParams({ To: dest, From: from, Body: body });
      // Twilio's own form: MediaUrl repeated once per attachment, not
      // indexed. Only ever populated for the WhatsApp send below; SMS keeps
      // its existing role as a plain-text last resort.
      for (const u of mediaUrls) params.append("MediaUrl", u);
      const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: "POST",
        headers: { Authorization: "Basic " + btoa(`${sid}:${tok}`), "Content-Type": "application/x-www-form-urlencoded" },
        body: params,
        signal: AbortSignal.timeout(15000),
      });
      s.setAttributes({ "http.response.status_code": r.status });
      if (r.ok) return { sent: true, via: `twilio ${channel}` };
      const d = await r.json().catch(() => null) as { code?: number; message?: string } | null;
      const reason = d?.code === 63016
        ? "outside WhatsApp's 24 hour window, needed an approved template"
        : `twilio ${r.status}${d?.code ? ` (${d.code})` : ""}`;
      s.recordError(reason);
      return { sent: false, reason };
    } catch (e) {
      s.recordError(String(e).slice(0, 200));
      return { sent: false, reason: String(e).slice(0, 160) };
    }
  });
}

async function sendMetaWhatsApp(to: string, body: string, trace: Trace) {
  const token = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
  const phoneId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
  if (!token || !phoneId) return { sent: false, reason: "WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID not set" };
  return await trace.span("whatsapp.send", SpanKind.CLIENT, {
    "server.address": "graph.facebook.com", "messaging.system": "whatsapp",
  }, async (s) => {
    try {
      const r = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ messaging_product: "whatsapp", to: to.replace(/\D/g, ""), type: "text", text: { body } }),
        signal: AbortSignal.timeout(15000),
      });
      s.setAttributes({ "http.response.status_code": r.status });
      return { sent: r.ok, status: r.status };
    } catch (e) {
      s.recordError(String(e).slice(0, 200));
      return { sent: false, reason: String(e).slice(0, 160) };
    }
  });
}

// ── the reporting agent, ported ──────────────────────────────────────────
//
// yaad/agents/reporting.py has existed since before this file did, fully
// built and fully guardrailed, and had never once run against a real
// notification: nothing in supabase/functions/ or web/ ever called it. This
// is that port, same system prompt, same four fields, same rule that a
// vague update says so rather than inventing detail, run here because the
// live side is Deno and the Python engine is stateless and does not deploy.
//
// The "worker update" this reads from is not a separate text box: it is the
// evidence labels already filed for the stage, "the joint before work",
// "cleared and refilled", in the order they were filed. That is genuinely
// what the worker told Yaadly happened, captured already, so this needed no
// new capture step to exist.
//
// A vague or failed digest never blocks the notification. The existing
// fixed sentence ("Photos have come in for stage N...") is what evidence_landed
// said before this port existed, is guaranteed guardrail-clean because
// nothing generated it, and is exactly what a client gets if the model has
// no key, returns nothing usable, or the composed text fails the same
// banned-language screen yaad-inbound's live replies already run through.
const REPORTING_SYSTEM = `You are the Reporting Agent for Yaadly.

A tradesperson in Jamaica has sent a progress update. It may be a Patois voice note transcript, a text, or photo captions. Convert it into a status report for a client who is overseas, probably in the UK, US or Canada, and who cannot see the property.

Return STRICT JSON only, exactly this shape:
{"headline":"one short factual sentence on where the job stands","plain_english":"two to four sentences describing what was actually done, in neutral standard English, keeping the worker's meaning exactly","what_happens_next":"the next step in the process","client_action_needed":"what the client must do now, or nothing right now"}

Rules you must not break:
- Report only what the worker said. Never add detail, never estimate progress as a percentage, never guess a completion date the worker did not give.
- Never promise the work is good, finished, or that payment will be released. A human reviews the evidence and the client approves.
- Never use the word escrow. Money is held safely with a licensed payment provider.
- Never make the worker sound unprofessional. Translate register, not dignity.
- If the update is too vague to report, say so plainly and put the missing detail in what_happens_next.
- Never use dash characters, use a comma or colon instead.`;

function stripReportingNoise(s: string): string {
  return String(s).replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/```(?:json)?/gi, "").trim();
}
function extractReportingJson(s: string): Record<string, string> | null {
  const text = stripReportingNoise(s);
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0, inStr = false, escNext = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (escNext) { escNext = false; continue; }
    if (c === "\\") { if (inStr) escNext = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) { try { return JSON.parse(text.slice(start, i + 1)); } catch (_) { return null; } } }
  }
  return null;
}

// Returns null on anything short of a clean, usable report, so the caller's
// existing fixed sentence is what actually ships. Never throws.
async function composeEvidenceReport(
  admin: any, jobId: string, jobTitle: string, stage: number, trace: Trace,
): Promise<string | null> {
  try {
    const prov = pickTextProvider();
    if (!prov) return null;

    const { data: items } = await admin
      .from("evidence")
      .select("label, created_at")
      .eq("job_id", jobId).eq("stage", stage)
      .order("created_at", { ascending: true });
    const labels = (items ?? []).map((e: any) => String(e.label ?? "").trim()).filter(Boolean);
    if (labels.length === 0) return null;

    const { data: job } = await admin.from("jobs").select("trade").eq("id", jobId).maybeSingle();
    const context = `JOB REF: ${jobTitle || jobId}\nTRADE: ${job?.trade || "not given"}\n\nWORKER UPDATE:\n${labels.join("\n")}`;

    const raw = await trace.span(`chat ${prov.model}`, SpanKind.CLIENT, {
      ...providerAttrs(prov), "gen_ai.operation.name": "chat", "yaadly.agent.name": "reporting",
    }, async (s) => {
      const r = await fetch(prov.api, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${prov.key}` },
        body: JSON.stringify({
          model: prov.model, temperature: 0.3, max_tokens: 600,
          messages: [{ role: "system", content: REPORTING_SYSTEM }, { role: "user", content: context }],
        }),
        signal: AbortSignal.timeout(20000),
      });
      const j = await r.json().catch(() => ({}));
      s.setAttributes({ "http.response.status_code": r.status });
      if (!r.ok) { s.recordError(`${prov.name} http ${r.status}`); return ""; }
      return j?.choices?.[0]?.message?.content ?? "";
    });

    const data = extractReportingJson(String(raw));
    if (!data) return null;

    const headline = String(data.headline ?? "").trim();
    const plain = String(data.plain_english ?? "").trim();
    const next = String(data.what_happens_next ?? "").trim();
    const action = String(data.client_action_needed ?? "nothing right now").trim();
    if (!headline || !plain) return null;

    const message = `${headline}\n\n${plain}\n\nNext: ${next}\nYou need to: ${action}`;
    if (guardrails.scan(message).length > 0) return null;
    return message;
  } catch (_) {
    return null;
  }
}

const MAX_PHOTOS_SENT_DIRECTLY = 5;

/** Signed URLs for the photos filed against one stage, so a client sees them
 *  right inside the WhatsApp message rather than only through a link.
 *  Founder's own requirement, 31 Aug 2026: evidence should reach the client
 *  directly, not only wait on the portal for them to open. Video is left
 *  out on purpose: WhatsApp's own media handling makes sending a video this
 *  way unreliable, and the portal is already the route for anything too
 *  big to text. Capped, not because more would fail, but because a message
 *  carrying ten photos reads as clutter, not proof.
 *
 *  Runs on the admin client, so it bypasses the same storage RLS the portal
 *  page relies on for a signed-in client's own session: this is a
 *  server-to-server send, not a page render, and the URL it hands back is
 *  only good for five minutes and only ever reaches Twilio's own fetch. */
async function evidencePhotoUrls(admin: any, jobId: string, stage: number, trace: Trace): Promise<string[]> {
  const { data: items } = await admin.from("evidence")
    .select("storage_path, mime")
    .eq("job_id", jobId).eq("stage", stage)
    .not("storage_path", "is", null)
    .like("mime", "image/%")
    .order("created_at", { ascending: true })
    .limit(MAX_PHOTOS_SENT_DIRECTLY);
  const paths = (items ?? []).map((e: any) => e.storage_path).filter(Boolean);
  if (!paths.length) return [];

  return await trace.span("storage.sign_evidence_urls", SpanKind.CLIENT, {}, async (s) => {
    try {
      const { data, error } = await admin.storage.from("evidence").createSignedUrls(paths, 300);
      if (error) { s.recordError(error.message); return []; }
      return (data ?? []).map((r: any) => r.signedUrl).filter(Boolean) as string[];
    } catch (e) {
      s.recordError(String(e).slice(0, 200));
      return [];
    }
  });
}

// ── the AI overview, ported from yaad-vision ────────────────────────────
//
// yaad-vision has existed since 17 Aug and nothing ever called it: it
// requires a signed-in caller's own JWT (may_use_agents), which a
// server-to-server notification has no way to present. Rather than loosen
// a working function's auth model for one new caller, the review itself is
// ported here, same system prompt, same model, same rule that a finding
// says only what is visible and never states a structural or safety
// diagnosis with certainty.
//
// Photos only. A video needs frames pulled out of it before any
// vision-language model can look at it, and nothing in an edge function
// does that today; asked for, 31 Aug 2026, not yet built, said so rather
// than silently reviewing nothing and calling it done.
const VISION_SYSTEM_PROMPT = `You are a construction and property condition reviewer working for Yaadly, a property oversight service in Jamaica. You look at photos of a property or completed work and report ONLY what is visibly evident in the image itself. You are not a licensed surveyor, engineer, or inspector, and your findings are a starting point for a human project manager, not a final judgement.

For each photo, look for visible issues in these categories where present:
- Water damage or staining
- Cracks (wall, foundation, ceiling)
- Peeling, bubbling, or flaking paint
- Missing, cracked, or degraded sealant or grout
- Mould or damp
- Rust or corrosion on metalwork
- Roofing issues (missing tiles, visible sagging, rust on zinc)
- Visible electrical hazards (exposed wiring, damaged fixtures)
- Visible plumbing issues (leaks, staining under fixtures)
- Structural concerns (visible sagging, leaning, significant cracking)
- Incomplete or inconsistent work versus the agreed scope, if scope is provided
- General visible safety hazards

Respond with a JSON array ONLY, no other text before or after it, in this exact shape:
[
  {
    "issue": "short label, e.g. Sealant missing on right column",
    "category": "one of: cosmetic, maintenance, safety, structural, scope_mismatch",
    "severity": "low, medium, or high",
    "note": "one sentence, plain English, describing only what is visible",
    "recommend_professional": true or false
  }
]

Rules:
- If nothing notable is visible, return an empty array: []
- Never state a structural or safety diagnosis with certainty. Use language like "appears to show" or "worth checking in person"
- Any finding in the "structural" or "safety" category MUST have "recommend_professional": true
- Do not invent detail that is not visible in the image
- If the photo is unclear, too dark, or too zoomed to judge, say so as a low-severity "cosmetic" note rather than guessing
- Output ONLY the JSON array`;

type VisionFinding = { issue?: string; category?: string; severity?: string; note?: string; recommend_professional?: boolean };

async function reviewEvidencePhotos(images: string[], jobTitle: string, trace: Trace): Promise<VisionFinding[] | null> {
  const key = Deno.env.get("NVIDIA_API_KEY");
  if (!key || !images.length) return null;
  const model = Deno.env.get("NVIDIA_VISION_MODEL") || "nvidia/nemotron-nano-12b-v2-vl";

  return await trace.span(`chat ${model}`, SpanKind.CLIENT, {
    "gen_ai.system": "nvidia_nim", "gen_ai.operation.name": "chat", "gen_ai.request.model": model,
    "server.address": "integrate.api.nvidia.com", "yaadly.agent.name": "photo_review",
  }, async (s) => {
    try {
      const userContent: Record<string, unknown>[] = [
        { type: "text", text: `Job: ${jobTitle || "unspecified"}\n\nReview the following photo(s) and return findings as instructed.` },
        ...images.slice(0, 6).map((url) => ({ type: "image_url", image_url: { url } })),
      ];
      const r = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model, temperature: 0.2, max_tokens: 1200,
          messages: [{ role: "system", content: VISION_SYSTEM_PROMPT }, { role: "user", content: userContent }],
        }),
        signal: AbortSignal.timeout(20000),
      });
      s.setAttributes({ "http.response.status_code": r.status });
      if (!r.ok) { s.recordError(`nvidia http ${r.status}`); return null; }
      const j = await r.json();
      const raw = j?.choices?.[0]?.message?.content ?? "[]";
      const match = String(raw).match(/\[[\s\S]*\]/);
      const findings = match ? JSON.parse(match[0]) : [];
      s.setAttributes({ "yaadly.vision.finding_count": findings.length });
      return findings;
    } catch (e) {
      s.recordError(String(e).slice(0, 200));
      return null;
    }
  });
}

/** One line the client can actually read, not a JSON dump. Null return
 *  (the model call failed) is handled by the caller, which just leaves the
 *  AI section out rather than claim a review happened when it did not. */
function summariseFindings(findings: VisionFinding[]): string {
  if (!findings.length) return "Nothing of concern visible in what was sent.";
  const worst = findings.some((f) => f.severity === "high") ? "high"
    : findings.some((f) => f.severity === "medium") ? "medium" : "low";
  const escalate = findings.some((f) => f.recommend_professional);
  const items = findings.slice(0, 3).map((f) => f.note || f.issue).filter(Boolean).join(" ");
  const tail = escalate ? " Worth a professional look in person." : "";
  const more = findings.length > 3 ? ` (${findings.length - 3} more noted on the job.)` : "";
  return `${items}${tail}${more}`.trim() || `${findings.length} item(s) noted, severity ${worst}.`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const trace = new Trace("yaad-notify-client", req);
  const root = trace.startSpan(`POST /yaad-notify-client`, SpanKind.SERVER, httpAttrs(req));
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

    const secret = String(b.secret ?? "");
    const jobId = String(b.jobId ?? "");
    const kind = String(b.kind ?? "") as Kind;
    if (!secret || !jobId || !KINDS.includes(kind)) {
      return json({ error: "secret, jobId and a valid kind are required." }, 400);
    }

    // The trigger proves itself with the secret, not a user session. Only a
    // caller holding the plaintext, which lives nowhere but inside the
    // trigger function bodies themselves, can produce a matching hash.
    const hash = await sha256Hex(secret);
    const { data: setting } = await admin.from("app_settings").select("value").eq("key", "notify_trigger_secret_sha256").maybeSingle();
    if (!setting?.value || setting.value !== hash) {
      root.setAttributes({ "yaadly.notify.outcome": "bad_secret" });
      return json({ error: "Not authorised." }, 403);
    }

    const { data: job } = await admin.from("jobs")
      .select("id, title, parish, stage, portal_code, client_email, client_phone")
      .eq("id", jobId).maybeSingle();
    if (!job) return json({ error: "No such job." }, 404);

    const clientEmail = String(job.client_email ?? "").trim();
    const clientPhone = String(job.client_phone ?? "").trim();

    // Post-booking every client has an account (Stage 2's own rule), so the
    // link always goes to the portal room rather than the no-account quotes
    // page: quote_arrived is the one kind that can happen before booking, on
    // a job that may not have a client_email at all yet if it arrived on
    // WhatsApp with only a phone number, so it links by portal_code instead.
    const roomLink = `${APP_URL}/portal/jobs/${encodeURIComponent(job.id)}`;
    const codeLink = job.portal_code
      ? `${APP_URL}/jobs/${encodeURIComponent(job.id)}/quotes?code=${encodeURIComponent(job.portal_code)}`
      : roomLink;

    let subject = "";
    let line = "";
    let photoUrls: string[] = [];

    if (kind === "quote_arrived") {
      const { data: q } = await admin.from("job_quotes")
        .select("worker_name, labour_jmd, materials_jmd")
        .eq("job_id", jobId).eq("status", "submitted")
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      const total = (q?.labour_jmd ?? 0) + (q?.materials_jmd ?? 0);
      subject = `A price on your job: ${job.title}`;
      line = `A price has come in on your Yaadly job, ${job.title}. ` +
        `${q?.worker_name ?? "A tradesperson"} quoted ${money(total)}. ` +
        `Nothing is booked and nothing is charged until you choose. See it here: ${codeLink}`;
    } else if (kind === "evidence_landed") {
      subject = `Evidence to review: ${job.title}`;
      // The photos themselves, not just a description of them, so a client
      // does not have to open the portal to see what actually arrived.
      // Founder's own requirement, 31 Aug 2026.
      photoUrls = await evidencePhotoUrls(admin, jobId, job.stage ?? 1, trace);

      // Two accounts, kept visibly separate: what the worker said happened,
      // and what an AI model can independently see in the photo. Neither
      // stands in for the other, and the client is shown the difference
      // rather than one blended sentence. Run concurrently, not one after
      // the other: two sequential model calls inside one request blew past
      // the trigger's own 15 second budget the first time this ran, and
      // net._http_response recorded no response at all rather than a
      // clean failure. Skipped entirely when there is nobody to tell:
      // running either call for a job with no email and no phone was
      // wasted latency and exactly what caused that first timeout.
      const [composed, findings] = (clientEmail || clientPhone)
        ? await Promise.all([
            composeEvidenceReport(admin, jobId, job.title, job.stage ?? 1, trace),
            photoUrls.length ? reviewEvidencePhotos(photoUrls, job.title, trace) : Promise.resolve(null),
          ])
        : [null, null];
      const workerSays = composed
        || `Photos have come in for stage ${job.stage ?? 1} of your job, ${job.title}, with no description from the worker.`;
      const aiSays = findings ? `AI noticed: ${summariseFindings(findings)}` : null;

      // The reply-to-approve route only exists for whoever reads it here.
      // Reply with the job's own code, same word for word as the code a
      // worker sends back to confirm a photo, matched against
      // approve_stage_via_whatsapp() in yaad-inbound. Anything else typed
      // back is read as a comment, not a new job, and goes to the worker:
      // founder's own requirement, 31 Aug 2026, "if they're not [satisfied],
      // there should be a way to respond back", confirmed to mean the
      // worker answers it, matched in yaad-inbound's own comment lane.
      const actionHint = clientPhone
        ? `Reply with the code ${job.id} to approve, or just say what you think and we will pass it to the worker.`
        : "Review it and reply from your portal.";
      line = [workerSays, aiSays, `${actionHint} ${roomLink}`].filter(Boolean).join("\n\n");
      root.setAttributes({
        "yaadly.notify.evidence_report_composed": !!composed,
        "yaadly.notify.photos_attached": photoUrls.length,
        "yaadly.notify.ai_review_ran": findings !== null,
        "yaadly.notify.ai_finding_count": findings?.length ?? 0,
      });
    } else if (kind === "dispute_raised") {
      // A receipt, not a ping about somebody else's action: only the client
      // may raise a dispute today (see the RLS policy on disputes), so this
      // confirms it landed and is being read, the same shape as an enquiry
      // receipt.
      subject = `We have your dispute: ${job.title}`;
      line = `Your message about ${job.title} is with a person, not a queue. ` +
        `Nothing more is paid on this job while it is open. See it and add anything here: ${roomLink}`;
    } else if (kind === "stage_released") {
      const { data: approval } = await admin.from("stage_approvals")
        .select("stage, approved_at")
        .eq("job_id", jobId).order("approved_at", { ascending: false }).limit(1).maybeSingle();
      subject = `Confirmed: stage ${approval?.stage ?? ""} approved`;
      line = `You approved stage ${approval?.stage ?? ""} of ${job.title}. ` +
        `The worker is paid for it, and the job now carries the record. Nothing else to do here: ${roomLink}`;
    } else if (kind === "worker_on_site") {
      const { data: arrival } = await admin.from("arrival_log")
        .select("stage, arrived_at")
        .eq("job_id", jobId).order("arrived_at", { ascending: false }).limit(1).maybeSingle();
      subject = `On site today: ${job.title}`;
      line = `Your worker checked in on site today for stage ${arrival?.stage ?? job.stage ?? 1} of ${job.title}. ` +
        `Follow along here: ${roomLink}`;
    } else if (kind === "walkthrough_notes_ready") {
      subject = `Notes from your video walkthrough: ${job.title}`;
      line = `The worker has written up what came out of your video walkthrough on ${job.title}. ` +
        `Read them and confirm they are accurate here: ${roomLink}`;
    } else if (kind === "job_delayed") {
      // Told honestly and early, before the client has to ask. Says nothing
      // about why: yaad-job-health knows a job has gone quiet, not the
      // reason, and guessing at one here would be exactly the kind of
      // invented detail this repository's own agents are built to refuse.
      subject = `A delay on your job: ${job.title}`;
      line = `There has been no update on ${job.title} for a few days, so we wanted you to hear it from us rather than notice the silence yourself. ` +
        `We are checking in with the worker directly. Nothing is wrong with the money held on this job, and you can raise anything here: ${roomLink}`;
    }

    let emailed = false;
    let emailReason = RESEND_KEY ? "" : "RESEND_API_KEY not set";
    if (clientEmail && RESEND_KEY) {
      await trace.span("resend.send", SpanKind.CLIENT, { "server.address": "api.resend.com", "messaging.system": "resend" }, async (s) => {
        try {
          const r = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              from: `Yaadly <${FROM_EMAIL}>`, to: [clientEmail], reply_to: REPLY_TO,
              subject, text: line, html: `<p>${line.replace(codeLink, `<a href="${codeLink}">${codeLink}</a>`).replace(roomLink, `<a href="${roomLink}">${roomLink}</a>`)}</p>`,
            }),
            signal: AbortSignal.timeout(15000),
          });
          s.setAttributes({ "http.response.status_code": r.status });
          emailed = r.ok;
          if (!r.ok) { emailReason = `resend ${r.status}`; s.recordError(`${emailReason}: ${(await r.text()).slice(0, 160)}`); }
        } catch (e) { emailReason = String(e).slice(0, 160); s.recordError(emailReason); }
      });
    } else if (!clientEmail) {
      emailReason = "no client email on the job";
    }

    let wa: { sent: boolean; reason?: string; via?: string } = { sent: false, reason: "no client phone on the job" };
    if (clientPhone) {
      // Photos ride only on the WhatsApp attempt. A fallback to Meta or SMS
      // means the WhatsApp send itself failed, and a signed URL that was
      // good for five minutes has likely aged past useful by the time a
      // second attempt runs; the text and the portal link still carry the
      // fact either way.
      wa = await sendTwilio(clientPhone, line, "whatsapp", trace, photoUrls);
      if (!wa.sent) {
        const meta = await sendMetaWhatsApp(clientPhone, line, trace);
        if (meta.sent) wa = { ...meta, via: "meta whatsapp" };
        else {
          const sms = await sendTwilio(clientPhone, line, "sms", trace);
          if (sms.sent) wa = { ...sms, via: "twilio sms" };
        }
      }
    }

    const told = emailed || wa.sent;
    root.setAttributes({ "yaadly.notify.kind": kind, "yaadly.notify.emailed": emailed, "yaadly.notify.whatsapp": wa.sent, "yaadly.notify.outcome": told ? "told" : "nobody_told" });
    return json({ ok: true, kind, told, emailed, emailReason: emailed ? "" : emailReason, whatsapp: wa });
  } catch (e) {
    root.recordError(e);
    return json({ error: String(e).slice(0, 200) }, 500);
  }
});
