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
 * None of the kinds below reuses an approved WhatsApp Content Template as
 * its FIRST attempt, free text only: reusing a template approved for one
 * sentence to send a different sentence is exactly the kind of thing that
 * gets a WhatsApp sender flagged, and it would mean sending a fixed
 * sentence instead of the real one, missing whatever the free text alone
 * carries. quote_arrived is the one exception, and only as a fallback: if
 * the free-text send fails specifically for landing outside WhatsApp's 24
 * hour window, and TWILIO_CONTENT_SID_QUOTE is configured, it retries once
 * with that approved template (yaadly_quote_landed_v2) rather than
 * reporting the failure and stopping there. Deliberately not used
 * unconditionally: quote_arrived's free text carries the worker's own
 * proposed scope in words (Stage 6, founder's decision 31 Aug 2026, the
 * client's reply to THIS message is what stands in for the portal's scope
 * tick), which the template's four fixed variable slots cannot hold. A
 * message that only sometimes has the scope in it is worse than one that
 * sometimes arrives a little later; the template exists so a client
 * outside the 24 hour window still gets something, not so the richer
 * message gets skipped when it does not need to be.
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import { type AttrValue, httpAttrs, SpanKind, Trace } from "./otel.ts";
import { pickTextProvider, providerAttrs } from "./textmodel.ts";
import * as guardrails from "./guardrails.ts";
import { Image } from "jsr:@matmen/imagescript";
import { encodeBase64 } from "jsr:@std/encoding/base64";

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

const KINDS = ["quote_arrived", "quote_awaiting_worker_confirm", "quote_accepted", "evidence_landed", "dispute_raised", "stage_released", "stage_released_worker", "worker_on_site", "walkthrough_notes_ready", "job_delayed", "evidence_comment", "evidence_report_confirmed", "kickoff_pack_ready", "service_booked", "service_confirmed", "service_live"] as const;
type Kind = (typeof KINDS)[number];

// The services lane (2 Sep 2026): the same hub, the same channel ladder,
// a different table. These kinds carry serviceId instead of jobId and read
// public.services; everything else about how a person is reached is shared.
const SERVICE_KINDS: readonly Kind[] = ["service_booked", "service_confirmed", "service_live"];

const money = (n: number | null) => (n == null ? "" : "J$" + Number(n).toLocaleString("en-JM"));

async function sha256Hex(s: string): Promise<string> {
  const bytes = new TextEncoder().encode(s);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sendTwilio(
  to: string, body: string, channel: "whatsapp" | "sms", trace: Trace, mediaUrls: string[] = [],
  template?: { sid: string; vars: Record<string, string> },
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
      // A template is only ever sent as itself: Content Templates carry
      // fixed, Meta-approved wording and let the caller fill in variable
      // slots, never free text of the caller's choosing, so this is not the
      // same risk as putting an arbitrary sentence through it.
      let params: URLSearchParams;
      if (template?.sid && channel === "whatsapp") {
        params = new URLSearchParams({
          To: dest, From: from, ContentSid: template.sid, ContentVariables: JSON.stringify(template.vars),
        });
      } else {
        params = new URLSearchParams({ To: dest, From: from, Body: body });
        // Twilio's own form: MediaUrl repeated once per attachment, not
        // indexed. Only ever populated for the WhatsApp send below; SMS keeps
        // its existing role as a plain-text last resort.
        for (const u of mediaUrls) params.append("MediaUrl", u);
      }
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
- Never use the word escrow, and never describe the client's money as held.
  Yaadly is principal: the client buys the job from Yaadly at one agreed price,
  and Yaadly engages and pays the tradesperson. Payment terms are agreed in
  writing for each job, and a named person approves every release.
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

type ComposedReport = { message: string; nextStep: string };

// Returns null on anything short of a clean, usable report, so the caller's
// existing fixed sentence is what actually ships. Never throws. nextStep is
// carried separately from the composed message, not re-parsed out of it
// later, so the follow-up mechanism (job_followups, below) acts on exactly
// what the model said rather than a second reading of its own words.
async function composeEvidenceReport(
  admin: any, jobId: string, jobTitle: string, stage: number, trace: Trace,
): Promise<ComposedReport | null> {
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
        signal: AbortSignal.timeout(25000),
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
    return { message, nextStep: next };
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
type EvidencePhoto = { url: string; code: string | null; label: string | null };

/** What a stage number actually means to the person reading the message.
 *  Founder's own correction, live, testing this for real: every message
 *  about a stage said only "stage 1" or "stage 2", a raw number with no
 *  connection to what the approved Kickoff Pack itself calls that stage
 *  or what share of the total it releases - even though the portal rail
 *  (jobStages() in journey.ts) has read the pack's own stage names since
 *  31 Aug. The data was always right; the message copy never said it.
 *  Falls back to the bare number for a job with no approved pack, same
 *  as the rail itself does. */
async function stageLabel(admin: any, jobId: string, stageNum: number): Promise<string> {
  const { data: pack } = await admin.from("kickoff_packs")
    .select("docs").eq("job_id", jobId).eq("status", "approved")
    .order("updated_at", { ascending: false }).limit(1).maybeSingle();
  const stages = pack?.docs?.payment_schedule?.stages;
  const s = Array.isArray(stages) ? stages[stageNum - 1] : null;
  if (s && typeof s.stage === "string" && s.stage.trim()) {
    const pct = typeof s.proportion_percent === "number" ? ` (${s.proportion_percent}% of the total)` : "";
    return `${s.stage}${pct}`;
  }
  return `stage ${stageNum}`;
}

async function evidencePhotoUrls(admin: any, jobId: string, stage: number, trace: Trace): Promise<EvidencePhoto[]> {
  const { data: items } = await admin.from("evidence")
    .select("storage_path, mime, item_code, label")
    .eq("job_id", jobId).eq("stage", stage)
    .not("storage_path", "is", null)
    .like("mime", "image/%")
    .order("created_at", { ascending: true })
    .limit(MAX_PHOTOS_SENT_DIRECTLY);
  const rows = (items ?? []).filter((e: any) => e.storage_path);
  if (!rows.length) return [];

  return await trace.span("storage.sign_evidence_urls", SpanKind.CLIENT, {}, async (s) => {
    try {
      const paths = rows.map((e: any) => e.storage_path);
      const { data, error } = await admin.storage.from("evidence").createSignedUrls(paths, 300);
      if (error) { s.recordError(error.message); return []; }
      const byPath = new Map((data ?? []).map((r: any) => [r.path, r.signedUrl]));
      return rows
        .map((e: any) => ({ url: byPath.get(e.storage_path), code: e.item_code ?? null, label: e.label ?? null }))
        .filter((p: EvidencePhoto) => p.url) as EvidencePhoto[];
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
//
// Reworded 31 Aug 2026: the original prompt ("reviewer", "hazards",
// "diagnosis", a preamble about not being a licensed surveyor) reads like
// exactly the shape of prompt a safety-tuned model is trained to decline,
// and in practice NVIDIA's model was declining it outright rather than
// returning findings, confirmed live in function_logs ("I'm not going to
// engage in this discussion topic"). Nothing about what the feature needs
// changed: same categories, same JSON shape, same refusal to overstate
// certainty. What changed is the framing, from "review this for hazards"
// to "note the visible condition for a job log", which is a description
// task rather than a judgement one.
const VISION_SYSTEM_PROMPT = `You write short, factual condition notes for a property maintenance job log in Jamaica, based on photos a tradesperson has taken on site. You describe only what is plainly visible in each image.

Note anything visible in these categories, where present:
- Water staining or damp marks
- Cracks in a wall, ceiling or floor
- Paint that is peeling, bubbling or flaking
- Sealant or grout that is missing, cracked or worn
- Mould
- Rust on metalwork
- Roofing wear (missing tiles, sagging, rust on zinc)
- Wiring or fixtures that look damaged or exposed
- Plumbing marks (leaks, staining under fixtures)
- Visible sagging, leaning or significant cracking in the structure
- Work that looks incomplete or does not match the stated scope, if a scope is given
- Anything else visibly out of place for a completed or in-progress job

You are shown one photo at a time.

Respond with a JSON array ONLY, no other text before or after it, in this exact shape:
[
  {
    "issue": "short label, e.g. Sealant missing on right column",
    "category": "one of: cosmetic, maintenance, safety, structural, scope_mismatch",
    "severity": "low, medium, or high",
    "note": "one plain sentence describing only what is visible",
    "recommend_professional": true or false
  }
]

Rules:
- If nothing notable is visible, return an empty array: []
- Describe only what the image shows. Use phrasing like "appears to show" or "worth a closer look in person" rather than stating a firm diagnosis
- Any note in the "structural" or "safety" category should have "recommend_professional": true
- Do not add anything you cannot see in the photo
- If a photo is unclear, too dark, or too zoomed to make out, note that as a low-severity "cosmetic" item rather than guessing
- Output ONLY the JSON array`;

type VisionFinding = {
  photo_code?: string; issue?: string; category?: string; severity?: string;
  note?: string; recommend_professional?: boolean;
};

// nvidia/nemotron-nano-12b-v2-vl was both declining the request outright
// ("I'm not going to engage in this discussion topic") and, separately,
// running past a 20s timeout on ordinary requests, confirmed live 31 Aug
// 2026. Llama 3.2's vision model is a mainstream instruction-tuned
// checkpoint with none of a "nano" experimental build's rough edges, and
// is what most NIM users actually run for photo description tasks. It
// stopped refusing once switched, but NVIDIA's hosted infrastructure for
// it is still uneven call to call, confirmed live the same day across
// three different shapes: a clean 15s response, a request that ran past
// 35s with nothing back, and a flat "http 500 Internal Server Error" on
// the very next attempt after that. A timeout and a 5xx are both "NVIDIA's
// side had a bad moment," worth one retry; a refusal or unparseable body
// is NVIDIA answering and answering badly, which asking again is unlikely
// to fix and isn't tried a second time.
async function attemptVisionReview(
  model: string, key: string, userContent: Record<string, unknown>[], s: { setAttributes: (a: Record<string, AttrValue>) => unknown },
): Promise<{ ok: true; findings: VisionFinding[] } | { ok: false; retryable: boolean }> {
  try {
    const r = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model, temperature: 0.2, max_tokens: 1200,
        messages: [{ role: "system", content: VISION_SYSTEM_PROMPT }, { role: "user", content: userContent }],
      }),
      signal: AbortSignal.timeout(25000),
    });
    s.setAttributes({ "http.response.status_code": r.status });
    if (!r.ok) {
      const errText = await r.text().catch(() => "");
      console.error(`yaad-vision: nvidia http ${r.status}: ${errText.slice(0, 300)}`);
      return { ok: false, retryable: r.status >= 500 };
    }
    const j = await r.json();
    const raw = j?.choices?.[0]?.message?.content ?? "[]";
    const match = String(raw).match(/\[[\s\S]*\]/);
    if (!match) {
      // A non-JSON reply is a distinct, reportable outcome, not the same
      // silent null as "never ran" (no key, no images): it means NVIDIA
      // answered and the answer was not usable, most likely a refusal.
      // Told apart in telemetry so a repeat can be seen without reading
      // function_logs every time, per RUNBOOK.md.
      console.error(`yaad-vision: no JSON array in model response: ${String(raw).slice(0, 300)}`);
      return { ok: false, retryable: false };
    }
    return { ok: true, findings: JSON.parse(match[0]) };
  } catch (e) {
    const isTimeout = e instanceof Error && e.name === "TimeoutError";
    console.error(`yaad-vision: ${isTimeout ? "timed out" : "threw"}: ${String(e).slice(0, 300)}`);
    return { ok: false, retryable: isTimeout };
  }
}

function findingLabel(f: VisionFinding, images: EvidencePhoto[]): string {
  const code = f.photo_code?.trim();
  if (code && images.some((p) => p.code === code)) return code;
  return "";
}

// Discovered live, 31 Aug 2026: NVIDIA's hosted meta/llama-3.2-11b-vision-
// instruct refuses more than one image in a single request outright
// ("At most 1 image(s) may be provided in one prompt"), an http 400, not a
// refusal or a timeout. A stage with more than one photo was silently
// getting no review at all rather than a partial one, since the whole
// batched call failed before any image was looked at.
//
// The fix turns out better than the batched design it replaces: one call
// per photo, run together rather than one after another so the wall clock
// stays close to a single photo's own latency, not the sum of five. Which
// photo a finding is about is no longer something the model has to get
// right and echo back, it is simply which call produced it, assigned here
// with certainty rather than parsed from the model's own words.
//
// A phone photo is commonly 8-12MB at full resolution, and nothing in this
// codebase resizes evidence before it is stored, deliberately: the stored
// copy is the proof, fingerprinted and timestamped exactly as filed, and
// stays that way. What NVIDIA fetches and decodes today is that same full
// original, over a shared free-tier inference service, which is a real
// part of why it times out. This shrinks a THROWAWAY copy for the review
// call only: nothing here writes to storage, nothing here touches
// evidence.sha256 or the signed URL the client and worker actually see.
// Supabase's own image transform could do this on the free tier for
// nobody, only paid plans, confirmed before reaching for a library instead.
const MAX_REVIEW_DIMENSION = 1024;
const REVIEW_JPEG_QUALITY = 70;

async function shrinkForReview(url: string): Promise<string | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) { console.error(`yaad-vision: shrink fetch http ${r.status}`); return null; }
    const original = new Uint8Array(await r.arrayBuffer());
    const img = await Image.decode(original);
    if (img.width > MAX_REVIEW_DIMENSION || img.height > MAX_REVIEW_DIMENSION) {
      if (img.width >= img.height) img.resize(MAX_REVIEW_DIMENSION, Image.RESIZE_AUTO);
      else img.resize(Image.RESIZE_AUTO, MAX_REVIEW_DIMENSION);
    }
    const encoded = await img.encodeJPEG(REVIEW_JPEG_QUALITY);
    // Silent success and silent fallback look identical from the outside,
    // the same gap this file already closed once for the review call
    // itself: a number here proves the resize actually ran rather than
    // hoping a fast response means it did.
    console.error(`yaad-vision: shrink ${original.length}b -> ${encoded.length}b (${img.width}x${img.height})`);
    return `data:image/jpeg;base64,${encodeBase64(encoded)}`;
  } catch (e) {
    // A photo NVIDIA cannot be handed at all is worse than a slow one it
    // is handed at full size: fall back to the original URL rather than
    // dropping the review entirely over a decode failure on one photo.
    console.error(`yaad-vision: shrink failed, using original: ${String(e).slice(0, 200)}`);
    return null;
  }
}

async function reviewOnePhoto(
  model: string, key: string, photo: EvidencePhoto, jobTitle: string, trace: Trace,
): Promise<VisionFinding[] | null> {
  return await trace.span(`chat ${model}`, SpanKind.CLIENT, {
    "gen_ai.system": "nvidia_nim", "gen_ai.operation.name": "chat", "gen_ai.request.model": model,
    "server.address": "integrate.api.nvidia.com", "yaadly.agent.name": "photo_review",
    "yaadly.vision.photo_code": photo.code ?? "",
  }, async (s) => {
    const shrunk = await shrinkForReview(photo.url);
    s.setAttributes({ "yaadly.vision.image_shrunk": !!shrunk });
    const userContent: Record<string, unknown>[] = [
      { type: "text", text: `Job: ${jobTitle || "unspecified"}\n\nReview this photo and return findings as instructed.` },
      { type: "image_url", image_url: { url: shrunk ?? photo.url } },
    ];
    let result = await attemptVisionReview(model, key, userContent, s);
    let attempts = 1;
    if (!result.ok && result.retryable) {
      result = await attemptVisionReview(model, key, userContent, s);
      attempts = 2;
    }
    s.setAttributes({ "yaadly.vision.attempts": attempts });
    if (!result.ok) {
      s.setAttributes({ "yaadly.vision.outcome": result.retryable ? "infra_error" : "unusable_response" });
      s.recordError(result.retryable ? "infra_error" : "unusable_response");
      return null;
    }
    s.setAttributes({ "yaadly.vision.outcome": "ok", "yaadly.vision.finding_count": result.findings.length });
    // Assigned from the call that produced it, not from anything the model
    // said: this call only ever saw one photo, so there is nothing to
    // attribute wrong.
    return result.findings.map((f) => ({ ...f, photo_code: photo.code ?? undefined }));
  });
}

/** Null only when nothing could be reviewed at all (no key, no images, or
 *  every photo's call failed): the caller's existing fixed sentence is what
 *  ships then. A stage where some photos reviewed and others did not still
 *  returns the findings that did, rather than discarding a partial result
 *  because one photo out of several had a bad moment. */
async function reviewEvidencePhotos(images: EvidencePhoto[], jobTitle: string, trace: Trace): Promise<VisionFinding[] | null> {
  const key = Deno.env.get("NVIDIA_API_KEY");
  if (!key) { console.error("yaad-vision: NVIDIA_API_KEY is not set"); return null; }
  if (!images.length) { console.error("yaad-vision: no image URLs to review"); return null; }
  const model = Deno.env.get("NVIDIA_VISION_MODEL") || "meta/llama-3.2-11b-vision-instruct";

  const perPhoto = await Promise.all(
    images.slice(0, 6).map((p) => reviewOnePhoto(model, key, p, jobTitle, trace)),
  );
  const reviewed = perPhoto.filter((r): r is VisionFinding[] => r !== null);
  if (!reviewed.length) return null;
  return reviewed.flat();
}

/** One line the client can actually read, not a JSON dump. Null return
 *  (the model call failed) is handled by the caller, which just leaves the
 *  AI section out rather than claim a review happened when it did not.
 *  Prefixes each note with its photo's code, but only when there is more
 *  than one photo to tell apart: on a single-photo stage, "P1:" in front
 *  of every sentence is noise nobody needs to disambiguate anything. */
function summariseFindings(findings: VisionFinding[], images: EvidencePhoto[]): string {
  if (!findings.length) return "Nothing of concern visible in what was sent.";
  const worst = findings.some((f) => f.severity === "high") ? "high"
    : findings.some((f) => f.severity === "medium") ? "medium" : "low";
  const escalate = findings.some((f) => f.recommend_professional);
  const multi = images.length > 1;
  const items = findings.slice(0, 3).map((f) => {
    const text = f.note || f.issue;
    if (!text) return null;
    const code = multi ? findingLabel(f, images) : "";
    return code ? `${code}: ${text}` : text;
  }).filter(Boolean).join(" ");
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
    const serviceId = String(b.serviceId ?? "");
    const kind = String(b.kind ?? "") as Kind;
    const isService = SERVICE_KINDS.includes(kind);
    const meta = (b.meta ?? {}) as Record<string, unknown>;
    // Which quote's Kickoff Pack this is, for kickoff_pack_ready. A job can
    // carry more than one pack in flight since 1 Sep 2026 (a client can
    // accept more than one quote and compare), so job_id alone no longer
    // says which worker or which pack this notification is about.
    const quoteId = typeof meta.quoteId === "string" && meta.quoteId.trim() ? meta.quoteId.trim() : "";
    if (!secret || !KINDS.includes(kind) || (isService ? !serviceId : !jobId)) {
      return json({ error: "secret, a valid kind, and jobId (or serviceId for a service kind) are required." }, 400);
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

    // A service kind reads services and never touches jobs; job stays null
    // and every job-only path below is either kind-gated or null-guarded.
    // deno-lint-ignore no-explicit-any
    let job: any = null;
    // deno-lint-ignore no-explicit-any
    let svc: any = null;
    if (isService) {
      const { data } = await admin.from("services")
        .select("id, type, parish, price, stage, status, portal_code, client_name, client_email, client_phone, due_at")
        .eq("id", serviceId).maybeSingle();
      if (!data) return json({ error: "No such service booking." }, 404);
      svc = data;
    } else {
      const { data } = await admin.from("jobs")
        .select("id, title, parish, stage, status, portal_code, client_email, client_phone, worker_email")
        .eq("id", jobId).maybeSingle();
      if (!data) return json({ error: "No such job." }, 404);
      job = data;
    }

    const who = isService ? svc : job;
    const clientEmail = String(who.client_email ?? "").trim();
    const clientPhone = String(who.client_phone ?? "").trim();

    // Most kinds tell the client. Two do not: evidence_comment, because a
    // client left it and the worker is who answers; evidence_landed,
    // because 31 Aug 2026 that stopped meaning "tell the client" and
    // started meaning "draft it for the worker first." The client only
    // hears from evidence_report_confirmed now, once the worker has said
    // yes or written their own version. Everything below still reads
    // "client" in its own variable names because that is what it is for
    // every other kind; these two are what the actual send at the bottom
    // uses.
    let recipientEmail = clientEmail;
    let recipientPhone = clientPhone;
    let workerPhone = "";
    // kickoff_pack_ready can fire before booking, while jobs.worker_email is
    // still blank: the worker to notify is whoever is on the quote this
    // pack was drafted against, not (yet) the job's own worker_email.
    let kickoffWorkerEmail = job?.worker_email ?? "";
    if (kind === "kickoff_pack_ready" && quoteId) {
      const { data: q } = await admin.from("job_quotes").select("worker_email").eq("id", quoteId).maybeSingle();
      if (q?.worker_email) kickoffWorkerEmail = q.worker_email;
    }
    if ((kind === "evidence_comment" || kind === "evidence_landed" || kind === "stage_released_worker") && job.worker_email) {
      const { data: worker } = await admin.from("worker_profiles")
        .select("phone").ilike("worker_email", job.worker_email).maybeSingle();
      workerPhone = String(worker?.phone ?? "").trim();
    }
    if (kind === "kickoff_pack_ready" && kickoffWorkerEmail) {
      const { data: worker } = await admin.from("worker_profiles")
        .select("phone").ilike("worker_email", kickoffWorkerEmail).maybeSingle();
      workerPhone = String(worker?.phone ?? "").trim();
    }
    // quote_awaiting_worker_confirm fires the moment a quote is submitted,
    // long before any job.worker_email exists: the worker to tell is
    // whoever wrote this specific quote, the same "read it off the quote,
    // not the job" shape kickoff_pack_ready already needed above.
    let quoteWorkerEmail = "";
    if (kind === "quote_awaiting_worker_confirm" && quoteId) {
      const { data: q } = await admin.from("job_quotes").select("worker_email").eq("id", quoteId).maybeSingle();
      quoteWorkerEmail = q?.worker_email ?? "";
    }
    if (kind === "quote_awaiting_worker_confirm" && quoteWorkerEmail) {
      const { data: worker } = await admin.from("worker_profiles")
        .select("phone").ilike("worker_email", quoteWorkerEmail).maybeSingle();
      workerPhone = String(worker?.phone ?? "").trim();
    }
    if (kind === "evidence_comment" || kind === "evidence_landed" || kind === "kickoff_pack_ready" || kind === "quote_awaiting_worker_confirm" || kind === "stage_released_worker") {
      recipientEmail = "";
      recipientPhone = workerPhone;
    }

    // Post-booking every client has an account (Stage 2's own rule), so the
    // link always goes to the portal room rather than the no-account quotes
    // page: quote_arrived is the one kind that can happen before booking, on
    // a job that may not have a client_email at all yet if it arrived on
    // WhatsApp with only a phone number, so it links by portal_code instead.
    const roomLink = isService
      ? `${APP_URL}/portal/services/${encodeURIComponent(svc.id)}`
      : `${APP_URL}/portal/jobs/${encodeURIComponent(job.id)}`;
    const codeLink = isService
      ? (svc.portal_code
        ? `${APP_URL}/portal/join?code=${encodeURIComponent(svc.portal_code)}`
        : roomLink)
      : (job.portal_code
        ? `${APP_URL}/jobs/${encodeURIComponent(job.id)}/quotes?code=${encodeURIComponent(job.portal_code)}`
        : roomLink);

    let subject = "";
    let line = "";
    let photoUrls: EvidencePhoto[] = [];
    let attachPhotos: string[] = [];
    // Only quote_arrived has an approved WhatsApp Content Template
    // (yaadly_quote_landed_v2); see the header comment for why it is the
    // one kind that may reuse it, and only as a fallback for the specific
    // failure it exists to fix (outside the 24 hour window), never as a
    // substitute for the richer free-text message when that can still be
    // delivered: see the send site below.
    let waTemplate: { sid: string; vars: Record<string, string> } | undefined;
    // A SECOND, different thing from waTemplate, and the difference is the
    // whole design. waTemplate is a FALLBACK: it replaces a message that could
    // not be delivered. approveButton is an ADDITION: it follows a message
    // that was delivered, carrying the one thing free text cannot, a button.
    let approveButton: { sid: string; vars: Record<string, string> } | undefined;

    if (kind === "service_booked") {
      // Fires the moment an enquiry is converted in the desk. A receipt with
      // expectations set honestly: held means held, nothing is charged, and
      // the founder's confirm is the next thing that happens. The portal
      // code rides in this first message because a service client has no
      // account yet; the join page is the door and the code is the key.
      subject = `We have your booking: ${svc.type}`;
      line = `Your ${svc.type} booking with Yaadly is in, reference ${svc.id}. ` +
        `It is held while Yaadly agrees the scope and dates with you: nothing is charged and nothing starts until you hear from us that it is confirmed. ` +
        `When you want to see it online, set up your portal with the code ${svc.portal_code}: ${codeLink}`;
    } else if (kind === "service_confirmed") {
      // Fires when the founder clicks "Confirm the work": the booking is now
      // real, the invoice exists, and payment is the one thing between here
      // and the work starting. The date is only named when one was promised.
      const dueLine = svc.due_at ? ` Delivery is planned for ${svc.due_at}.` : "";
      subject = `Confirmed: ${svc.type}`;
      line = `Your booking ${svc.id} (${svc.type}) is confirmed at ${svc.price ?? "the agreed price"}. ` +
        `The invoice is on its way to you by email, and the work is scheduled once it is paid.${dueLine} ` +
        `Track everything here: ${roomLink}`;
    } else if (kind === "service_live") {
      // Fires from the invoice being marked paid by a named admin: the same
      // click that moves the booking moves this message, so a client is
      // never told "under way" by anything other than the payment gate.
      const dueLine = svc.due_at ? ` Delivery is planned for ${svc.due_at}.` : "";
      subject = `Under way: ${svc.type}`;
      line = `Payment received on ${svc.id}, thank you. Your ${svc.type} is now under way.${dueLine} ` +
        `Progress and everything we deliver lands in your portal: ${roomLink}`;
    } else if (kind === "quote_arrived") {
      const { data: q } = await admin.from("job_quotes")
        .select("worker_name, labour_jmd, materials_jmd, note")
        .eq("job_id", jobId).eq("status", "submitted")
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      const total = (q?.labour_jmd ?? 0) + (q?.materials_jmd ?? 0);
      const workerName = q?.worker_name ?? "A tradesperson";
      const priceText = money(total);
      subject = `A price on your job: ${job.title}`;
      // Stage 6, continued: a client with a phone on file can book straight
      // from this message rather than needing to open the link at all. The
      // founder's own decision, 31 Aug 2026: replying with the code is
      // what stands in for the portal's own scope tick, so what the
      // worker actually proposed to do has to be in this message in
      // words, not only the price, before that reply is ever asked for.
      // The link stays too, both because it is the fallback when more
      // than one price is open at once, and because it remains the
      // system of record.
      const proposal = String(q?.note ?? "").trim();
      const scopeLine = proposal ? ` They propose: "${proposal.slice(0, 300)}"` : "";
      // 2 Sep 2026, founder's own correction: this used to say "reply to
      // confirm" with no word on what happens after, so confirming read as
      // the whole action. Two replies actually do two different things
      // here: first confirms the price, a second, later one books it, only
      // once ${workerName} has confirmed too. Both steps named up front so
      // neither reply is a guess. Replying used to try to book the worker
      // directly on the first message; it now confirms the quote itself,
      // the client's own half of a mutual agreement with the worker,
      // nobody is booked until both sides have confirmed.
      const bookHint = clientPhone
        ? `Reply ${job.id} to confirm you're happy with this price. Once ${workerName} confirms it too, reply ${job.id} once more to book them. Or `
        : "";
      line = `A price has come in on your Yaadly job, ${job.title}. ` +
        `${workerName} quoted ${priceText}, labour and materials itemised separately.${scopeLine} ` +
        `Nothing is booked and nothing is charged until you choose. ${bookHint}see it here: ${codeLink}`;
      const contentSid = Deno.env.get("TWILIO_CONTENT_SID_QUOTE") ?? "";
      if (contentSid) {
        waTemplate = {
          sid: contentSid,
          vars: { "1": String(job.title ?? "your job"), "2": String(workerName), "3": priceText, "4": codeLink },
        };
      }
    } else if (kind === "quote_accepted") {
      // Fired once, from the jobs row itself (notify_client_on_job_change,
      // 20260831zzzz), the moment worker_email is first set, whichever of
      // the two doors set it: a portal tap or a WhatsApp reply. Payment is
      // relayed here, not collected. Comment corrected 3 Sep 2026: it used to
      // say "Yaadly is not holding money yet (CLAUDE.md 9)", which stopped
      // being true when payment came off that section's not-built list the
      // same day. The client buys the job from Yaadly and Yaadly engages and
      // pays the worker, so the wording below states the principal structure
      // and matches the worker FAQ rather than inventing new payment
      // language.
      const { data: q } = await admin.from("job_quotes")
        .select("worker_name, labour_jmd, materials_jmd")
        .eq("job_id", jobId).eq("status", "accepted")
        .order("updated_at", { ascending: false }).limit(1).maybeSingle();
      subject = `Booked: ${job.title}`;
      // 2 Sep 2026, alongside the payment gate: booking no longer means
      // work can start. It waits on Yaadly's own Guarantee & Support fee
      // invoice, sent separately, marked paid by a person before anything
      // moves. Saying "the worker is on site" here would be wrong now.
      line = `${q?.worker_name ?? "Your worker"} is booked on ${job.id} (${job.title}). ` +
        `Labour ${money(q?.labour_jmd ?? 0)}, materials ${money(q?.materials_jmd ?? 0)} paid at cost against the receipt. ` +
        `You pay Yaadly, not the worker: Yaadly engages and pays them. ` +
        `Your invoice for the job is on its way separately, one price covering the work, materials at cost and Yaadly's Guarantee & Support fee. ` +
        `The job goes live once that is paid. Yaadly pays the worker under our own agreement with him, so he never waits on you. Your approval is what closes each stage with us, once you have seen the evidence. ${roomLink}`;
    } else if (kind === "quote_awaiting_worker_confirm") {
      // Fires once, the moment the worker's own quote lands (job_quotes
      // AFTER INSERT WHEN status = 'submitted'). Writing the quote is not
      // the same as confirming it: the client confirms too, and only once
      // both sides have replied does it become bookable. Free text only,
      // this kind has no approved template and job.id doubles as the code
      // to reply with, the same shape every other WhatsApp-reply kind uses.
      subject = `Confirm your price: ${job.title}`;
      line = `Your price on ${job.id} (${job.title}) is in. ` +
        `Reply with the code ${job.id} to confirm it. ` +
        `The client is being asked to confirm the same price; once you have both replied, ` +
        `they can book you straight away, or ask for a fuller Kickoff Pack first if they want one.`;
    } else if (kind === "stage_released_worker") {
      // Founder's own correction, 2 Sep 2026: stage_released only ever told
      // the client. Nothing told the worker their own work had been
      // approved, or that they were owed anything. This fires once, on the
      // transition into 'complete' (not on every stage: RUNBOOK already
      // documents no partial release, the whole figure moves at once at
      // completion), the same moment raise_job_worker_pay_invoice() becomes
      // raisable. Deliberately does not name a figure: the worker's own
      // pay is labour_jmd * 0.88 plus materials, and stating it here risks
      // drifting from whatever the money page actually shows if either
      // changes independently.
      subject = `${job.title} is signed off`;
      line = `${job.title} (${job.id}) is signed off, every stage approved. ` +
        `You're owed your labour and materials for it, paid directly by the client, off-platform, the way you already agreed with them. ` +
        `Check your own figure any time in your Yaadly portal.`;
    } else if (kind === "evidence_landed") {
      // Founder's own requirement, 31 Aug 2026, and a real change from how
      // this kind worked that same morning: the AI's composed report does
      // not go straight to the client any more. It goes to the worker
      // first, honestly labelled as a draft, with a plain choice: send it
      // as written, or write their own version instead. Confirmed hers to
      // ask, and the worker's to decide, not the founder's: she is not the
      // one who did the work, and a bottleneck through her was never the
      // point.
      photoUrls = await evidencePhotoUrls(admin, jobId, job.stage ?? 1, trace);

      const [composed, findings] = workerPhone
        ? await Promise.all([
            composeEvidenceReport(admin, jobId, job.title, job.stage ?? 1, trace),
            photoUrls.length ? reviewEvidencePhotos(photoUrls, job.title, trace) : Promise.resolve(null),
          ])
        : [null, null];
      const evLandedLabel = await stageLabel(admin, jobId, job.stage ?? 1);
      const draftText = composed?.message
        || `Photos have come in for ${evLandedLabel}, with no description from you yet.`;
      const aiSummary = findings ? summariseFindings(findings, photoUrls) : "";
      // Named once here, on more than one photo, so a reply naming a code
      // means something without repeating "Items: ..." on every line below.
      const itemsLine = photoUrls.length > 1
        ? `Items: ${photoUrls.map((p) => p.code ?? "?").join(", ")}`
        : null;

      // The report's own "Next:" line finally does something, rather than
      // sitting as narrative nobody acts on. A real next step named (not
      // "nothing further", not blank) gets a follow-up flagged: if nothing
      // has moved on this stage by the due date, the cron re-runs this
      // exact draft/relay loop rather than a second, invented pattern.
      const nextStep = composed?.nextStep?.trim() ?? "";
      if (nextStep && !/^nothing/i.test(nextStep)) {
        await admin.rpc("create_job_followup", { p_job: jobId, p_stage: job.stage ?? 1, p_reason: nextStep });
      }

      if (workerPhone) {
        await admin.from("wa_intake_sessions").upsert({
          wa_id: workerPhone.startsWith("+") ? workerPhone : `+${workerPhone.replace(/\D/g, "")}`,
          answers: {
            _lane: "report_confirm", job_id: jobId, stage: job.stage ?? 1,
            draft_text: draftText, ai_summary: aiSummary,
          },
          photo_count: 0,
          updated_at: new Date().toISOString(),
        });
      }

      subject = `Draft for the client: ${job.title}`;
      line = [
        `Here's what we'd tell the client about ${evLandedLabel} of ${job.title}:`,
        `"${draftText}"`,
        aiSummary ? `AI noticed: ${aiSummary}` : null,
        itemsLine,
        `Reply 1 to send this as written, or reply with your own version and we'll send that instead.`,
      ].filter(Boolean).join("\n\n");
      root.setAttributes({
        "yaadly.notify.evidence_report_composed": !!composed,
        "yaadly.notify.ai_review_ran": findings !== null,
        "yaadly.notify.ai_finding_count": findings?.length ?? 0,
        "yaadly.notify.draft_sent_to_worker": !!workerPhone,
      });
    } else if (kind === "evidence_report_confirmed") {
      // The other half of evidence_landed's new shape: fired only once the
      // worker has actually said yes or written their own version, never
      // automatically. override_text is always the FINAL wording by the
      // time this runs; yaad-inbound already resolved "1" into the stored
      // draft before calling relay_confirmed_report(), so this kind never
      // has to know which one happened.
      const overrideText = String(meta.override_text ?? "").trim();
      const aiSummary = String(meta.ai_summary ?? "").trim();
      subject = `Evidence to review: ${job.title}`;
      photoUrls = await evidencePhotoUrls(admin, jobId, job.stage ?? 1, trace);
      attachPhotos = photoUrls.map((p) => p.url);

      const reportLabel = await stageLabel(admin, jobId, job.stage ?? 1);
      const workerSays = overrideText || `Photos have come in for ${reportLabel} of your job, ${job.title}.`;
      const aiSays = aiSummary ? `AI noticed: ${aiSummary}` : null;
      const itemsLine = photoUrls.length > 1
        ? `Items: ${photoUrls.map((p) => p.code ?? "?").join(", ")}. Mention a code if your comment is about one specific photo.`
        : null;
      const actionHint = clientPhone
        ? `Reply with the code ${job.id} to approve, or just say what you think and we will pass it to the worker.`
        : "Review it and reply from your portal.";
      line = [workerSays, aiSays, itemsLine, `${actionHint} ${roomLink}`].filter(Boolean).join("\n\n");

      // ── the approve button, 4 September 2026 ──────────────────────────
      //
      // This is the one message in the system that asks a client to approve,
      // and approving means typing JOB-WA-1757000000000 correctly on a phone
      // to move money. A Quick Reply button makes it one tap.
      //
      // IT IS SENT AFTER THE FREE TEXT, NOT INSTEAD OF IT, and that is the
      // point. The free text here carries the worker's own words about what
      // was done, the AI's notes, the item codes and the photographs
      // themselves. A template's fixed variable slots hold none of that, and
      // this file's own header records why sending a template in place of a
      // richer message is the wrong trade. So the report goes as it always
      // has, and the button follows it.
      //
      // The payload is the bare job code, because yaad-inbound reads a tapped
      // payload as the message text and hands it to the same
      // matchApprovingJob() and the same RPC a typed code goes through. The
      // button is a way of typing, not a new authority.
      //
      // Unset secret means no second message and nothing changes.
      const approveSid = Deno.env.get("TWILIO_CONTENT_SID_APPROVE") ?? "";
      if (approveSid && clientPhone) {
        approveButton = { sid: approveSid, vars: { "1": String(job.title ?? "your job"), "2": String(job.id) } };
      }
      root.setAttributes({ "yaadly.notify.photos_attached": photoUrls.length, "yaadly.notify.was_customised": !!overrideText });
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

      // Stage 7. Convert at handover, the founder's own words: offered at
      // the moment the client approves and feels relief, at the founding
      // rate, never by email later. Only on the job's FINAL stage
      // (sync_job_status marks the job complete once stage reaches 5), not
      // on every approval along the way: pitching this mid-job would read
      // as premature on a job that is not actually finished yet. No
      // billing exists to switch on here (Phase 1, sell judgment, CLAUDE.md
      // 9), so this captures a reply for the founder to follow up with
      // personally, it does not pretend to start anything on its own.
      if (job.status === "complete" && job.worker_email) {
        const { data: worker } = await admin.from("worker_profiles")
          .select("name").ilike("worker_email", job.worker_email).maybeSingle();
        const workerName = String(worker?.name ?? "").trim() || "the same worker";
        line += `\n\nOne more thing, now that this is off your list. Want ${workerName} to keep an eye on the place going forward, without you having to ask again? ` +
          `It's called the Yaad Report: a monthly WhatsApp update, 6 to 10 timestamped photos, a short walkthrough video, three lines on the property's condition, and what's changed since last time. ` +
          `Founding rate is £350 a month, or one 12 month term instead of twelve separate decisions.\n\n` +
          `Reply INTERESTED and Yaadly will follow up with how it works.`;
      }
    } else if (kind === "worker_on_site") {
      const { data: arrival } = await admin.from("arrival_log")
        .select("stage, arrived_at")
        .eq("job_id", jobId).order("arrived_at", { ascending: false }).limit(1).maybeSingle();
      subject = `On site today: ${job.title}`;
      const arrivalLabel = await stageLabel(admin, jobId, arrival?.stage ?? job.stage ?? 1);
      line = `Your worker checked in on site today for ${arrivalLabel} of ${job.title}. ` +
        `Follow along here: ${roomLink}`;
    } else if (kind === "walkthrough_notes_ready") {
      subject = `Notes from your video walkthrough: ${job.title}`;
      line = `The worker has written up what came out of your video walkthrough on ${job.title}. ` +
        `Read them and confirm they are accurate here: ${roomLink}`;
    } else if (kind === "evidence_comment") {
      // The one kind in this file that tells the worker, not the client.
      // Founder's own requirement, 31 Aug 2026: a client should be able to
      // say more than yes or no on a photo, and it should reach the worker
      // wherever they actually are. Both routes back are named honestly:
      // a WhatsApp reply here is captured the same as a fresh evidence
      // photo would be, matched to this job and logged; the portal's own
      // Job chat is logged the moment it lands, always.
      const { data: c } = await admin.from("evidence_comments")
        .select("body").eq("id", String(meta.comment_id ?? "")).maybeSingle();
      subject = `A note from the client: ${job.title}`;
      line = `On ${job.title}, the client wrote: "${(c?.body ?? "").slice(0, 300)}"\n\n` +
        `Reply here on WhatsApp to answer, or open the job to reply there, either way the client sees it and it stays on the record: ${roomLink}`;
    } else if (kind === "job_delayed") {
      // Told honestly and early, before the client has to ask. Says nothing
      // about why: yaad-job-health knows a job has gone quiet, not the
      // reason, and guessing at one here would be exactly the kind of
      // invented detail this repository's own agents are built to refuse.
      subject = `A delay on your job: ${job.title}`;
      line = `There has been no update on ${job.title} for a few days, so we wanted you to hear it from us rather than notice the silence yourself. ` +
        `We are checking in with the worker directly. Nothing is wrong with the money held on this job, and you can raise anything here: ${roomLink}`;
    } else if (kind === "kickoff_pack_ready") {
      // The worker READS the Kickoff Pack via the link, the same page the
      // client already reads (parties_read_approved_packs covers both).
      // CONFIRMING it is a WhatsApp reply, not a portal button: the
      // worker's web surface is thin on purpose (CLAUDE.md §9: onboarding
      // and file upload, nothing else), and a portal "Confirm as the
      // worker" button was exactly the surface that principle rules out -
      // built that way for a few hours the same night before the founder
      // caught it live, fixed in agree_kickoff_pack_via_whatsapp()
      // (20260901i). The code in the link is this exact revision's; if the
      // pack changes before it is opened, agree_kickoff_pack() and its
      // WhatsApp door both refuse a stale code or a stale reply rather
      // than silently confirming new content under an old one.
      // Scoped to the specific quote this pack was drafted against where
      // known, so two packs in flight on the same job can never cross:
      // the worker in this message must be the one who is actually being
      // linked to their own pack, not whichever pack updated most recently.
      const packQuery = admin.from("kickoff_packs").select("id, rev, confirm_code").eq("status", "approved");
      const { data: pack } = await (quoteId ? packQuery.eq("quote_id", quoteId) : packQuery.eq("job_id", jobId))
        .order("updated_at", { ascending: false }).limit(1).maybeSingle();
      const packLink = pack?.confirm_code
        ? `${APP_URL}/portal/jobs/${encodeURIComponent(jobId)}/pack?code=${encodeURIComponent(pack.confirm_code)}`
        : roomLink;
      subject = `Your Kickoff Pack is ready: ${job.title}`;
      line = `The Kickoff Pack for ${job.title} is ready: scope, timeline, payment stages and the evidence checklist, all in one place. ` +
        `Read it here: ${packLink}\n\nWhen you're ready to confirm your side, just reply to this message with ${jobId}.`;
    }

    let emailed = false;
    let emailReason = RESEND_KEY ? "" : "RESEND_API_KEY not set";
    if (recipientEmail && RESEND_KEY) {
      await trace.span("resend.send", SpanKind.CLIENT, { "server.address": "api.resend.com", "messaging.system": "resend" }, async (s) => {
        try {
          const r = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              from: `Yaadly <${FROM_EMAIL}>`, to: [recipientEmail], reply_to: REPLY_TO,
              subject, text: line, html: `<p>${line.replace(codeLink, `<a href="${codeLink}">${codeLink}</a>`).replace(roomLink, `<a href="${roomLink}">${roomLink}</a>`)}</p>`,
            }),
            signal: AbortSignal.timeout(15000),
          });
          s.setAttributes({ "http.response.status_code": r.status });
          emailed = r.ok;
          if (!r.ok) { emailReason = `resend ${r.status}`; s.recordError(`${emailReason}: ${(await r.text()).slice(0, 160)}`); }
        } catch (e) { emailReason = String(e).slice(0, 160); s.recordError(emailReason); }
      });
    } else if (!recipientEmail) {
      emailReason = "no recipient email on the job";
    }

    let wa: { sent: boolean; reason?: string; via?: string } = { sent: false, reason: "no recipient phone on the job" };
    if (recipientPhone) {
      // Photos ride only on the WhatsApp attempt. A fallback to Meta or SMS
      // means the WhatsApp send itself failed, and a signed URL that was
      // good for five minutes has likely aged past useful by the time a
      // second attempt runs; the text and the portal link still carry the
      // fact either way.
      wa = await sendTwilio(recipientPhone, line, "whatsapp", trace, attachPhotos);
      // The rich, scope-carrying message could not be delivered at all,
      // specifically because it landed outside WhatsApp's 24 hour window:
      // the approved template is the fallback for exactly that failure,
      // a plainer message that actually arrives beats a richer one that
      // silently does not. Not attempted for any other failure reason,
      // and never in place of the free-text attempt when that can still
      // be sent.
      if (!wa.sent && waTemplate && wa.reason === "outside WhatsApp's 24 hour window, needed an approved template") {
        wa = await sendTwilio(recipientPhone, "", "whatsapp", trace, [], waTemplate);
      }
      if (!wa.sent) {
        const metaResult = await sendMetaWhatsApp(recipientPhone, line, trace);
        if (metaResult.sent) wa = { ...metaResult, via: "meta whatsapp" };
        else {
          const sms = await sendTwilio(recipientPhone, line, "sms", trace);
          if (sms.sent) wa = { ...sms, via: "twilio sms" };
        }
      }

      // The button, once the report itself has landed on WhatsApp. Only on
      // WhatsApp, because a button is a WhatsApp thing and an SMS fallback
      // would just be a second copy of nothing. Only after a successful send,
      // because a lone "Approve" button arriving with no report in front of it
      // asks somebody to approve work they have not been shown.
      //
      // Its failure is recorded and never propagated: the client already has
      // the report and the typed code still works, so a missing button is a
      // worse experience and not a lost message.
      if (approveButton && wa.sent && wa.via === "twilio whatsapp") {
        const btn = await sendTwilio(recipientPhone, "", "whatsapp", trace, [], approveButton);
        root.setAttributes({ "yaadly.notify.approve_button": btn.sent });
        if (!btn.sent) console.error(`approve button not sent for ${jobId}: ${btn.reason ?? "unknown"}`);
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
