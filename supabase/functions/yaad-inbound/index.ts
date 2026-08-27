import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { Trace, SpanKind, httpAttrs } from "./otel.ts";

// Inbound intake, on whatever channel is actually available.
//
// The build sheet settled this before Meta answered: "Email + SMS. No
// approval from anybody. Zero blockers. Build against this." And, plainly:
// "Do not put a Meta approval on the critical path of a September launch."
//
// Meta declined. Because intake was built as channels rather than as
// WhatsApp, that costs nothing. This endpoint takes a message from any of
// them, normalises it, and runs the same pipeline the WhatsApp webhook runs:
// transcribe a voice note if there is one, read it with the intake agent,
// write a job that is a draft until somebody signs.
//
// Supported today, no gatekeeper:
//   Twilio SMS/MMS      form-encoded, From / Body / MediaUrl0
//   Vonage SMS          JSON, msisdn / text
//   Email               JSON, from / subject / text, from any forwarder
//   Generic             JSON, from / text / mediaUrl
//
// WhatsApp keeps its own webhook because Meta's signature check and payload
// shape are its own problem. When it is approved it becomes one more row in
// the channel column, not a rebuild.
//
// The thread is the record. Delivery is just a channel.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const s = (v: unknown) => String(v ?? "").trim();
/** "Sonia Campbell <sonia@x.com>" is a From header, not an address. */
const bareEmail = (v: string) => (v.match(/<([^>]+)>/)?.[1] ?? v).trim();
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

type Inbound = { channel: string; from: string; name: string; text: string; media: string[]; resendId?: string; subject?: string };

async function parseInbound(req: Request, raw: string): Promise<Inbound> {
  const ct = (req.headers.get("content-type") ?? "").toLowerCase();

  // Twilio posts form-encoded. It is the one that needs no approval and can
  // reach a Jamaican number today, so it is handled first.
  if (ct.includes("application/x-www-form-urlencoded")) {
    const f = new URLSearchParams(raw);
    const media: string[] = [];
    const n = Number(f.get("NumMedia") ?? "0");
    for (let i = 0; i < n; i++) {
      const u = f.get(`MediaUrl${i}`);
      if (u) media.push(u);
    }
    return {
      channel: "sms",
      from: s(f.get("From")),
      name: s(f.get("ProfileName")),
      text: s(f.get("Body")),
      media,
    };
  }

  let j: Record<string, unknown> = {};
  try { j = JSON.parse(raw); } catch (_) { /* fall through to empty */ }

  // Vonage
  if (j.msisdn || j.messageId) {
    return { channel: "sms", from: s(j.msisdn), name: "", text: s(j.text), media: [] };
  }

  // Resend, which is already the sending side, so inbound needs no new
  // vendor. Recognised by its event envelope rather than by a header, so a
  // replayed or forwarded payload still parses the same way.
  if (s(j.type) === "email.received" || (j.data && (j.data as Record<string, unknown>).email_id)) {
    const d = (j.data ?? {}) as Record<string, unknown>;
    return {
      channel: "email",
      from: s(Array.isArray(d.from) ? (d.from as string[])[0] : d.from),
      name: "",
      text: "",                       // fetched below, the webhook has no body
      media: [],
      resendId: s(d.email_id),
      subject: s(d.subject),
    } as Inbound;
  }

  // Email, from any forwarder that can POST JSON
  if (j.subject || j.envelope || s(j.channel) === "email") {
    const body = s(j.text) || s(j.plain) || s(j.body);
    return {
      channel: "email",
      from: s(j.from) || s((j.envelope as Record<string, unknown>)?.from),
      name: s(j.fromName),
      text: [s(j.subject), body].filter(Boolean).join("\n\n"),
      media: Array.isArray(j.attachments) ? (j.attachments as string[]).slice(0, 8) : [],
    };
  }

  const one = s(j.mediaUrl);
  return {
    channel: s(j.channel) || "generic",
    from: s(j.from),
    name: s(j.name),
    text: s(j.text),
    media: one ? [one] : (Array.isArray(j.media) ? (j.media as string[]).slice(0, 8) : []),
  };
}

/** A voice note on any channel. Same transcriber the WhatsApp path uses. */
async function transcribeUrl(url: string, trace: Trace): Promise<string> {
  try {
    return await trace.span("transcribe voice note", SpanKind.CLIENT, { "yaadly.media.url": url.slice(0, 120) }, async (sp) => {
      // Twilio media needs basic auth; anything else is usually public-signed.
      const sid = Deno.env.get("TWILIO_ACCOUNT_SID") ?? "";
      const tok = Deno.env.get("TWILIO_AUTH_TOKEN") ?? "";
      const headers: Record<string, string> = {};
      if (sid && tok && url.includes("twilio.com")) {
        headers.Authorization = "Basic " + btoa(`${sid}:${tok}`);
      }
      const f = await fetch(url, { headers, signal: AbortSignal.timeout(45000) });
      if (!f.ok) { sp.recordError(`media fetch ${f.status}`); return ""; }
      const bytes = new Uint8Array(await f.arrayBuffer());
      let bin = "";
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      const r = await fetch(`${SUPABASE_URL}/functions/v1/yaad-transcribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
        body: JSON.stringify({ audio: btoa(bin), filename: "note.ogg" }),
        signal: AbortSignal.timeout(90000),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) { sp.recordError(j?.error ?? `transcribe ${r.status}`); return ""; }
      return s(j.text);
    });
  } catch (_) { return ""; }
}

/** The intake agent, same prompt discipline as the job wizard: never money. */
async function readTheJob(text: string, trace: Trace) {
  const key = Deno.env.get("MINIMAX_API_KEY");
  if (!key || text.length < 12) return null;
  try {
    return await trace.span("chat MiniMax-M2.7", SpanKind.CLIENT, {
      "gen_ai.system": "minimax",
      "gen_ai.operation.name": "chat",
      "gen_ai.request.model": "MiniMax-M2.7",
    }, async (sp) => {
      const r = await fetch("https://api.minimax.io/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "MiniMax-M2.7", temperature: 0.2, max_tokens: 900,
          messages: [
            { role: "system", content:
`You read a property job described in plain words, often in Jamaican Patois,
and return JSON only. Never invent facts. Never state a price, a budget or a
cost. If something is not in the text, use "".
Return exactly:
{"title":"","scope":"","trade":"","urgency":"","parish":"","client_name":"","client_email":"","access_note":"","questions":["",""]}
trade: one of Plumbing, Roofing, Electrical, Tiling, Masonry & Concrete,
Painting & Decorating, Grille & Gate Welding, Air Conditioning, Landscaping,
General Handyman, Solar Install, Water Tank & Pump, Locks & Security Doors,
Windows & Glazing, Carpentry & Joinery, Drainage & Septic, Fencing,
CCTV & Alarms. Empty if unclear.` },
            { role: "user", content: text.slice(0, 6000) },
          ],
        }),
        signal: AbortSignal.timeout(25000),
      });
      const raw = await r.text();
      sp.setAttributes({ "http.response.status_code": r.status });
      if (!r.ok) { sp.recordError(`minimax ${r.status}`); return null; }
      let j: Record<string, unknown> = {};
      try { j = JSON.parse(raw); } catch (_) { return null; }
      const content = String((j as { choices?: { message?: { content?: string } }[] })?.choices?.[0]?.message?.content ?? "");
      const m = content.match(/\{[\s\S]*\}/);
      if (!m) return null;
      try { return JSON.parse(m[0]); } catch (_) { return null; }
    });
  } catch (_) { return null; }
}


/** Resend's email.received webhook carries metadata only, never the body.
 *  That is deliberate on their side, so a large attachment cannot blow the
 *  request-body limit of whatever serverless thing is listening. It does mean
 *  the text has to be fetched back before anything can read the job. */
async function fetchResendEmail(id: string, trace: Trace) {
  const key = Deno.env.get("RESEND_API_KEY") ?? "";
  if (!key) return null;
  try {
    return await trace.span("resend.retrieve", SpanKind.CLIENT, {
      "server.address": "api.resend.com", "yaadly.email.id": id,
    }, async (sp) => {
      const r = await fetch(`https://api.resend.com/emails/receiving/${id}`, {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(20000),
      });
      sp.setAttributes({ "http.response.status_code": r.status });
      if (!r.ok) { sp.recordError(`resend ${r.status}`); return null; }
      return await r.json();
    });
  } catch (_) { return null; }
}

/** HTML is a fallback: most senders include a text part, some do not. */
function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** A reply keeps quoting the whole thread. Only the new part is the job. */
function topOfThread(text: string): string {
  const cuts = [/^On .+ wrote:$/m, /^-{2,}\s*Original Message/mi, /^_{5,}$/m, /^From:\s/m, /^>{1,}\s/m];
  let out = text;
  for (const c of cuts) {
    const m = out.match(c);
    if (m && m.index && m.index > 40) out = out.slice(0, m.index);
  }
  return out.trim();
}


// ── Who is allowed to post here ───────────────────────────────────────────
//
// This endpoint cannot require a Supabase JWT: Resend and Twilio call it and
// neither of them holds one. Turning that check off is what made the webhook
// work, and it is also what put the endpoint on the open internet, so the
// signature check below is not optional decoration, it is the replacement.
//
// Same convention the WhatsApp webhook already uses: if the relevant secret
// is not set yet, the request is allowed through and recorded as unverified
// rather than rejected, so this can be wired up and tested before every key
// exists. Once the secret is set, an unsigned request is refused.
//
// Worst case if someone does find the URL before the secrets are in: they can
// create a draft job. It cannot be opened to workers, no money moves, and it
// lands in the desk looking exactly like the spam it is.

async function hmac(keyBytes: Uint8Array, msg: string, hash: "SHA-256" | "SHA-1"): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", keyBytes as unknown as BufferSource, { name: "HMAC", hash }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return new Uint8Array(sig);
}
const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));

/** Resend signs with Svix: HMAC-SHA256 over id.timestamp.body */
async function resendSigned(req: Request, raw: string): Promise<{ ok: boolean; checked: boolean }> {
  const secret = Deno.env.get("RESEND_WEBHOOK_SECRET") ?? "";
  if (!secret) return { ok: true, checked: false };
  const id = req.headers.get("svix-id") ?? "";
  const ts = req.headers.get("svix-timestamp") ?? "";
  const sigHeader = req.headers.get("svix-signature") ?? "";
  if (!id || !ts || !sigHeader) return { ok: false, checked: true };

  // Replay window. A signature stays valid forever otherwise.
  const age = Math.abs(Date.now() / 1000 - Number(ts));
  if (!Number.isFinite(age) || age > 300) return { ok: false, checked: true };

  const rawSecret = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  let keyBytes: Uint8Array;
  try {
    const bin = atob(rawSecret);
    keyBytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) keyBytes[i] = bin.charCodeAt(i);
  } catch (_) { keyBytes = new TextEncoder().encode(rawSecret); }

  const expected = b64(await hmac(keyBytes, `${id}.${ts}.${raw}`, "SHA-256"));
  const offered = sigHeader.split(" ").map((p) => p.split(",").pop() ?? "");
  return { ok: offered.includes(expected), checked: true };
}

/** Twilio signs with HMAC-SHA1 over the full URL plus sorted POST params */
async function twilioSigned(req: Request, raw: string): Promise<{ ok: boolean; checked: boolean }> {
  const token = Deno.env.get("TWILIO_AUTH_TOKEN") ?? "";
  if (!token) return { ok: true, checked: false };
  const offered = req.headers.get("x-twilio-signature") ?? "";
  if (!offered) return { ok: false, checked: true };
  const params = new URLSearchParams(raw);
  const sorted = [...params.keys()].sort();
  let msg = req.url;
  for (const k of sorted) msg += k + params.get(k);
  const expected = b64(await hmac(new TextEncoder().encode(token), msg, "SHA-1"));
  return { ok: offered === expected, checked: true };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const trace = new Trace("yaad-inbound", req);
  const root = trace.startSpan(`${req.method} /yaad-inbound`, SpanKind.SERVER, httpAttrs(req));
  const done = (res: Response, status: number) => {
    root.setAttributes({ "http.response.status_code": status });
    root.end(); trace.flush(); return res;
  };
  const json = (b: unknown, status = 200) =>
    done(new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } }), status);

  // Twilio reads the response body as TwiML. Hand it JSON and it logs an
  // error on every single message, and the sender gets nothing back, which
  // from their side is indistinguishable from the message vanishing.
  const twiml = (reply: string) => {
    const safe = reply.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c] as string));
    root.setAttributes({ "http.response.status_code": 200 });
    root.end(); trace.flush();
    return new Response(
      `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${safe}</Message></Response>`,
      { status: 200, headers: { "Content-Type": "text/xml" } },
    );
  };

  try {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
    if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: "Not configured." }, 500);

    const raw = await req.text();
    const isTwilio = (req.headers.get("content-type") ?? "").includes("application/x-www-form-urlencoded");

    const sig = isTwilio ? await twilioSigned(req, raw) : await resendSigned(req, raw);
    root.setAttributes({ "yaadly.inbound.signature_checked": sig.checked, "yaadly.inbound.signature_ok": sig.ok });
    if (sig.checked && !sig.ok) {
      root.setAttributes({ "yaadly.inbound.outcome": "bad_signature" });
      return json({ error: "Signature check failed." }, 403);
    }
    const msg = await parseInbound(req, raw);
    root.setAttributes({ "yaadly.inbound.channel": msg.channel, "yaadly.inbound.chars": msg.text.length, "yaadly.inbound.media": msg.media.length });

    if (msg.resendId) {
      const full = await fetchResendEmail(msg.resendId, trace);
      if (full) {
        const body = s(full.text) || stripHtml(s(full.html));
        msg.from = msg.from || s(Array.isArray(full.from) ? full.from[0] : full.from);
        msg.text = [s(full.subject) || msg.subject || "", topOfThread(body)].filter(Boolean).join("\n\n");
      } else {
        root.recordError("resend body could not be fetched");
        msg.text = msg.subject ? `${msg.subject}\n\n[Body could not be fetched, open it in Resend.]` : "";
      }
    }

    if (!msg.from && !msg.text) {
      return isTwilio ? twiml("Sorry, that message came through empty. Send it again and we will pick it up.")
                      : json({ ok: true, note: "Nothing to do." });
    }

    // Voice first: it is how most of these actually arrive.
    let spoken = false;
    if (!msg.text && msg.media.length) {
      const said = await transcribeUrl(msg.media[0], trace);
      if (said) { msg.text = said; spoken = true; }
    }
    if (!msg.text) msg.text = "[message with no readable text, review manually]";

    const card = await readTheJob(msg.text, trace);
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    const jobId = `JOB-${msg.channel.toUpperCase().slice(0, 4)}-${Date.now()}`;
    const descr = [
      s(card?.scope) || msg.text,
      s(card?.access_note) ? `Access: ${s(card.access_note)}` : "",
      Array.isArray(card?.questions) && card.questions.filter(Boolean).length
        ? `Worth confirming before quoting: ${card.questions.filter(Boolean).map(s).join("; ")}` : "",
      "",
      `In their own words: ${msg.text}`,
      spoken ? "Source: voice note, transcribed automatically. The wording is theirs." : "",
      `Arrived by ${msg.channel} from ${msg.from || "an unknown sender"}.`,
      (s(card?.client_email) || msg.channel === "email") ? "" : "[No email yet. Reply on the same channel to get one, so they can see this in the client portal.]",
    ].filter(Boolean).join("\n");

    const { data, error } = await supabase.from("jobs").insert({
      id: jobId,
      title: s(card?.title) || `Job from ${msg.channel}`,
      parish: s(card?.parish),
      client_name: s(card?.client_name) || msg.name,
      // On email the sender address IS the client's email. The agent only
      // reads the body, and correctly returns nothing when it is not written
      // there, so take it from the envelope rather than losing it.
      client_email: (s(card?.client_email) || (msg.channel === "email" ? bareEmail(msg.from) : "")).toLowerCase(),
      client_phone: msg.channel === "email" ? "" : msg.from,
      descr,
      trade: s(card?.trade) || null,
      trade_source: s(card?.trade) ? "model" : null,
      urgency: s(card?.urgency) || null,
      stage: 0,
      open: false,
    }).select("portal_code").single();

    if (error) {
      root.recordError(error.message);
      return json({ error: error.message }, 500);
    }

    // Tell Monique. No contact details leave for the relay.
    try {
      const { data: st } = await supabase.from("app_settings").select("value").eq("key", "ntfy_topic").single();
      if (st?.value) {
        await fetch(`https://ntfy.sh/${st.value}`, {
          method: "POST",
          headers: { Title: `New ${msg.channel} job`, Priority: "high", Tags: "house" },
          body: `${jobId}: ${s(card?.trade) || "trade unclear"}, ${s(card?.parish) || "parish not given"}.${spoken ? " Voice note, transcribed." : ""}`,
          signal: AbortSignal.timeout(4000),
        });
      }
    } catch (_) { /* never let a notification break intake */ }

    root.setAttributes({ "yaadly.inbound.outcome": "job_created", "yaadly.job.id": jobId, "yaadly.inbound.spoken": spoken });

    if (isTwilio) {
      // Said in the same breath as the promise on the site: a person reads it,
      // and nothing reaches a worker until they sign. No false "we are on it".
      return twiml(
        `Thanks, we have your message and it is saved as ${jobId}. ` +
        `A person reads every job before anything is quoted, so you will hear back within 24 hours. ` +
        `Nothing is charged and no worker can see this until you have signed off the details.`,
      );
    }

    return json({ ok: true, jobId, portalCode: data?.portal_code ?? null, channel: msg.channel, transcribed: spoken });
  } catch (e) {
    root.recordError(e);
    return json({ error: "Inbound failed." }, 500);
  }
});
