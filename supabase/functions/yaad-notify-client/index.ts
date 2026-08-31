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

async function sendTwilio(to: string, body: string, channel: "whatsapp" | "sms", trace: Trace) {
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
      const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: "POST",
        headers: { Authorization: "Basic " + btoa(`${sid}:${tok}`), "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ To: dest, From: from, Body: body }),
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
      const composed = await composeEvidenceReport(admin, jobId, job.title, job.stage ?? 1, trace);
      // The reply-to-approve route only exists for whoever reads it here.
      // Reply with the job's own code, same word for word as the code a
      // worker sends back to confirm a photo, matched against
      // approve_stage_via_whatsapp() in yaad-inbound.
      const approveHint = clientPhone
        ? `Reply with the code ${job.id} here on WhatsApp to approve it, or open the link to look first: `
        : "Review it here: ";
      line = composed
        ? `${composed}\n\n${approveHint}${roomLink}`
        : `Photos have come in for stage ${job.stage ?? 1} of your job, ${job.title}. ` +
          `Nobody is paid until you approve them. ${approveHint}${roomLink}`;
      root.setAttributes({ "yaadly.notify.evidence_report_composed": !!composed });
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
      wa = await sendTwilio(clientPhone, line, "whatsapp", trace);
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
