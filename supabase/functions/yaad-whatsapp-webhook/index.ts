import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { Trace, SpanKind, httpAttrs } from "./otel.ts";

// Yaadly WhatsApp inbound webhook.
// Meta calls this directly (Cloud API), no BSP in the middle.
// GET  = Meta's one-time webhook verification handshake.
// POST = an inbound message, or a delivery/read status update we can ignore.
//
// Auth model: this endpoint cannot require a Supabase admin JWT, nothing is
// signed in as anyone when Meta calls it. Instead it verifies Meta's own
// X-Hub-Signature-256 header (HMAC-SHA256 of the raw body using the Meta App
// Secret). If WHATSAPP_APP_SECRET is not set yet (pre-launch, no Meta app
// configured), signature checking is skipped and the request is logged as
// unverified rather than rejected, so this can be built and tested before
// the phone number exists. Once WHATSAPP_APP_SECRET is set, verification is
// enforced and unsigned requests are rejected with 403.
// CORS is left open so this can also be smoke-tested from a browser console
// during build. Meta's own servers do not send an Origin header and do not
// care about CORS, so this is safe either way.
//
// Portal access: creating a job here does NOT hand the client an open portal
// account. The jobs.portal_code column is generated automatically by the
// database the moment this insert lands, and that code, together with the
// client's email, is required by verify_portal_code() before the client
// portal will let anyone sign up. A WhatsApp message that never turns into
// a real job never gets a code, so it can never be used to self-serve an
// account, matching how the admin desk works.
//
// Tracing: every stage of the pipeline below (signature check, model call,
// database insert, outbound reply) is a child span of the request span, so a
// single inbound WhatsApp message can be read end to end as one trace.

const MODEL = "MiniMax-M2.7";
const MINIMAX_API = "https://api.minimax.io/v1/chat/completions";
const CLIENT_PORTAL_URL = "https://yaadly.co.uk/#client";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };

const INTAKE_PROMPT = `You are the Intake Agent for Yaadly, a trust-first property works service in Jamaica (Kingston metro first: Kingston and Portmore). You read a raw WhatsApp message about a property job (English or Jamaican Patois) and produce a structured job card.
Return STRICT JSON only, no markdown fences, exactly this shape:
{"title":"short job title naming the issue","client_name":"client's name if stated","client_email":"email address if stated, otherwise empty string","trade":"main trade needed","parish":"place if stated","urgency":"their words for timing","preferred_date":"any specific date or time they want the work done, as stated","scope":"clear plain-English scope of works, 2-4 sentences","questions":["up to 3 questions Yaadly should ask before quoting"]}
Rules: never invent facts, if a field is not in the message use empty string. Do not estimate any price. Keep the client's meaning, not their exact slang.`;

async function verifySignature(req: Request, rawBody: string): Promise<{ ok: boolean; checked: boolean }> {
  const secret = Deno.env.get("WHATSAPP_APP_SECRET");
  if (!secret) return { ok: true, checked: false };
  const sigHeader = req.headers.get("x-hub-signature-256") || "";
  const expectedHex = sigHeader.replace(/^sha256=/, "");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sigBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const gotHex = Array.from(new Uint8Array(sigBuf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return { ok: gotHex === expectedHex, checked: true };
}

async function structureJob(text: string, trace: Trace): Promise<any> {
  const key = Deno.env.get("MINIMAX_API_KEY");
  if (!key) return null;
  return await trace.span(`chat ${MODEL}`, SpanKind.CLIENT, {
    "gen_ai.system": "minimax",
    "gen_ai.operation.name": "chat",
    "gen_ai.request.model": MODEL,
    "gen_ai.request.temperature": 0.2,
    "server.address": "api.minimax.io",
    "yaadly.agent.name": "intake",
    "yaadly.input.chars": String(text || "").length,
  }, async (s) => {
    const r = await fetch(MINIMAX_API, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: INTAKE_PROMPT },
          { role: "user", content: String(text || "").slice(0, 6000) }
        ],
        temperature: 0.2
      })
    });
    const j = await r.json();
    s.setAttributes({
      "http.response.status_code": r.status,
      "gen_ai.response.model": j?.model,
      "gen_ai.response.finish_reasons": j?.choices?.[0]?.finish_reason,
      "gen_ai.usage.input_tokens": j?.usage?.prompt_tokens,
      "gen_ai.usage.output_tokens": j?.usage?.completion_tokens,
    });
    if (!r.ok) s.recordError(`minimax http ${r.status}`);
    const out = j?.choices?.[0]?.message?.content ?? "";
    try {
      const match = out.match(/\{[\s\S]*\}/);
      const parsed = match ? JSON.parse(match[0]) : null;
      s.setAttributes({ "yaadly.intake.parsed": Boolean(parsed) });
      return parsed;
    } catch (_) {
      s.setAttributes({ "yaadly.intake.parsed": false });
      return null;
    }
  });
}

async function maybeSendReply(toWaId: string, body: string, trace: Trace) {
  const token = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
  const phoneId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
  if (!token || !phoneId) return { sent: false, reason: "WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID not set yet" };
  return await trace.span("whatsapp.send_reply", SpanKind.CLIENT, {
    "server.address": "graph.facebook.com",
    "messaging.system": "whatsapp",
    "messaging.operation.name": "send",
  }, async (s) => {
    try {
      const r = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ messaging_product: "whatsapp", to: toWaId, type: "text", text: { body } })
      });
      s.setAttributes({ "http.response.status_code": r.status });
      if (!r.ok) s.recordError(`whatsapp http ${r.status}`);
      return { sent: r.ok, status: r.status };
    } catch (e) {
      s.recordError(e);
      return { sent: false, reason: String(e) };
    }
  });
}


// A voice note is the most common way a real job arrives. Somebody standing
// in front of the damage describes it far better than they will type it.
// Until this existed those messages landed as "review manually" and waited
// for a person, which is the manual work this whole pipeline is meant to end.
//
// If transcription fails the message still becomes a job, carrying a note
// that says a human needs to listen. Losing the job would be worse than
// transcribing it badly.
async function transcribe(mediaId: string, trace: Trace): Promise<string> {
  try {
    return await trace.span("transcribe voice note", SpanKind.CLIENT, {
      "yaadly.media.id": mediaId,
    }, async (sp) => {
      const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/yaad-transcribe`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
        body: JSON.stringify({ mediaId }),
        signal: AbortSignal.timeout(70000),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) { sp.recordError(j?.error ?? `transcribe http ${r.status}`); return ""; }
      sp.setAttributes({ "yaadly.transcribe.chars": String(j.text ?? "").length });
      return String(j.text ?? "");
    });
  } catch (_) { return ""; }
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);

  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const trace = new Trace("yaad-whatsapp-webhook", req);
  const root = trace.startSpan(`${req.method} /yaad-whatsapp-webhook`, SpanKind.SERVER, httpAttrs(req));
  const done = (res: Response, status: number) => {
    root.setAttributes({ "http.response.status_code": status });
    root.end();
    trace.flush();
    return res;
  };

  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    const expected = Deno.env.get("WHATSAPP_VERIFY_TOKEN");
    root.setAttributes({ "yaadly.webhook.phase": "meta_verification" });
    if (mode === "subscribe" && expected && token === expected) {
      root.setAttributes({ "yaadly.webhook.verification": "passed" });
      return done(new Response(challenge ?? "", { status: 200, headers: CORS }), 200);
    }
    root.setAttributes({ "yaadly.webhook.verification": "failed" });
    return done(new Response("Verification failed", { status: 403, headers: CORS }), 403);
  }

  if (req.method !== "POST") {
    return done(new Response("Method not allowed", { status: 405, headers: CORS }), 405);
  }

  const rawBody = await req.text();
  const sig = await trace.span("webhook.verify_signature", SpanKind.INTERNAL, {}, async (s) => {
    const r = await verifySignature(req, rawBody);
    s.setAttributes({ "yaadly.signature.checked": r.checked, "yaadly.signature.valid": r.ok });
    return r;
  });
  root.setAttributes({ "yaadly.signature.checked": sig.checked, "yaadly.signature.valid": sig.ok });

  if (sig.checked && !sig.ok) {
    return done(new Response(JSON.stringify({ error: "Invalid signature" }), { status: 403, headers: { ...CORS, "Content-Type": "application/json" } }), 403);
  }

  let payload: any = {};
  try { payload = JSON.parse(rawBody); } catch (_) { payload = {}; }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const value = payload?.entry?.[0]?.changes?.[0]?.value;
    const message = value?.messages?.[0];
    const contact = value?.contacts?.[0];

    if (!message) {
      root.setAttributes({ "yaadly.webhook.outcome": "no_message" });
      return done(new Response(JSON.stringify({ ok: true, note: "No message in payload, nothing to do", signatureVerified: sig.checked }), { status: 200, headers: { ...CORS, "Content-Type": "application/json" } }), 200);
    }

    const fromWaId: string = message.from ?? "";
    const contactName: string = contact?.profile?.name ?? "";
    // Voice first: it is how most of these actually arrive.
    let text: string = message.text?.body ?? "";
    let spoken = false;
    if (!text && (message.type === "audio" || message.type === "voice")) {
      const mediaId = message.audio?.id ?? message.voice?.id ?? "";
      if (mediaId) {
        const said = await transcribe(mediaId, trace);
        if (said) { text = said; spoken = true; }
      }
      if (!text) text = "[voice note received, could not be transcribed, listen to it]";
    }
    if (!text && message.type && message.type !== "text") {
      text = `[${message.type} message, no text, review manually]`;
    }
    root.setAttributes({ "yaadly.message.type": message.type ?? "text", "yaadly.message.chars": text.length, "yaadly.message.spoken": spoken });

    const card = await structureJob(text, trace);

    const jobId = `JOB-WA-${Date.now()}`;
    const title = card?.title || (contactName ? `WhatsApp job from ${contactName}` : "WhatsApp job, needs review");
    const noEmailNote = card?.client_email ? "" : "\n\n[NO EMAIL, client came in via WhatsApp. Reply on WhatsApp to get their email so they can see this in the client portal.]";
    const descr = [card?.scope || text, card?.urgency ? `Urgency: ${card.urgency}` : "", card?.preferred_date ? `Wanted by: ${card.preferred_date}` : "", card?.trade ? `Trade: ${card.trade}` : "", `Raw message: ${text}`,
      spoken ? "Source: voice note, transcribed automatically. The wording is the client's own." : ""].filter(Boolean).join("\n") + noEmailNote;

    const { inserted, insertError } = await trace.span("db.insert jobs", SpanKind.CLIENT, {
      "db.system.name": "postgresql",
      "db.operation.name": "INSERT",
      "db.collection.name": "jobs",
      "yaadly.job.id": jobId,
      "yaadly.job.source": "whatsapp",
    }, async (s) => {
      const { data, error } = await supabase.from("jobs").insert({
        id: jobId,
        title,
        parish: card?.parish || "",
        client_name: card?.client_name || contactName || "",
        client_email: card?.client_email || "",
        client_phone: fromWaId,
        descr,
        stage: 0,
        open: false
      }).select("portal_code").single();
      if (error) s.recordError(error.message);
      s.setAttributes({ "yaadly.job.portal_code_issued": Boolean(data?.portal_code) });
      return { inserted: data, insertError: error };
    });

    const portalCode = inserted?.portal_code || null;

    let replyResult = null;
    if (fromWaId) {
      const replyBody = card?.client_email
        ? `Thanks, Yaadly got your message. Track this job at ${CLIENT_PORTAL_URL}. First time there? Sign up with ${card.client_email} and job code ${portalCode || "(ask us if it is missing)"}. A project manager will follow up shortly.`
        : `Thanks, Yaadly got your message. Reply with your email so you can track this job at ${CLIENT_PORTAL_URL} (your job code to sign up is ${portalCode || "on its way"}). A project manager will follow up shortly either way.`;
      replyResult = await maybeSendReply(fromWaId, replyBody, trace);
    }

    root.setAttributes({ "yaadly.webhook.outcome": insertError ? "job_insert_failed" : "job_created" });

    return done(new Response(JSON.stringify({
      ok: true,
      jobId,
      portalCode,
      signatureVerified: sig.checked,
      dbInsertError: insertError ? insertError.message : null,
      extractedCard: card,
      replyResult
    }), { status: 200, headers: { ...CORS, "Content-Type": "application/json" } }), 200);
  } catch (e) {
    root.recordError(e);
    root.setAttributes({ "yaadly.webhook.outcome": "error" });
    return done(new Response(JSON.stringify({ ok: false, error: String(e), signatureVerified: sig.checked }), { status: 200, headers: { ...CORS, "Content-Type": "application/json" } }), 200);
  }
});
