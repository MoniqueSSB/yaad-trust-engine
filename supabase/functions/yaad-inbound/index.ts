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

type Media = { url: string; mime: string };
type Inbound = { channel: string; from: string; name: string; text: string; media: Media[]; resendId?: string; subject?: string };

/** photo, video, audio or file, from whatever Twilio says it is. */
function mediaKind(mime: string): string {
  if (mime.startsWith("image/")) return "photo";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "file";
}
function extFor(mime: string): string {
  const m: Record<string, string> = {
    "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic",
    "video/mp4": "mp4", "video/3gpp": "3gp", "video/quicktime": "mov",
    "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/amr": "amr", "audio/mp4": "m4a",
    "application/pdf": "pdf",
  };
  return m[mime.split(";")[0].trim()] ?? "bin";
}

async function parseInbound(req: Request, raw: string): Promise<Inbound> {
  const ct = (req.headers.get("content-type") ?? "").toLowerCase();

  // Twilio posts form-encoded. It is the one that needs no approval and can
  // reach a Jamaican number today, so it is handled first.
  if (ct.includes("application/x-www-form-urlencoded")) {
    const f = new URLSearchParams(raw);
    // Twilio sends MediaContentType alongside every MediaUrl. Ignoring it is
    // how a photograph of a leaking roof ends up being posted to a speech to
    // text model, failing, and being thrown away in silence.
    const media: Media[] = [];
    const n = Number(f.get("NumMedia") ?? "0");
    for (let i = 0; i < n; i++) {
      const u = f.get(`MediaUrl${i}`);
      if (u) media.push({ url: u, mime: s(f.get(`MediaContentType${i}`)) || "application/octet-stream" });
    }
    // Twilio carries WhatsApp on the same webhook as SMS, distinguished only
    // by a prefix on the address: whatsapp:+447700900000. Worth telling apart,
    // because the reply rules and the cost are different, and because a job
    // that says it arrived by WhatsApp is telling the truth about where the
    // client actually is.
    const rawFrom = s(f.get("From"));
    const isWa = rawFrom.startsWith("whatsapp:");
    return {
      channel: isWa ? "whatsapp" : "sms",
      from: isWa ? rawFrom.slice("whatsapp:".length) : rawFrom,
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
      media: Array.isArray(j.attachments) ? (j.attachments as string[]).slice(0, 8).map((u) => ({ url: u, mime: "" })) : [],
    };
  }

  const one = s(j.mediaUrl);
  return {
    channel: s(j.channel) || "generic",
    from: s(j.from),
    name: s(j.name),
    text: s(j.text),
    media: one ? [{ url: one, mime: "" }] : (Array.isArray(j.media) ? (j.media as string[]).slice(0, 8).map((u) => ({ url: u, mime: "" })) : []),
  };
}

/** A voice note on any channel. Same transcriber the WhatsApp path uses. */
/** Twilio media sits behind basic auth and disappears when Twilio prunes it.
 *  Anything worth keeping has to be pulled through here first. */
async function fetchMedia(url: string): Promise<{ bytes: Uint8Array; mime: string } | null> {
  const sid = Deno.env.get("TWILIO_ACCOUNT_SID") ?? "";
  const tok = Deno.env.get("TWILIO_AUTH_TOKEN") ?? "";
  const headers: Record<string, string> = {};
  if (sid && tok && url.includes("twilio.com")) headers.Authorization = "Basic " + btoa(`${sid}:${tok}`);
  try {
    // Some hosts refuse a request with no User-Agent, and a media fetch that
    // fails is a photograph nobody ever sees again.
    headers["User-Agent"] = "Yaadly/1.0 (+https://yaadly.co.uk)";
    const r = await fetch(url, { headers, redirect: "follow", signal: AbortSignal.timeout(45000) });
    if (!r.ok) return null;
    return {
      bytes: new Uint8Array(await r.arrayBuffer()),
      mime: (r.headers.get("content-type") ?? "").split(";")[0].trim(),
    };
  } catch (_) { return null; }
}

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

/** Keep what they sent.
 *
 *  Twilio holds media for a while and then prunes it, and its URLs need our
 *  credentials anyway, so a link in a job row is a link that dies. The bytes
 *  come here into the private `intake` bucket, and the job gets a row pointing
 *  at the object.
 *
 *  Private, always. These are photographs of the inside of somebody's house,
 *  often an empty one, often with the address already on the job. A public
 *  bucket would be a burglary catalogue.
 *
 *  Best effort on purpose: a failed upload must never cost the job. A missing
 *  photo is recoverable by asking for it again, a lost job is not.
 */
/** Only the two calls this needs. Naming the whole client means fighting its
 *  generics for no benefit, the same reason SettingsReader exists below. */
type MediaWriter = {
  storage: { from: (b: string) => {
    upload: (path: string, body: Uint8Array, opts: { contentType: string; upsert: boolean })
      => Promise<{ error: { message: string } | null }>;
  } };
  from: (t: string) => { insert: (row: Record<string, unknown>) => Promise<unknown> };
};

async function keepMedia(
  supabase: MediaWriter,
  jobId: string,
  media: Media[],
  startAt: number,
  trace: Trace,
): Promise<{ saved: number; kinds: string[] }> {
  const kinds: string[] = [];
  let saved = 0;
  for (let i = 0; i < media.length && i < 10; i++) {
    const m = media[i];
    try {
      await trace.span("store inbound media", SpanKind.INTERNAL, { "yaadly.media.mime": m.mime }, async (sp) => {
        const got = await fetchMedia(m.url);
        if (!got) { sp.recordError("media fetch failed"); return; }
        const mime = m.mime || got.mime || "application/octet-stream";
        const kind = mediaKind(mime);
        const path = `whatsapp/${jobId}/${startAt + i}-${crypto.randomUUID()}.${extFor(mime)}`;
        const up = await supabase.storage.from("intake")
          .upload(path, got.bytes, { contentType: mime, upsert: false });
        if (up.error) { sp.recordError(up.error.message); return; }
        const ins = await supabase.from("job_photos").insert({
          job_id: jobId,
          caption: `Sent on WhatsApp`,
          position: startAt + i,
          storage_path: path,
          mime,
          bytes: got.bytes.length,
          kind,
          source: "whatsapp",
        }) as { error?: { message: string } | null };
        if (ins?.error) { sp.recordError(ins.error.message); return; }
        kinds.push(kind);
        saved++;
      });
    } catch (_) { /* one bad attachment must not cost the job */ }
  }
  return { saved, kinds };
}

/** The intake agent, same prompt discipline as the job wizard: never money. */
async function readTheJob(text: string, trace: Trace) {
  const key = Deno.env.get("MINIMAX_API_KEY");
  // No length gate. "Hi" is the most common first message a real person sends
  // and it is exactly the one that needs a human sounding answer, not a
  // fallback string. Skipping the model on short messages is how an intake
  // ends up feeling like an answerphone.
  if (!key || !text.trim()) return null;
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
          model: "MiniMax-M2.7", temperature: 0.3, max_tokens: 1100,
          messages: [
            { role: "system", content:
`You are reading a WhatsApp conversation with somebody who needs property work
done in Jamaica. They are usually abroad, often writing in Jamaican Patois, and
they will not write a neat brief. Read the WHOLE conversation, oldest first,
and treat later lines as answers to earlier ones.

Return JSON only. Never invent facts. Never state a price, a budget or a cost,
and never estimate one even if asked directly. If something is not in the
conversation, use "".

Return exactly:
{"title":"","scope":"","trade":"","urgency":"","parish":"","client_name":"","client_email":"","access_note":"","questions":["",""],"enough":false,"confirmed":false,"wants_human":false,"reply":""}

trade: one of Plumbing, Roofing, Electrical, Tiling, Masonry & Concrete,
Painting & Decorating, Grille & Gate Welding, Air Conditioning, Landscaping,
General Handyman, Solar Install, Water Tank & Pump, Locks & Security Doors,
Windows & Glazing, Carpentry & Joinery, Drainage & Septic, Fencing,
CCTV & Alarms. Empty if unclear.

"enough" is true only when you know all three of: what the work is, roughly
where in Jamaica, and who can let a worker in. A greeting, "I have a problem",
or a trade with no location is NOT enough.

"confirmed" is true only when the LAST thing they said agrees that the summary
you read back to them is right and complete. "yes", "that\u2019s it", "correct",
"nothing else", "go ahead" are all confirmation. Adding another detail is NOT
confirmation, it is more information. Silence is not confirmation. If you have
not yet read the job back to them, "confirmed" is always false.

"wants_human" is true when they ask to speak to a person, to Monique, to talk
on the phone, or say they would rather explain it to somebody. Being annoyed
is not the same as asking for a person; only set it when they actually ask.

"reply" is the actual WhatsApp message sent back to them. Write it yourself.
Rules for it:
- Plain words, warm, no corporate tone, no emoji, no bullet points.
- Never use a dash of any kind. Use a comma or a full stop.
- Two or three short sentences, under 400 characters. This is a phone screen.
- UNDERSTAND Patois perfectly. REPLY in clear standard English. Do not write
  back in Patois and do not imitate how they speak. Half correct dialect from a
  business reads as mockery, and this business is trusted with people's money.
- Start by saying back what you understood, so they can see they were heard.
  Use their own nouns, "the back bedroom", not "the affected area". If you
  understood nothing yet, say so plainly rather than guessing.
- If "enough" is false, ask for AT MOST TWO missing things, the two a worker
  would refuse to quote without. Ask them the way a person would.
- If "enough" is true and you have not read the job back yet, read it back in
  plain sentences, everything you have, and end by asking whether that is right
  and whether there is anything else. That is the ONE question you always ask
  before a job is written up, because nobody wants to find out afterwards that
  the thing they thought they mentioned never landed.
- If "confirmed" is true, do not ask anything and do NOT say what happens next.
  Thank them in one short sentence and STOP. The system adds the rest, word for
  word, every time. Forbidden endings include "I will pass this on", "someone
  will be in touch", "we will get back to you" and anything else about a next
  step. You cannot promise those and the sentence after yours covers it.
- Never promise a price, a date, a worker, or that anyone is on the way.
- Never claim a person has already read it. A person reads it afterwards.

Not every message is a job. Handle whatever arrives, and always write a reply:

- A greeting on its own, "Hi", "Hello", "Good evening". Greet them back, say in
  one line what Yaadly does, and ask what needs doing and where. Never answer a
  greeting with a job reference or a promise.
- A question about how it works. Answer it straight from the facts below, then
  bring it back to what they need done.
- A question about price. Say plainly that Yaadly does not price work, the
  vetted workers quote against the written scope, and that is deliberate so
  nobody is marking up their own estimate. Never give a number, a range or a
  guess, even if pushed twice.
- Something not about property at all. Say briefly what this number is for and
  ask if they have work that needs doing. Do not be cold about it.
- Somebody upset or worried about being ripped off. Take it seriously, do not
  be chirpy, and tell them the money part honestly using the facts below.

A line like [they attached 2 photos] means those came through with the message.
Say you can see them, in one short clause, and never ask for what they have
just sent. Do not say they are saved or stored; you do not know that yet and
saying it when it is not true is worse than saying nothing. Photos and video
are worth more to a quoting worker than any description, so if they have sent
none and the work is visible, asking for one is a good use of a question.

Facts you may state, and nothing beyond them:
- Yaadly connects people abroad with vetted tradespeople in Jamaica.
- Money is held and released stage by stage, only once work is proven with
  evidence like photographs from the site.
- Workers quote against a written scope. Yaadly does not price the work.
- A person checks every job before any worker sees it.
- Nothing is charged for describing a job or posting it.

If you do not know something, say you will have it checked rather than
guessing. Never invent a worker, a timescale, a fee, or a guarantee.` },
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


/** Strip any promise the model tacked on the end.
 *
 *  The prompt tells it not to say what happens next, and it complies most of
 *  the time and then slips in "I will post this for you" anyway. A prompt is a
 *  strong preference, never a guarantee, and the one sentence Yaadly cannot
 *  afford a model to improvise is the one about what it is going to do next.
 *  So the promise lives in code, and anything the model writes that sounds
 *  like one gets cut before it is sent.
 */
function stripPromises(reply: string): string {
  const parts = reply.split(/(?<=[.!?])\s+/).filter(Boolean);
  const promise =
    /^\s*(i|we|somebody|someone|yaadly)\s*('?ll\b|will\b|am going to\b|are going to\b|gone\b)|^\s*let me (pass|send|forward|put)\b|^\s*(this|it) (will|'ll) be\b/i;
  while (parts.length > 1 && promise.test(parts[parts.length - 1])) parts.pop();
  return parts.join(" ").trim();
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

  // Twilio signs the URL it posted to. Inside the edge runtime `req.url` is
  // NOT that URL: it comes through as
  //   http://<ref>.supabase.co/yaad-inbound
  // with the scheme downgraded and the /functions/v1 prefix stripped by the
  // gateway. Signing over it rejects every genuine Twilio message with a 403,
  // and the only way to notice is to send a correctly signed request, because
  // a forged one is refused either way and looks like the check working.
  //
  // So rebuild the public URL and check against that, keeping `req.url` as a
  // candidate for local dev where it is the real one. Twilio also signs
  // whatever is typed into the console, so a trailing slash gets its own
  // candidate rather than a support ticket.
  const slug = new URL(req.url).pathname.replace(/^\/+/, "").replace(/^functions\/v1\//, "");
  const base = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "");
  const candidates = [
    `${base}/functions/v1/${slug}`,
    `${base}/functions/v1/${slug}/`,
    req.url,
  ];

  const key = new TextEncoder().encode(token);
  for (const url of candidates) {
    let msg = url;
    for (const k of sorted) msg += k + params.get(k);
    if (offered === b64(await hmac(key, msg, "SHA-1"))) return { ok: true, checked: true };
  }
  return { ok: false, checked: true };
}


/** The nudge to Monique's own inbox.
 *
 *  Deliberately a summary and not a forward. A forward would land the client's
 *  message in her mail app, she would reply from there, and the thread would
 *  stop being on the record. That is the "a chat is a good front door and a
 *  terrible filing cabinet" problem, aimed at her instead of at a client.
 *
 *  So: enough to judge whether it is urgent from a phone screen, and a link to
 *  the place the work actually happens. No Reply-To, on purpose.
 *
 *  Fire and forget. A mail relay having a bad afternoon must never cost a job
 *  that is already safely in the database.
 */
/** Only the one call this needs. Naming the whole client here means fighting
 *  its generics for no benefit; this says what is actually used. */
type SettingsReader = {
  from: (t: string) => {
    select: (cols: string) => {
      in: (col: string, vals: string[]) => Promise<{ data: { key: string; value: string }[] | null }>;
    };
  };
};

async function notifyAdmin(
  supabase: SettingsReader,
  job: { id: string; trade: string; parish: string; title: string; urgency: string;
         from: string; channel: string; spoken: boolean; scope: string;
         access: string; questions: string[] },
  trace: Trace,
) {
  const key = Deno.env.get("RESEND_API_KEY") ?? "";
  if (!key) return;
  try {
    const { data: rows } = await supabase.from("app_settings")
      .select("key,value").in("key", ["admin_email", "desk_url"]);
    const cfg = Object.fromEntries((rows ?? []).map((r) => [r.key, r.value]));
    const to = cfg.admin_email;
    if (!to) return;
    const desk = cfg.desk_url ?? "";

    const bits = [job.trade || "trade unclear", job.parish || "parish not given"].join(", ");
    const subject = `New job ${job.id}, ${bits}`;

    const esc = (t: string) => t.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c] as string));
    const row = (k: string, v: string) =>
      v ? `<tr><td style="padding:4px 14px 4px 0;color:#67807a;white-space:nowrap">${k}</td><td style="padding:4px 0;color:#0b1a16">${esc(v)}</td></tr>` : "";

    const html = `<div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.6;color:#0b1a16;max-width:600px">
<p style="margin:0 0 14px"><b>${esc(job.title || "New job")}</b></p>
<table style="border-collapse:collapse;font-size:14px;margin-bottom:16px">
${row("Reference", job.id)}${row("Trade", job.trade)}${row("Parish", job.parish)}
${row("Urgency", job.urgency)}${row("Arrived by", job.channel + (job.spoken ? ", voice note" : ""))}${row("From", job.from)}
</table>
${job.scope ? `<p style="margin:0 0 14px">${esc(job.scope)}</p>` : ""}
${job.access ? `<p style="margin:0 0 14px"><b>Access.</b> ${esc(job.access)}</p>` : ""}
${job.questions.length ? `<p style="margin:0 0 6px"><b>Worth confirming before quoting</b></p><ul style="margin:0 0 16px;padding-left:20px">${job.questions.map((q) => `<li>${esc(q)}</li>`).join("")}</ul>` : ""}
${desk ? `<p style="margin:0 0 18px"><a href="${desk}" style="background:#14b8a6;color:#04211d;text-decoration:none;font-weight:700;padding:10px 18px;border-radius:100px;display:inline-block">Open the desk</a></p>` : ""}
<p style="margin:0;font-size:12.5px;color:#67807a">Reply in the desk, not here. This is a summary, so an answer sent from your mail app never reaches the client and never lands on the job.</p>
</div>`;

    await trace.span("resend.send admin summary", SpanKind.CLIENT, { "yaadly.job.id": job.id }, async (sp) => {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        // From in.yaadly.co.uk, not send.yaadly.co.uk. Resend still lists the
        // latter as verified but its DKIM and SPF records are no longer in
        // DNS, so mail from it would fail authentication and quietly land in
        // spam. in.yaadly.co.uk has live DKIM, live SPF and a live MX.
        body: JSON.stringify({ from: "Yaadly <jobs@in.yaadly.co.uk>", to: [to], subject, html }),
        signal: AbortSignal.timeout(15000),
      });
      sp.setAttributes({ "http.response.status_code": r.status });
      if (!r.ok) sp.recordError(`resend send ${r.status}: ${(await r.text()).slice(0, 160)}`);
    });
  } catch (e) {
    trace.startSpan("admin summary failed").recordError(String(e).slice(0, 200)).end();
  }
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
    const voice = msg.media.find((m) => m.mime.startsWith("audio/") || (!m.mime && !msg.text));
    if (!msg.text && voice) {
      const said = await transcribeUrl(voice.url, trace);
      if (said) { msg.text = said; spoken = true; }
    }
    if (!msg.text) msg.text = "[message with no readable text, review manually]";

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    // An intake is a conversation. Somebody writes "roof a leak", then two
    // minutes later "it in Portland". Read against the whole thread or the
    // second line is meaningless and they get asked the same thing twice.
    //
    // Twelve hours, because a client abroad answers when they wake up, and a
    // brand new problem a week later is genuinely a new job.
    const THREAD_HOURS = 12;
    const threadKey = { channel: msg.channel, from_addr: msg.from || "unknown" };
    const { data: prior } = await supabase.from("intake_threads")
      .select("job_id,transcript,turns,last_at,stage")
      .eq("channel", threadKey.channel).eq("from_addr", threadKey.from_addr)
      .maybeSingle();
    const continuing = !!prior &&
      (Date.now() - new Date(prior.last_at as string).getTime()) < THREAD_HOURS * 3600_000;

    // Tell the assistant what came with the message. Without this it thanks
    // somebody for a photograph and then asks them to send a photograph.
    const counts = msg.media.reduce((a, m) => {
      const k = mediaKind(m.mime || (spoken ? "audio/ogg" : ""));
      a[k] = (a[k] ?? 0) + 1; return a;
    }, {} as Record<string, number>);
    const attached = Object.entries(counts)
      .filter(([k]) => k !== "audio")
      .map(([k, n]) => `${n} ${k}${n > 1 ? "s" : ""}`).join(" and ");
    const thisTurn = [msg.text, attached ? `[they attached ${attached}]` : ""].filter(Boolean).join("\n");

    const transcript = continuing
      ? `${prior!.transcript}\n\n${thisTurn}`.slice(-8000)
      : thisTurn;

    const card = await readTheJob(transcript, trace);
    const enough = card?.enough === true;
    const wantsHuman = card?.wants_human === true;

    // Three stages, and the client owns the last one. The assistant may decide
    // it has enough; only they can say it is right and complete.
    const wasStage = continuing ? String(prior!.stage ?? "gathering") : "gathering";
    const confirmedNow = enough && wasStage === "confirming" && card?.confirmed === true;
    const stage = confirmedNow || wasStage === "done" ? "done"
      : enough ? "confirming"
      : "gathering";

    // JOB-WHAT-… helps nobody. Name the door it came through.
    const CODE: Record<string, string> = { whatsapp: "WA", sms: "SMS", email: "EMAIL", generic: "WEB" };
    const jobId = continuing ? String(prior!.job_id) : `JOB-${CODE[msg.channel] ?? "WEB"}-${Date.now()}`;
    const turns = continuing ? Number(prior!.turns) + 1 : 1;

    // Photographs are the single most useful thing a client can hand a worker,
    // and until now they were fetched, mistaken for audio, and dropped. Done
    // before the description is written so a failure is visible on the job
    // rather than silent.
    const already = continuing ? Number(prior!.turns) * 10 : 0;
    const wanted = msg.media.filter((m) => !m.mime.startsWith("audio/")).length;
    const kept = msg.media.length
      ? await keepMedia(supabase as unknown as MediaWriter, jobId, msg.media, already, trace)
      : { saved: 0, kinds: [] as string[] };
    const lostMedia = Math.max(0, wanted - kept.saved);
    root.setAttributes({ "yaadly.inbound.media_saved": kept.saved, "yaadly.inbound.media_lost": lostMedia });

    const descr = [
      s(card?.scope) || transcript,
      s(card?.access_note) ? `Access: ${s(card.access_note)}` : "",
      Array.isArray(card?.questions) && card.questions.filter(Boolean).length
        ? `Worth confirming before quoting: ${card.questions.filter(Boolean).map(s).join("; ")}` : "",
      "",
      `In their own words:\n${transcript}`,
      spoken ? "Source: voice note, transcribed automatically. The wording is theirs." : "",
      `Arrived by ${msg.channel} from ${msg.from || "an unknown sender"}${turns > 1 ? `, over ${turns} messages` : ""}.`,
      enough ? "" : "[Still gathering. The assistant has asked for what is missing and this stays a draft until it comes back.]",
      lostMedia ? `[${lostMedia} attachment${lostMedia > 1 ? "s" : ""} came through but could not be stored. Ask them to send again.]` : "",
      (s(card?.client_email) || msg.channel === "email") ? "" : "[No email yet. Reply on the same channel to get one, so they can see this in the client portal.]",
    ].filter(Boolean).join("\n");

    const row = {
      title: s(card?.title) || (enough ? `Job from ${msg.channel}` : `Someone writing in on ${msg.channel}`),
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
      // A greeting is not a job, and neither is a job the client has not agreed
      // is right. Leaving it 'draft' until they confirm keeps the board honest
      // and keeps the desk's real queue free of things nobody can act on yet.
      status: stage === "done" ? "awaiting_client_setup" : "draft",
    };

    const { data, error } = continuing
      ? await supabase.from("jobs").update(row).eq("id", jobId).select("portal_code").single()
      : await supabase.from("jobs").insert({ id: jobId, ...row }).select("portal_code").single();

    if (error) {
      root.recordError(error.message);
      return json({ error: error.message }, 500);
    }


    // Remember the conversation before replying. If the reply fails we would
    // rather have the thread than lose what they said.
    await supabase.from("intake_threads").upsert({
      channel: threadKey.channel,
      from_addr: threadKey.from_addr,
      job_id: jobId,
      transcript,
      turns,
      stage,
      last_at: new Date().toISOString(),
    }, { onConflict: "channel,from_addr" });

    // Three pushes for one conversation is noise, and noise gets muted, and a
    // muted phone loses a real job later. So: once when somebody first writes
    // in, so a lead is never silently sitting there, and once when it becomes
    // a real job. Nothing for the turns in between.
    const HANDOFF_TURNS = 3;
    const handingOver = wantsHuman || (!enough && turns >= HANDOFF_TURNS);
    const worthTelling = stage === "done" || turns === 1 || handingOver;

    const summary = worthTelling ? notifyAdmin(supabase as unknown as SettingsReader, {
      id: jobId,
      trade: s(card?.trade), parish: s(card?.parish), title: s(card?.title),
      urgency: s(card?.urgency), from: msg.from, channel: msg.channel, spoken,
      scope: s(card?.scope), access: s(card?.access_note),
      questions: Array.isArray(card?.questions) ? card.questions.filter(Boolean).map(s) : [],
    }, trace) : null;
    const rt2 = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
    if (summary && rt2?.waitUntil) rt2.waitUntil(summary);

    // Tell Monique on her phone too. No contact details leave for the relay.
    try {
      const { data: st } = worthTelling
        ? await supabase.from("app_settings").select("value").eq("key", "ntfy_topic").single()
        : { data: null };
      if (st?.value) {
        await fetch(`https://ntfy.sh/${st.value}`, {
          method: "POST",
          headers: {
            Title: stage === "done"
              ? `New ${msg.channel} job`
              : handingOver ? `Needs you: ${msg.channel}` : `Someone writing in on ${msg.channel}`,
            Priority: stage === "done" || handingOver ? "high" : "default",
            Tags: stage === "done" ? "house" : handingOver ? "raising_hand" : "speech_balloon",
          },
          body: stage === "done"
            ? `${jobId}: ${s(card?.trade) || "trade unclear"}, ${s(card?.parish) || "parish not given"}.${spoken ? " Voice note, transcribed." : ""}`
            : handingOver
              ? `${jobId}: ${turns} messages and still not clear. They have been told you will read it yourself.`
              : `${jobId}: not enough to act on yet. The assistant has asked what is missing.`,
          signal: AbortSignal.timeout(4000),
        });
      }
    } catch (_) { /* never let a notification break intake */ }

    root.setAttributes({ "yaadly.inbound.outcome": enough ? "job_created" : "gathering", "yaadly.job.id": jobId, "yaadly.inbound.spoken": spoken, "yaadly.inbound.turns": turns });

    if (isTwilio) {
      // The assistant writes this, not a template. Somebody who says "I have a
      // problem at my house" and gets a job reference and a 24 hour promise has
      // been processed, not helped, and the card behind it is empty anyway.
      // Asking the two things a worker would refuse to quote without is worth
      // more to everyone than a tidy autoreply.
      //
      // Still bounded by what the site promises: a person checks it, nothing
      // reaches a worker until it is signed, and no price is ever quoted here.
      const written = s(card?.reply);
      const safe = stripPromises(written.replace(/[\u2010-\u2015]/g, ",")).slice(0, 900);

      // They asked for a person. That is not a failure of the assistant, it is
      // a reasonable thing to want when you are about to spend money on a
      // house you cannot see, and the answer is yes.
      if (wantsHuman) {
        return twiml(
          `Of course. I am passing this to Monique now and she will come back to you on this number herself. ` +
          `Everything you have told me is saved${stage === "done" ? ` as ${jobId}` : ""}, so you will not have to say it twice.`,
        );
      }

      // Read back, then wait. The assistant may believe it has enough; only
      // the client can say it is right. Nobody wants to discover afterwards
      // that the thing they thought they mentioned never landed.
      if (stage === "confirming") {
        return twiml(safe || "Let me read that back. Have I got it right, and is there anything else before I write it up?");
      }

      // Confirmed. This is the only point a link goes out, because it is the
      // only point there is something finished to finish.
      if (confirmedNow || (stage === "done" && wasStage !== "done")) {
        const link = `https://app.yaadly.co.uk/portal/join?job=${encodeURIComponent(jobId)}${data?.portal_code ? `&code=${encodeURIComponent(String(data.portal_code))}` : ""}`;
        return twiml(
          (safe ? safe + " " : "") +
          `Your job is ${jobId}. Last step, and it is short: ${link} ` +
          `That sets up your portal and the agreement. Nothing reaches a worker until you have signed it, and nothing is charged.`,
        );
      }

      // Already finished and still talking. Take the extra detail, do not
      // re-send the link at them like a machine.
      if (stage === "done") {
        return twiml(
          (safe ? safe + " " : "") + `Added to ${jobId}. If you still need the link to finish setting up, say "link".`,
        );
      }

      // Asking twice is helping. Asking a fourth time is a phone tree, and the
      // person on the other end is usually the one who most needs a human:
      // older, upset, writing from a bad signal, or describing something the
      // model genuinely cannot categorise. Hand over and say so out loud.
      const HANDOFF_AFTER = 3;
      if (!enough && turns >= HANDOFF_AFTER) {
        // Drop the questions out of whatever it wrote. Asking again in the
        // same breath as "I am giving this to a person" is the worst of both:
        // they do not know whether to answer or wait.
        const noQuestions = safe.split(/(?<=[.!?])\s+/).filter((x) => !x.trim().endsWith("?")).join(" ").trim();
        return twiml(
          (noQuestions ? noQuestions + " " : "") +
          `I have not got quite enough to write this up properly, so I am passing it to Monique to read herself. She will come back to you on this number. Your reference is ${jobId}.`,
        );
      }

      if (!enough) {
        // No reference number yet, on purpose. A reference for a greeting
        // teaches people the number means nothing.
        return twiml(
          safe ||
          "Thanks for writing in. Yaadly gets property work done in Jamaica for people who are not there to watch it. Tell me what needs doing, whereabouts the property is, and who can let a worker in.",
        );
      }

      // Should not be reached: every stage above returns. Kept as a floor so a
      // future branch can never fall through to silence, which on WhatsApp
      // looks exactly like being ignored.
      return twiml(safe || "Thanks, I have that. What else can you tell me about the job?");
    }

    return json({ ok: true, jobId, portalCode: data?.portal_code ?? null, channel: msg.channel, transcribed: spoken, enough, turns });
  } catch (e) {
    root.recordError(e);
    return json({ error: "Inbound failed." }, 500);
  }
});
