import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { Trace, SpanKind, httpAttrs } from "./otel.ts";
import { pickTextProvider, providerAttrs } from "./textmodel.ts";
import * as guardrails from "./guardrails.ts";
import { checkTwilioSignature } from "./twilio-signature.ts";
import { pickJobChoice } from "./job-match.ts";
import { matchApprovingJob } from "./approval-match.ts";
import { pickEvidenceItem } from "./evidence-item-match.ts";
import { visitorTokenOk, originAllowed, WEB_CHAT_MAX_CHARS, webReferenceIn, WEB_SAFE_FALLBACK } from "./web-chat.ts";
import { FAQ_FACTS } from "./faq.ts";
import { priceFigureGuard } from "./price-figures.ts";

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

  // The chat in the corner of yaadly.co.uk (docs/chat.js). A visitor token
  // stands where a phone number would: it is the thread key, so the second
  // message reads against the first, and it names nobody. Text only, no
  // media, by design: photographs of a job belong on the job form or on
  // WhatsApp, where they are kept against the job.
  if (s(j.channel) === "web") {
    return {
      channel: "web",
      from: s(j.visitor).toLowerCase(),
      name: "",
      text: s(j.text).slice(0, WEB_CHAT_MAX_CHARS),
      media: [],
    };
  }

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

// ── evidence intake from a worker's own WhatsApp number ─────────────────
// Founder's own framing, 31 Aug 2026: a worker on site "has no time to log
// on and carry out those steps in the web." First built against Meta's
// Cloud API directly, then moved here the same day: Meta's own business
// verification stood between the founder and testing anything at all,
// while this endpoint already receives real Twilio WhatsApp traffic on the
// number that already works. Same logic, a simpler media fetch (Twilio
// hands over a URL directly; Meta needed a two-step id lookup first), and
// the reply goes out as the TwiML response to the same message rather than
// a second API call.
//
// The trust model is unchanged from the Meta build: no session exists on
// an inbound message, so the check RLS would make for a portal upload
// (this worker, this job, and no other) is made by hand instead, against
// the phone match, before a single byte is trusted. The server-computed
// sha256 is the same rule evidence-actions.ts and yaad-evidence-video
// already use, a third time in a third place.

const EVIDENCE_EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic",
  "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov",
};
const EVIDENCE_MEDIA_BUCKET = "evidence";
const EVIDENCE_MAX_BYTES = 20_000_000;

async function evidenceSha256(buf: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// hasCaption is the record of whether a worker actually said what this is,
// separate from label itself: label always holds something displayable
// ("Sent on WhatsApp" when nothing was said), but that fallback text is not
// context, and the dispatch loop needs to tell the two apart to know
// whether to ask.
type PendingEvidence = { path: string; mime: string; bytes: number; sha256: string; label: string; hasCaption: boolean };

// Twilio's MediaUrl is already fetchable, unlike Meta's media id, so this is
// a straight download rather than a two-step lookup: fetchMedia() above
// already carries Twilio's own basic auth for a twilio.com host.
async function downloadAndStageEvidence(admin: any, url: string, mime: string, caption: string): Promise<PendingEvidence | null> {
  const ext = EVIDENCE_EXT_BY_MIME[mime.toLowerCase()];
  if (!ext) return null;

  const got = await fetchMedia(url);
  if (!got || got.bytes.byteLength === 0 || got.bytes.byteLength > EVIDENCE_MAX_BYTES) return null;

  const path = `_pending/${crypto.randomUUID()}.${ext}`;
  const { error } = await admin.storage.from(EVIDENCE_MEDIA_BUCKET).upload(path, got.bytes, { contentType: mime, upsert: false });
  if (error) return null;

  const sha256 = await evidenceSha256(got.bytes.buffer as ArrayBuffer);
  const trimmed = caption.trim();
  return { path, mime, bytes: got.bytes.byteLength, sha256, label: (trimmed || "Sent on WhatsApp").slice(0, 140), hasCaption: !!trimmed };
}

async function finalizeEvidenceItem(admin: any, jobId: string, stage: number, workerEmail: string, item: PendingEvidence): Promise<boolean> {
  const ext = item.path.split(".").pop();
  const finalPath = `${jobId}/${crypto.randomUUID()}.${ext}`;
  const { error: moveErr } = await admin.storage.from(EVIDENCE_MEDIA_BUCKET).move(item.path, finalPath);
  if (moveErr) return false;

  const { error: insErr } = await admin.from("evidence").insert({
    job_id: jobId, label: item.label, img: null, storage_path: finalPath,
    bytes: item.bytes, mime: item.mime, kind: "work", stage,
    sha256: item.sha256, captured_at: null, uploaded_by: workerEmail, ok: null,
  });
  if (insErr) {
    await admin.storage.from(EVIDENCE_MEDIA_BUCKET).remove([finalPath]);
    return false;
  }
  return true;
}

async function lookupActiveJobsForWorker(admin: any, email: string): Promise<{ id: string; title: string; stage: number }[]> {
  const { data } = await admin.from("jobs").select("id, title, stage, status").ilike("worker_email", email).order("updated_at", { ascending: false });
  return (data ?? [])
    // 'awaiting_payment' excluded 2 Sep 2026, alongside the RLS gate on
    // evidence itself: a job cannot progress until Yaadly's agency fee is
    // marked paid, and a worker filing evidence over WhatsApp goes through
    // the service role, which RLS alone cannot stop. Re-applied 2 Sep 2026
    // after another session's deploy overwrote this file with a copy that
    // predated it.
    .filter((j: any) => j.status !== "complete" && j.status !== "cancelled" && j.status !== "awaiting_payment")
    .map((j: any) => ({ id: j.id, title: j.title ?? j.id, stage: Math.max(j.stage ?? 0, 1) }));
}

// More than one worker_profiles row can share a phone number - an old
// seed/test profile whose only job finished long ago, sitting alongside the
// profile that number actually belongs to now. Found live, testing this for
// real: a single-match lookup silently picked the finished-job profile, its
// zero active jobs then read as "this phone is not a worker with anything to
// file", and every message after that fell through and was read as a
// client's instead. Tries every phone match in turn, oldest code untouched,
// and returns the first one that actually has active work, so a stale
// duplicate can never shadow the profile that matters. Returns null only
// when NONE of the matches have active work, same meaning the old function's
// null already carried.
async function lookupWorkerWithActiveJobs(
  admin: any,
  from: string,
): Promise<{ email: string; jobs: { id: string; title: string; stage: number }[] } | null> {
  const tail = from.replace(/\D/g, "").slice(-9);
  if (tail.length < 7) return null;
  const { data } = await admin
    .from("worker_profiles")
    .select("worker_email, phone")
    .eq("active", true)
    .not("phone", "is", null);
  const candidates = (data ?? [])
    .filter((w: any) => String(w.phone ?? "").replace(/\D/g, "").slice(-9) === tail)
    .map((w: any) => String(w.worker_email ?? "").toLowerCase())
    .filter(Boolean);
  for (const email of candidates) {
    const jobs = await lookupActiveJobsForWorker(admin, email);
    if (jobs.length) return { email, jobs };
  }
  return null;
}

async function mintPortalUploadLink(admin: any, email: string, jobId: string): Promise<string | null> {
  try {
    const { data, error } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email,
      options: { redirectTo: `https://app.yaadly.co.uk/portal/jobs/${encodeURIComponent(jobId)}?tab=evidence` },
    });
    if (error || !data?.properties?.action_link) return null;
    return String(data.properties.action_link);
  } catch (_) { return null; }
}

// Everything else in this file replies to whoever just messaged, via
// TwiML. Telling the WORKER about a client's comment is a different
// person than the one who sent this request, so that mechanism cannot
// reach them: this is a genuine outbound send, same shape as the ones
// yaad-notify-client and yaad-job-health already carry their own copy of.
async function sendWhatsAppTo(to: string, body: string, trace: Trace): Promise<boolean> {
  const sid = Deno.env.get("TWILIO_ACCOUNT_SID") ?? "";
  const tok = Deno.env.get("TWILIO_AUTH_TOKEN") ?? "";
  const from = Deno.env.get("TWILIO_WHATSAPP_FROM") ?? "";
  const digits = to.replace(/\D/g, "");
  if (!sid || !tok || !from || digits.length < 7) return false;
  return await trace.span("twilio.send.whatsapp", SpanKind.CLIENT, {
    "server.address": "api.twilio.com", "messaging.system": "twilio",
  }, async (s) => {
    try {
      const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: "POST",
        headers: { Authorization: "Basic " + btoa(`${sid}:${tok}`), "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ To: `whatsapp:+${digits}`, From: from, Body: body }),
        signal: AbortSignal.timeout(15000),
      });
      s.setAttributes({ "http.response.status_code": r.status });
      return r.ok;
    } catch (e) {
      s.recordError(String(e).slice(0, 200));
      return false;
    }
  });
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
  const prov = pickTextProvider();
  // No length gate. "Hi" is the most common first message a real person sends
  // and it is exactly the one that needs a human sounding answer, not a
  // fallback string. Skipping the model on short messages is how an intake
  // ends up feeling like an answerphone.
  if (!prov || !text.trim()) return null;
  try {
    return await trace.span(`chat ${prov.model}`, SpanKind.CLIENT, {
      ...providerAttrs(prov),
      "gen_ai.operation.name": "chat",
    }, async (sp) => {
      const r = await fetch(prov.api, {
        method: "POST",
        headers: { Authorization: `Bearer ${prov.key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          // 1100 until 1 Sep 2026: too tight. This model reasons in a <think>
          // block before it ever writes the JSON answer, and that reasoning
          // counts against the same budget. Caught live: a real message got
          // cut off mid-thought, no closing </think>, no JSON, ever, and the
          // client got the hardcoded generic opener instead of an answer.
          // 1100 was also the smallest budget of any model call in this
          // codebase; every sibling call is 1200 or higher, some far higher,
          // and this is the one call that both classifies AND writes a full
          // conversational reply, never the lightest job of the set.
          //
          // 3500 until 2 Sep 2026, when the FAQ facts joined the prompt and
          // the model had more to think about: two of four first-turn calls
          // that evening spent the whole budget inside <think> and never
          // reached the JSON, and a third ran out midway through the reply
          // field. Every one of those cost a client the generic opener in
          // place of an answer. 6000 is the budget that fits the longer
          // prompt; the parse below also strips the think block first, so a
          // brace inside the reasoning can no longer be mistaken for the
          // start of the answer.
          model: prov.model, temperature: 0.3, max_tokens: 6000,
          messages: [
            { role: "system", content:
`You are reading a WhatsApp conversation with somebody who needs property work
done in Jamaica. They are usually abroad, often writing in Jamaican Patois, and
they will not write a neat brief. Read the WHOLE conversation, oldest first,
and treat later lines as answers to earlier ones.

Return JSON only, even when the message is a question rather than a job: the
answer to a question goes in "reply", inside the same JSON. Never invent
facts. Never state a price, a budget or a cost for the work itself, and never estimate one even if asked directly. The only
figures you may ever repeat are Yaadly's own published service prices and
charges in the facts below, word for word. If something is not in the
conversation, use "".

Return exactly:
{"title":"","scope":"","trade":"","urgency":"","parish":"","client_name":"","client_email":"","access_note":"","questions":["",""],"enough":false,"confirmed":false,"wants_human":false,"reply":""}

trade: one of Plumbing, Roofing, Electrical, Tiling, Masonry & Concrete,
Painting & Decorating, Grille & Gate Welding, Air Conditioning, Landscaping,
General Handyman, Solar Install, Water Tank & Pump, Locks & Security Doors,
Windows & Glazing, Carpentry & Joinery, Drainage & Septic, Fencing,
CCTV & Alarms. Empty if unclear.

"enough" is true only when you know all three of: what the work is, which
parish the property is in (this is the field workers and matching actually
use, not just a town or an area), and who can let a worker in. A greeting,
"I have a problem", or a trade with no parish is NOT enough.

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
- A question about what a repair or a job will cost. Say plainly that Yaadly
  does not price work, the vetted workers quote against the written scope, and
  that is deliberate so nobody is marking up their own estimate. Never give a
  number, a range or a guess, even if pushed twice.
- A question about Yaadly's own services and what they cost. Answer from the
  published prices in the facts below, exactly as written there, and point
  them to yaadly.co.uk/prices for the full list.
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

${FAQ_FACTS}

If you do not know something, say you will have it checked rather than
guessing. Never invent a worker, a timescale, a fee, or a guarantee.` },
            { role: "user", content: text.slice(0, 6000) },
          ],
        }),
        signal: AbortSignal.timeout(25000),
      });
      const raw = await r.text();
      sp.setAttributes({ "http.response.status_code": r.status });
      // Every return null below used to be silent: recorded on the span only,
      // which does not surface in function_logs, so a client falling through
      // to the hardcoded generic opener left no console trail at all to say
      // why. Found live, 1 Sep 2026, chasing exactly that with nothing to go
      // on. console.error alongside the span from here down, every path.
      if (!r.ok) {
        const msg = `readTheJob: ${prov.name} http ${r.status}: ${raw.slice(0, 200)}`;
        sp.recordError(msg); console.error(msg); return null;
      }
      let j: Record<string, unknown> = {};
      try { j = JSON.parse(raw); } catch (e) {
        console.error("readTheJob: response body was not JSON:", String(e).slice(0, 200)); return null;
      }
      const content = String((j as { choices?: { message?: { content?: string } }[] })?.choices?.[0]?.message?.content ?? "")
        .replace(/<think>[\s\S]*?<\/think>/g, "");
      const m = content.match(/\{[\s\S]*\}/);
      if (!m) {
        // Asked how Yaadly works, the model sometimes answers in plain prose
        // and skips the JSON envelope altogether (seen live 2 Sep 2026, the
        // evening the FAQ facts joined the prompt: three good answers about
        // vetting and Completion Reports, all thrown away for want of
        // braces, and three clients handed the generic opener instead). The
        // prose IS the answer. It goes out as the reply, through the same
        // promise strip, figure guard and language screen as any other, with
        // every classification field left empty, which is the honest reading
        // of a message that was a question and not a job.
        const prose = content.trim();
        if (prose.length >= 20 && prose.length <= 2000 && !/[{}]/.test(prose)) {
          console.error("readTheJob: model answered in prose, no JSON; using the prose as the reply:", prose.slice(0, 200));
          return { title: "", scope: "", trade: "", urgency: "", parish: "", client_name: "", client_email: "",
                   access_note: "", questions: [], enough: false, confirmed: false, wants_human: false, reply: prose };
        }
        console.error("readTheJob: no JSON object in model content:", content.slice(0, 300)); return null;
      }
      try { return JSON.parse(m[0]); } catch (e) {
        console.error("readTheJob: matched text was not valid JSON:", String(e).slice(0, 200), m[0].slice(0, 300)); return null;
      }
    });
  } catch (e) {
    console.error("readTheJob: threw:", String(e).slice(0, 300)); return null;
  }
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

/** Twilio signs with HMAC-SHA1 over the full URL plus sorted POST params.
 *  The check itself lives in ./twilio-signature.ts, which reads no
 *  environment variable of its own, so a test can run the exact same
 *  algorithm against a throwaway secret instead of only ever a real signed
 *  message. This is the thin wrapper that hands it the two live secrets. */
async function twilioSigned(req: Request, raw: string): Promise<{ ok: boolean; checked: boolean }> {
  return checkTwilioSignature(req, raw, Deno.env.get("TWILIO_AUTH_TOKEN") ?? "", Deno.env.get("SUPABASE_URL") ?? "");
}

/** What a stage number actually means to the person reading the message.
 *  Founder's own correction, live, testing this for real: every WhatsApp
 *  message about a stage said only "Stage 1" or "Stage 2", a raw number
 *  with no connection to what the approved Kickoff Pack itself calls that
 *  stage or what share of the total it releases - even though the portal
 *  rail (jobStages() in journey.ts) has read the pack's own stage names
 *  since 31 Aug. The data was always right; the WhatsApp copy never said
 *  it. Falls back to the bare number for a job with no approved pack,
 *  same as the rail itself does. */
async function stageLabel(
  supabase: { from: (t: string) => any },
  jobId: string,
  stageNum: number,
): Promise<string> {
  const { data: pack } = await supabase.from("kickoff_packs")
    .select("docs").eq("job_id", jobId).eq("status", "approved")
    .order("updated_at", { ascending: false }).limit(1).maybeSingle();
  const stages = (pack?.docs as { payment_schedule?: { stages?: unknown } } | null)
    ?.payment_schedule?.stages;
  const s = Array.isArray(stages) ? (stages as any[])[stageNum - 1] : null;
  if (s && typeof s.stage === "string" && s.stage.trim()) {
    const pct = typeof s.proportion_percent === "number" ? ` (${s.proportion_percent}% of the total)` : "";
    return `${s.stage}${pct}`;
  }
  return `Stage ${stageNum}`;
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

/** Tell the desk a reply was held back, without repeating what it said.
 *
 *  ntfy.sh is a public service, so this carries the guidance strings, which
 *  are a fixed closed set, and nothing the client or the model wrote. Same
 *  rule the other functions already follow for their notifications. The draft
 *  itself is in the function log. */
async function alertDeskBlocked(findings: { guidance: string }[], trace: Trace, where = "WhatsApp") {
  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: st } = await supabase.from("app_settings")
      .select("value").eq("key", "ntfy_topic").maybeSingle();
    if (!st?.value) return;
    await fetch(`https://ntfy.sh/${st.value}`, {
      method: "POST",
      headers: { Title: "Reply held back", Priority: "high", Tags: "warning" },
      body: `A ${where} reply failed the language screen and was not sent. The client got a `
        + "holding message and is waiting on a person. Reason: "
        + [...new Set(findings.map((f) => f.guidance))].join(" ")
        + " The draft is in the yaad-inbound function log.",
      signal: AbortSignal.timeout(4000),
    });
  } catch (e) {
    // A failed notification must never become a failed reply. The block itself
    // already happened and is already in the log and on the span.
    trace.startSpan("guardrail alert failed").recordError(String(e).slice(0, 200)).end();
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
  //
  // This is also the ONE place anything in this function reaches a client, so
  // it is where the banned-language screen goes. Every reply passes through
  // here, the model-written ones and the fixed strings alike. Screening the
  // fixed ones costs nothing and means a careless edit to one of them cannot
  // walk past the rule either.
  const twiml = async (reply: string) => {
    const findings = guardrails.scan(reply);
    let body = reply;

    if (findings.length) {
      // The model wrote something the company has a standing rule never to
      // say. It does not go out. The client gets a plain holding reply and a
      // person picks it up, which is the governing rule working rather than
      // failing: AI drafts, a human takes it from here.
      body = guardrails.SAFE_FALLBACK;

      // The draft goes to the function log, which is private to this project.
      // Not to telemetry and not to ntfy: it is model prose about somebody's
      // property and may carry their name.
      console.error(
        "guardrail: outbound reply blocked. Terms: "
          + [...new Set(findings.map((f) => f.term))].join(", ")
          + ". Draft was: " + reply.slice(0, 500),
      );
      await alertDeskBlocked(findings, trace);
    }

    root.setAttributes({ "http.response.status_code": 200, ...guardrails.screenAttrs(findings) });
    const safe = body.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c] as string));
    root.end(); trace.flush();
    return new Response(
      `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${safe}</Message></Response>`,
      { status: 200, headers: { "Content-Type": "text/xml" } },
    );
  };

  // The web sibling of twiml(): same screen, same refusal, a JSON body the
  // widget can render instead of TwiML. "handoff" tells the widget to show
  // the WhatsApp button; a blocked reply always hands off, because the
  // holding text it sends points at WhatsApp and the button is how they get
  // there. "reference" is the job code the WhatsApp lane adopts.
  const webSay = async (reply: string, meta: { reference?: string | null; handoff?: boolean } = {}) => {
    const findings = guardrails.scan(reply);
    let body = reply;
    let handoff = meta.handoff === true;
    if (findings.length) {
      body = WEB_SAFE_FALLBACK;
      handoff = true;
      console.error(
        "guardrail: outbound web reply blocked. Terms: "
          + [...new Set(findings.map((f) => f.term))].join(", ")
          + ". Draft was: " + reply.slice(0, 500),
      );
      await alertDeskBlocked(findings, trace, "website chat");
    }
    root.setAttributes({ ...guardrails.screenAttrs(findings), "yaadly.web_chat.handoff": handoff });
    return json({ ok: true, reply: body, reference: meta.reference ?? null, handoff });
  };

  try {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
    if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: "Not configured." }, 500);

    const raw = await req.text();
    const isTwilio = (req.headers.get("content-type") ?? "").includes("application/x-www-form-urlencoded");
    // The website chat carries no signature: a visitor's browser has no
    // secret to sign with. What stands in for one is the Origin check and
    // the throttle further down, the same posture as yaad-enquiry. Detected
    // here, before the signature check, because Resend's secret being set
    // means every unsigned JSON body is otherwise refused.
    let isWeb = false;
    if (!isTwilio) {
      try { isWeb = s((JSON.parse(raw) as Record<string, unknown>).channel) === "web"; } catch (_) { /* not JSON, not web */ }
    }

    const sig = isTwilio ? await twilioSigned(req, raw)
      : isWeb ? { ok: true, checked: false }
      : await resendSigned(req, raw);
    root.setAttributes({ "yaadly.inbound.signature_checked": sig.checked, "yaadly.inbound.signature_ok": sig.ok });

    /* A Twilio request that was never checked is refused, 3 Sep 2026.
     *
     * checkTwilioSignature() reports {ok:true, checked:false} when no
     * TWILIO_AUTH_TOKEN was passed in. That is a deliberate fail-open in the
     * SIGNATURE MODULE and it stays there: it is a fact about what happened
     * ("nothing was verified"), and it lets that module be tested against a
     * throwaway secret. What was missing is anybody deciding what to DO about
     * that fact. This function did nothing, so an unsigned request walked
     * straight in.
     *
     * That was proportionate when the worst case was a junk enquiry row. It is
     * not any more. This endpoint runs with --no-verify-jwt, so the signature
     * is its ONLY door, and behind that door it can now call
     * agree_quote_via_whatsapp, agree_kickoff_pack_via_whatsapp,
     * choose_worker_via_whatsapp and approve_stage_via_whatsapp. The last of
     * those fires raise_worker_pay_invoice_on_stage_approval. The worst case
     * is a forged stage approval that raises a worker pay invoice.
     *
     * So it fails closed here, the same call the HubSpot webhook already
     * makes: "an endpoint that guards money does not get a development mode."
     * 503 rather than 403 because this is our misconfiguration, not the
     * sender's bad signature, and the two should not look the same in a log.
     * TWILIO_AUTH_TOKEN is set in production, so this changes nothing for real
     * traffic; it changes what happens on the day it goes missing, which used
     * to be silent.
     *
     * Scoped to isTwilio on purpose. The web chat sets checked:false too and
     * must keep passing: its door is the origin allowlist in web-chat.ts, not
     * a signature.
     */
    if (isTwilio && !sig.checked) {
      root.setAttributes({ "yaadly.inbound.outcome": "unverifiable" });
      console.error(
        "yaad-inbound: TWILIO_AUTH_TOKEN is not set, so this request could not be verified. Refusing every Twilio request until it is.",
      );
      return json({ error: "Inbound verification is not configured." }, 503);
    }

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

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    // ── the website chat door ────────────────────────────────────────────
    // Three checks stand in for authentication, in the order cheapest first.
    // The Origin header the browser sets, so a script on some other site
    // cannot post through here from a visitor's browser. The token shape, so
    // nothing but a widget-minted key ever becomes a thread key. And the
    // throttle, which is the one that actually holds against a script
    // outside a browser: every message through this door is a model call
    // somebody pays for, so it is counted per caller, per visitor and in
    // total, and refused with a plain sentence when a limit is hit.
    if (isWeb) {
      if (!originAllowed(req.headers.get("origin"))) {
        root.setAttributes({ "yaadly.inbound.outcome": "web_bad_origin" });
        return json({ error: "This chat only works on yaadly.co.uk." }, 403);
      }
      if (!visitorTokenOk(msg.from)) {
        root.setAttributes({ "yaadly.inbound.outcome": "web_bad_token" });
        return json({ error: "That did not send. Reload the page and try again." }, 400);
      }
      // A poll is the widget asking whether Monique has written back, not a
      // message: no model, no throttle row, one indexed read for the one
      // visitor whose token this is. The token is the proof; nothing else
      // can read these rows.
      let pollAfter: number | null = null;
      try {
        const j = JSON.parse(raw) as Record<string, unknown>;
        if (j.poll === true) pollAfter = Math.max(0, Number(j.after ?? 0) || 0);
      } catch (_) { /* not a poll */ }
      if (pollAfter !== null) {
        const [{ data: replies }, { data: th }] = await Promise.all([
          supabase.from("web_chat_replies").select("id,body,created_at")
            .eq("visitor_key", msg.from).gt("id", pollAfter).order("id", { ascending: true }).limit(20),
          supabase.from("intake_threads").select("human_handling")
            .eq("channel", "web").eq("from_addr", msg.from).maybeSingle(),
        ]);
        root.setAttributes({ "yaadly.inbound.outcome": "web_poll", "yaadly.web_chat.replies": (replies ?? []).length });
        return json({
          ok: true,
          replies: (replies ?? []).map((r) => ({ id: r.id, text: r.body, at: r.created_at })),
          human: th?.human_handling === true,
        });
      }

      if (!msg.text.trim()) return json({ error: "Type something first." }, 400);

      const WEB_PER_CALLER_PER_HOUR = 30;
      const WEB_PER_VISITOR_PER_HOUR = 40;
      const WEB_PER_HOUR = 600;
      const ipRaw = req.headers.get("cf-connecting-ip")
        ?? (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("yaadly-web-chat:" + ipRaw));
      const callerKey = Array.from(new Uint8Array(digest)).slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
      const hourAgo = new Date(Date.now() - 3600_000).toISOString();
      const [{ count: mine }, { count: theirs }, { count: everyone }] = await Promise.all([
        supabase.from("web_chat_attempts").select("id", { count: "exact", head: true }).eq("caller_key", callerKey).gt("created_at", hourAgo),
        supabase.from("web_chat_attempts").select("id", { count: "exact", head: true }).eq("visitor_key", msg.from).gt("created_at", hourAgo),
        supabase.from("web_chat_attempts").select("id", { count: "exact", head: true }).gt("created_at", hourAgo),
      ]);
      if ((mine ?? 0) >= WEB_PER_CALLER_PER_HOUR || (theirs ?? 0) >= WEB_PER_VISITOR_PER_HOUR) {
        root.setAttributes({ "yaadly.inbound.outcome": "web_throttled_caller" });
        return json({ error: "That is a lot of messages in one hour. Give it a little while, or carry on on WhatsApp." }, 429);
      }
      if ((everyone ?? 0) >= WEB_PER_HOUR) {
        root.setAttributes({ "yaadly.inbound.outcome": "web_throttled_global" });
        return json({ error: "The chat is busy right now. Carry on on WhatsApp and Monique will pick it up." }, 429);
      }
      await supabase.from("web_chat_attempts").insert({ caller_key: callerKey, visitor_key: msg.from });
      // Housekeeping, one call in twenty, never on the request's critical path.
      if (Math.random() < 0.05) { try { await supabase.rpc("web_chat_attempts_sweep"); } catch (_) { /* housekeeping only */ } }
    }

    // A worker mid "which job" answer, or a fresh photo from a number
    // linked to a published worker (worker_profiles.phone). Only on the
    // WhatsApp channel and only ahead of the client-intake pipeline below:
    // this endpoint's whole design assumes an inbound message is a client
    // describing a job, and a worker's evidence needs to be recognised and
    // diverted before that assumption ever applies to it.
    if (msg.channel === "whatsapp" && msg.from) {
      const { data: sess } = await supabase.from("wa_intake_sessions")
        .select("wa_id,answers,photo_count,updated_at").eq("wa_id", msg.from).maybeSingle();
      const evSession = sess && String((sess.answers as any)?._lane ?? "") === "evidence" ? sess : null;
      const reportSession = sess && String((sess.answers as any)?._lane ?? "") === "report_confirm" ? sess : null;
      const textUpdateSession = sess && String((sess.answers as any)?._lane ?? "") === "text_update" ? sess : null;

      // A worker answering the "send this draft, or write your own"
      // prompt. "1" means send exactly what was drafted; anything else
      // typed is read as their own version and that is what goes out
      // instead. Founder's own requirement, 31 Aug 2026, confirmed to the
      // worker to decide, not routed through anyone else first.
      if (reportSession && !msg.media.length && msg.text.trim()) {
        const a = reportSession.answers as any;
        const said = msg.text.trim();
        const overrideText = said === "1" ? String(a.draft_text ?? "") : said;
        const { error } = await supabase.rpc("relay_confirmed_report", {
          p_job: a.job_id, p_override_text: overrideText, p_ai_summary: a.ai_summary ?? "",
        });
        await supabase.from("wa_intake_sessions").delete().eq("wa_id", msg.from);
        root.setAttributes({ "yaadly.report_confirm.job": a.job_id, "yaadly.report_confirm.customised": said !== "1" });
        if (error) return twiml("That did not go through. Try again, or send it again in a moment.");
        return twiml(said === "1"
          ? "Sent to the client as drafted."
          : "Sent to the client, your own words.");
      }

      // A code prompt, shared by the "one job" and "several jobs" cases:
      // the code is always shown and always the answer asked for, never
      // assumed from a single option alone. Founder's own requirement, 31
      // Aug 2026: "There should be approval for it to link to the right
      // job where they ask for the confirmation of the job and the
      // confirmation of the code."
      const codePrompt = (choices: { id: string; title: string }[]) =>
        choices.length === 1
          ? `This looks like it is for ${choices[0].id} (${choices[0].title}). Reply with the code ${choices[0].id} to confirm, or tell us the right job.`
          : `Which job is this for? Reply with the code:  ${choices.map((c) => `${c.id} (${c.title})`).join("  ")}`;

      // The job-code answer to a freeform update that named more than one
      // active job (see the text_update lane further down). Same shape as
      // evSession's own code-confirm step, filing straight into evidence
      // rather than staging anything further: there is no photo to attach
      // context to here, the text itself was always the whole update.
      if (textUpdateSession && !msg.media.length && msg.text.trim()) {
        const a = textUpdateSession.answers as any;
        const choices: { id: string; title: string; stage: number }[] = a.job_choices ?? [];
        const pick = pickJobChoice(msg.text, choices);
        if (!pick) return twiml(`Sorry, that did not match a job. ${codePrompt(choices)}`);
        const { error } = await supabase.from("evidence").insert({
          job_id: pick.id, label: String(a.text ?? "").trim().slice(0, 1000), stage: pick.stage,
          kind: "work", uploaded_by: a.worker_email,
        });
        await supabase.from("wa_intake_sessions").delete().eq("wa_id", msg.from);
        root.setAttributes({ "yaadly.worker_update.job": pick.id, "yaadly.worker_update.outcome": error ? "insert_failed" : "filed" });
        return twiml(error
          ? "That did not save properly. Try again."
          : `Got it, on record for ${pick.id} (${pick.title}). The client hears about it once it is drafted.`);
      }

      if (evSession) {
        const answers = evSession.answers as any;
        const pending: PendingEvidence[] = answers.pending ?? [];
        const choices: { id: string; title: string; stage: number }[] = answers.job_choices ?? [];
        const workerEmail: string = answers.worker_email ?? "";
        // Set once the job code is confirmed, ahead of asking for context,
        // so a context reply never has to re-run pickJobChoice against
        // free text that was never meant to answer that question.
        const confirmedJob: { id: string; stage: number } | null =
          answers.confirmed_job ? { id: answers.confirmed_job, stage: answers.confirmed_stage } : null;
        const media = msg.media.filter((m) => m.mime.startsWith("image/") || m.mime.startsWith("video/"));

        if (media.length) {
          const items = (await Promise.all(media.map((m) => downloadAndStageEvidence(supabase, m.url, m.mime, msg.text)))).filter(Boolean) as PendingEvidence[];
          const next = [...pending, ...items];
          await supabase.from("wa_intake_sessions")
            .update({ answers: { ...answers, pending: next }, photo_count: next.length, updated_at: new Date().toISOString() })
            .eq("wa_id", msg.from);
          const prompt = confirmedJob ? "What do these show?" : codePrompt(choices);
          return twiml(items.length
            ? `Got that too, ${next.length} so far. ${prompt}`
            : `That one did not come through. ${prompt}`);
        }

        // The job is already confirmed and this reply is standing in for
        // context, not a job code: founder's own requirement, 31 Aug 2026,
        // a worker sending a photo or video with no caption gets asked what
        // it shows rather than it being filed as "Sent on WhatsApp" and
        // left for the client to guess at.
        if (confirmedJob) {
          const context = msg.text.trim().slice(0, 140);
          const described = context
            ? pending.map((p) => p.hasCaption ? p : { ...p, label: context, hasCaption: true })
            : pending;
          let filed = 0;
          for (const item of described) if (await finalizeEvidenceItem(supabase, confirmedJob.id, confirmedJob.stage, workerEmail, item)) filed++;
          await supabase.from("wa_intake_sessions").delete().eq("wa_id", msg.from);
          root.setAttributes({ "yaadly.evidence_intake.outcome": filed ? "filed_after_context" : "context_but_nothing_filed" });
          if (!filed) return twiml("Confirmed, but nothing saved properly. Try sending the photo again.");
          const filedLabel = await stageLabel(supabase, confirmedJob.id, confirmedJob.stage);
          let body = `Filed ${filed} item${filed === 1 ? "" : "s"} against ${confirmedJob.id}, ${filedLabel}. Keep them coming.`;
          const link = await mintPortalUploadLink(supabase, workerEmail, confirmedJob.id);
          if (link) body += ` For a longer video the portal takes a bigger file: ${link}`;
          return twiml(body);
        }

        const pick = pickJobChoice(msg.text, choices);
        if (!pick) {
          return twiml(`Sorry, that did not match a job. ${codePrompt(choices)}`);
        }

        // Only asked once per batch, and only when something still needs
        // it: an item that already carried a real caption keeps it exactly
        // as sent, never overwritten by a later answer meant for the others.
        if (pending.some((p) => !p.hasCaption)) {
          await supabase.from("wa_intake_sessions")
            .update({ answers: { ...answers, confirmed_job: pick.id, confirmed_stage: pick.stage }, updated_at: new Date().toISOString() })
            .eq("wa_id", msg.from);
          return twiml(`Got it, that's for ${pick.id}. What does this show? A line on what was done helps the client understand it faster.`);
        }

        let filed = 0;
        for (const item of pending) if (await finalizeEvidenceItem(supabase, pick.id, pick.stage, workerEmail, item)) filed++;
        await supabase.from("wa_intake_sessions").delete().eq("wa_id", msg.from);
        root.setAttributes({ "yaadly.evidence_intake.outcome": filed ? "filed_after_confirm" : "confirm_but_nothing_filed" });
        if (!filed) return twiml("Confirmed, but nothing saved properly. Try sending the photo again.");
        let body = `Filed ${filed} item${filed === 1 ? "" : "s"} against ${pick.id} (${pick.title}), stage ${pick.stage}. Keep them coming.`;
        const link = await mintPortalUploadLink(supabase, workerEmail, pick.id);
        if (link) body += ` For a longer video the portal takes a bigger file: ${link}`;
        return twiml(body);
      }

      if (sess && Date.now() - new Date(sess.updated_at as string).getTime() > 48 * 3600_000) {
        // A stale evidence session is dropped, not salvaged: there is no
        // job description to write down, only an orphaned photo nobody
        // answered for. Falls through and this message is read fresh.
        await supabase.from("wa_intake_sessions").delete().eq("wa_id", msg.from);
      }

      const evidenceMedia = msg.media.filter((m) => m.mime.startsWith("image/") || m.mime.startsWith("video/"));
      if (evidenceMedia.length) {
        const found = await lookupWorkerWithActiveJobs(supabase, msg.from);
        if (found) {
          const { email: workerEmail, jobs: activeJobs } = found;
          const items = (await Promise.all(evidenceMedia.map((m) => downloadAndStageEvidence(supabase, m.url, m.mime, msg.text)))).filter(Boolean) as PendingEvidence[];
          if (!items.length) {
            return twiml("That did not come through properly. Try sending it again, or if it is a longer video, use the portal instead.");
          }

          // Never filed on the strength of a single option alone, even
          // when there is only one job it could possibly be. The code is
          // always asked for and always checked; nothing moves onto a job
          // until the worker names it.
          await supabase.from("wa_intake_sessions").upsert({
            wa_id: msg.from,
            answers: { _lane: "evidence", worker_email: workerEmail, pending: items, job_choices: activeJobs },
            photo_count: items.length,
            updated_at: new Date().toISOString(),
          });
          return twiml(`Got it. ${codePrompt(activeJobs)}`);
        }
      }

      // A worker's plain reply, answering a client's comment. The mirror
      // of the client-comment lane below: exactly one job may be awaiting
      // this worker's answer for it to be read this way, never guessed
      // among several. "Awaiting" means the newest comment on that job is
      // still from the client, nobody has answered it yet.
      if (!msg.media.length && msg.text.trim()) {
        const found = await lookupWorkerWithActiveJobs(supabase, msg.from);
        if (found) {
          const activeJobs = found.jobs;
          const awaitingReply: { id: string; title: string; stage: number }[] = [];
          for (const j of activeJobs) {
            const { data: latest } = await supabase.from("evidence_comments")
              .select("from_role").eq("job_id", j.id)
              .order("created_at", { ascending: false }).limit(1).maybeSingle();
            if (latest?.from_role === "client") awaitingReply.push(j);
          }

          if (awaitingReply.length === 1) {
            const job = awaitingReply[0];
            // A code in the worker's reply ("P2 is done now") attributes
            // the answer to one specific photo rather than the whole
            // stage, when one is actually named; a plain reply with no
            // code stays exactly as it was, about the stage, since a
            // worker answering generally has not necessarily seen the
            // client's own point about one item.
            const { data: stageItems } = await supabase.from("evidence")
              .select("id, item_code").eq("job_id", job.id).eq("stage", job.stage);
            const namedItem = pickEvidenceItem(msg.text, stageItems ?? []);
            await supabase.from("evidence_comments").insert({
              job_id: job.id, stage: job.stage, from_role: "worker", origin: "whatsapp",
              body: msg.text.trim().slice(0, 1000), evidence_id: namedItem?.id ?? null,
            });
            root.setAttributes({ "yaadly.evidence_comment.job": job.id, "yaadly.evidence_comment.from": "worker" });

            const { data: jobRow } = await supabase.from("jobs")
              .select("client_phone").eq("id", job.id).maybeSingle();
            let notified = false;
            if (jobRow?.client_phone) {
              notified = await sendWhatsAppTo(
                String(jobRow.client_phone),
                `The worker replied on ${job.id} (${job.title}): "${msg.text.trim().slice(0, 300)}"\n\nReply with the code ${job.id} to approve, or say more and we will pass it on.`,
                trace,
              );
            }
            root.setAttributes({ "yaadly.evidence_comment.client_notified": notified });
            return twiml(notified
              ? `Got it, passed on to the client on ${job.id}.`
              : `Got it, on record against ${job.id}. We could not reach the client directly just now, but it is saved.`);
          }
        }
      }

      // Confirming a Quote Pack by replying with the job's own code. 2 Sep
      // 2026, founder's own correction: a quote used to go straight from
      // "submitted" to bookable the moment the client replied once, with
      // nothing ever asking the worker to agree to anything. Client and
      // worker each confirm the quote itself now, same shape as the
      // Kickoff Pack block just below, before the job's booking block will
      // recognise the price as open. MUST run before that block: a quote
      // still sitting at 'submitted' is not a booking candidate any more
      // (see choose_worker_via_whatsapp), so an unconfirmed reply has to be
      // claimed here or it is lost, not fall through and refuse. Runs
      // before the Kickoff Pack block too, though the two never actually
      // compete for the same reply: a quote is only ever a candidate here
      // OR there, never both, since agree_quote_via_whatsapp() moves it out
      // of 'submitted' the moment both sides are in.
      //
      // Re-applied 2 Sep 2026: found missing from the live deployed
      // function after another session's own deploy overwrote this block
      // with an on-disk copy that predated it. Read the file back from
      // disk before trusting it is what got tested, not just what was
      // written once.
      if (!msg.media.length && msg.text.trim()) {
        const { data: openQuotes } = await supabase.from("job_quotes")
          .select("id, job_id, worker_email").eq("status", "submitted");
        const quotes = (openQuotes ?? []) as { id: string; job_id: string; worker_email: string }[];

        const tail = msg.from.replace(/\D/g, "").slice(-9);
        const jobIds = [...new Set(quotes.map((q) => q.job_id))];
        const { data: jobRows } = jobIds.length
          ? await supabase.from("jobs").select("id, title, stage, client_phone").in("id", jobIds)
          : { data: [] as { id: string; title: string; stage: number; client_phone: string | null }[] };
        const jobsById = new Map((jobRows ?? []).map((j: any) => [j.id, j]));

        const workerEmails = [...new Set(quotes.map((q) => q.worker_email))];
        const { data: workerRows } = workerEmails.length
          ? await supabase.from("worker_profiles").select("worker_email, phone").in("worker_email", workerEmails)
          : { data: [] as { worker_email: string; phone: string | null }[] };
        const phoneByWorker = new Map((workerRows ?? []).map((w: any) => [String(w.worker_email).toLowerCase(), w.phone]));

        const quoteIds = quotes.map((q) => q.id);
        const { data: agreementRows } = quoteIds.length
          ? await supabase.from("quote_agreements").select("quote_id, side").in("quote_id", quoteIds)
          : { data: [] as { quote_id: string; side: string }[] };
        const confirmedSides = new Set((agreementRows ?? []).map((a: any) => `${a.quote_id}:${a.side}`));

        const clientCandidates = quotes
          .filter((q) => !confirmedSides.has(`${q.id}:client`))
          .map((q) => jobsById.get(q.job_id))
          .filter((j: any) => j && String(j.client_phone ?? "").replace(/\D/g, "").slice(-9) === tail);

        const workerCandidates: { id: string; title: string; stage: number }[] = [];
        for (const q of quotes) {
          if (confirmedSides.has(`${q.id}:worker`)) continue;
          const workerTail = String(phoneByWorker.get(String(q.worker_email).toLowerCase()) ?? "").replace(/\D/g, "").slice(-9);
          const j = jobsById.get(q.job_id);
          if (j && workerTail && workerTail === tail) workerCandidates.push(j);
        }

        const quoteCandidates = [...clientCandidates, ...workerCandidates.filter((j) => !clientCandidates.some((c: any) => c.id === j.id))];
        const quoteTarget = matchApprovingJob(msg.text, quoteCandidates as any);
        if (quoteTarget) {
          const { data: qResult, error: qErr } = await supabase.rpc("agree_quote_via_whatsapp", { p_job: quoteTarget.id, p_phone: msg.from });
          root.setAttributes({ "yaadly.whatsapp_quote_confirm.job": quoteTarget.id, "yaadly.whatsapp_quote_confirm.outcome": qErr ? "refused" : "confirmed" });
          if (qErr) return twiml(`That did not go through: ${qErr.message}`);
          const row = Array.isArray(qResult) ? qResult[0] : qResult;
          // Named the real, working alternative rather than a vague
          // "ask Yaadly": the portal button next to this exact price is
          // the only place that request can actually be made from here.
          if (row?.both_confirmed) {
            return twiml(row.agreed_side === "client"
              ? `Confirmed. Both sides have agreed the price for ${quoteTarget.title}. Reply ${quoteTarget.id} again to book them, no Kickoff Pack needed. Want the fuller document first instead? Sign in to your Yaadly portal and tap "Get a Kickoff Pack first" next to this price.`
              : `Confirmed. Both sides have agreed the price for ${quoteTarget.title}, ready for the client to book.`);
          }
          return twiml(`Confirmed on your side for ${quoteTarget.title}. Waiting on ${row?.agreed_side === "worker" ? "the client" : "the worker"} to reply the same code before this can move on.`);
        }
      }

      // Stage 6: confirming a Kickoff Pack by replying with the job's own
      // code. Founder's own correction, 1 Sep 2026, live: a worker's whole
      // surface is WhatsApp by design (CLAUDE.md §9 - "the worker web
      // surface stays thin on purpose"), so confirming a pack cannot be a
      // portal-only button the way it was drafted a few hours earlier the
      // same night (20260901f). Works for either side's phone, same as
      // every other job-code reply in this function: whichever side
      // replies with the code confirms their own, via
      // agree_kickoff_pack_via_whatsapp() (20260901i), which re-derives
      // which side this phone actually is rather than trusting the match
      // below for anything but which job was meant.
      //
      // MUST run before the booking block below. Both blocks recognise the
      // exact same reply (a bare job code from the client's phone), and the
      // booking block used to run first - found live, testing this for
      // real: a client confirming their side for the first time got routed
      // into choose_worker_via_whatsapp() instead, which correctly refused
      // ("choose unlocks once this worker's Kickoff Pack is confirmed by
      // both sides") since nothing had been confirmed yet, but the client's
      // own confirmation was never recorded at all. Once a pack is fully
      // confirmed this block's own candidate query stops matching it (the
      // pack no longer needs confirming), so the identical reply correctly
      // falls through to the booking block on a second send - the intended
      // two-step shape, which only works with this block going first.
      if (!msg.media.length && msg.text.trim()) {
        const tail = msg.from.replace(/\D/g, "").slice(-9);

        // Plain queries and a manual join in JS, not an embedded-resource
        // select: found live, testing this for real, that
        // .select("id, jobs!inner(...)").not("jobs.client_phone", "is",
        // null) was silently returning candidates that never matched
        // anything (the embed resolved in a shape .map((p) => p.jobs)
        // did not expect), so a correctly-confirmed pack never showed up
        // as a candidate and every reply fell through to the booking
        // block below. No other block in this file uses an embed; this
        // one should not have either.
        const { data: approvedPacks } = await supabase.from("kickoff_packs")
          .select("id, job_id, quote_id, rev").eq("status", "approved");
        const packs = (approvedPacks ?? []) as { id: string; job_id: string; quote_id: string | null; rev: number | null }[];

        // A pack this phone's side has already confirmed is not a
        // candidate for THIS block - found live, testing this for real:
        // once both sides confirm, the identical reply kept matching here
        // anyway, agree_kickoff_pack_via_whatsapp() correctly refused
        // ("No Kickoff Pack on this job is waiting on your confirmation"),
        // and the reply never reached the booking block below at all. The
        // candidate list has to know the same thing the RPC already
        // enforces, or a confirmed pack can never fall through to booking.
        const packIds = packs.map((p) => p.id);
        const { data: agreementRows } = packIds.length
          ? await supabase.from("kickoff_pack_agreements").select("pack_id, rev, side").in("pack_id", packIds)
          : { data: [] as { pack_id: string; rev: number; side: string }[] };
        const confirmedSides = new Set(
          (agreementRows ?? []).map((a: any) => `${a.pack_id}:${a.rev}:${a.side}`),
        );

        const jobIds = [...new Set(packs.map((p) => p.job_id))];
        const { data: jobRows } = jobIds.length
          ? await supabase.from("jobs").select("id, title, stage, client_phone").in("id", jobIds)
          : { data: [] as { id: string; title: string; stage: number; client_phone: string | null }[] };
        const jobsById = new Map((jobRows ?? []).map((j: any) => [j.id, j]));

        const quoteIds = [...new Set(packs.filter((p) => p.quote_id).map((p) => p.quote_id as string))];
        const { data: quoteRows } = quoteIds.length
          ? await supabase.from("job_quotes").select("id, worker_email").in("id", quoteIds)
          : { data: [] as { id: string; worker_email: string }[] };
        const workerEmailByQuote = new Map((quoteRows ?? []).map((q: any) => [q.id, q.worker_email]));

        const clientCandidates = packs
          .filter((p) => !confirmedSides.has(`${p.id}:${p.rev ?? 1}:client`))
          .map((p) => jobsById.get(p.job_id))
          .filter((j: any) => j && String(j.client_phone ?? "").replace(/\D/g, "").slice(-9) === tail);

        const workerJobIds = new Set<string>();
        const workerCandidates: { id: string; title: string; stage: number }[] = [];
        for (const p of packs) {
          if (confirmedSides.has(`${p.id}:${p.rev ?? 1}:worker`)) continue;
          const workerEmail = p.quote_id ? workerEmailByQuote.get(p.quote_id) : undefined;
          if (!workerEmail) continue;
          const { data: wp } = await supabase.from("worker_profiles")
            .select("phone").ilike("worker_email", workerEmail).maybeSingle();
          const workerTail = String(wp?.phone ?? "").replace(/\D/g, "").slice(-9);
          const j = jobsById.get(p.job_id);
          if (j && workerTail && workerTail === tail && !workerJobIds.has(j.id)) {
            workerJobIds.add(j.id);
            workerCandidates.push(j);
          }
        }

        const kickoffCandidates = [...clientCandidates, ...workerCandidates.filter((j) => !clientCandidates.some((c: any) => c.id === j.id))];
        const kickoffTarget = matchApprovingJob(msg.text, kickoffCandidates as any);
        if (kickoffTarget) {
          // The job named in the reply, not a global "which phone is this"
          // search: a phone with more than one pack pending across
          // different jobs must still resolve the one it actually typed.
          const { data: kResult, error: kErr } = await supabase.rpc("agree_kickoff_pack_via_whatsapp", { p_job: kickoffTarget.id, p_phone: msg.from });
          root.setAttributes({ "yaadly.whatsapp_kickoff_confirm.job": kickoffTarget.id, "yaadly.whatsapp_kickoff_confirm.outcome": kErr ? "refused" : "confirmed" });
          if (kErr) return twiml(`That did not go through: ${kErr.message}`);
          const row = Array.isArray(kResult) ? kResult[0] : kResult;
          // The client's own next action has to be spelled out here: found
          // live, testing this for real - "ready to be chosen" told the
          // client nothing had gone wrong, but nothing told them what to
          // do next, and choosing is a second, separate reply with the
          // same code, not something that happens on its own. Worker
          // confirmations get no such line: choosing is the client's
          // action alone, and telling a worker to "reply again to book"
          // would be false.
          if (row?.both_confirmed) {
            return twiml(row.agreed_side === "client"
              ? `Confirmed. Both sides have signed off on the Kickoff Pack for ${kickoffTarget.title}. Reply ${kickoffTarget.id} again to book them.`
              : `Confirmed. Both sides have signed off on the Kickoff Pack for ${kickoffTarget.title}, ready for the client to choose.`);
          }
          return twiml(`Confirmed on your side for ${kickoffTarget.title}. Waiting on the other side now, you'll hear the moment they confirm.`);
        }
      }

      // Stage 6: a client booking a worker by replying with the job's own
      // code, rather than tapping Choose in the portal. Same guard as the
      // approval block below and the same reason: every plain text message
      // a client sends passes through here, so only an exact code match is
      // trusted, never a bare "yes". A job with more than one open price at
      // once refuses the reply rather than guessing which one was meant.
      //
      // This calls choose_worker_via_whatsapp(), which defers entirely to
      // _do_choose_worker() for whether booking is actually allowed. Since
      // 1 Sep 2026 that gate is the chosen quote's own Kickoff Pack having
      // both_confirmed_at set (20260901f), not a scope agreement - fixed
      // the same night (20260901m) after this door was found live still
      // looking for a job_quotes status ('submitted') and a readiness
      // check (scope_agreements) that both predate the rework and can
      // never be true once a quote is actually ready to book. If the pack
      // is not yet confirmed by both sides, the RPC raises its own honest
      // exception and that is what the client reads below, rather than a
      // separate "pending" branch pretending to know why. Runs AFTER the
      // Kickoff Pack confirm block above - see that block's own comment
      // for why the order matters.
      if (!msg.media.length && msg.text.trim()) {
        const { data: openToBook } = await supabase.from("jobs")
          .select("id, title, stage, client_phone")
          .eq("status", "quoted")
          .not("client_phone", "is", null);
        const bookTail = msg.from.replace(/\D/g, "").slice(-9);
        const mineToBook = (openToBook ?? []).filter((j: any) =>
          String(j.client_phone ?? "").replace(/\D/g, "").slice(-9) === bookTail);

        const bookTarget = matchApprovingJob(msg.text, mineToBook);
        if (bookTarget) {
          const { error } = await supabase.rpc("choose_worker_via_whatsapp", { p_job: bookTarget.id, p_phone: msg.from });
          root.setAttributes({ "yaadly.whatsapp_quote_accept.job": bookTarget.id, "yaadly.whatsapp_quote_accept.outcome": error ? "refused" : "accepted" });
          if (error) return twiml(`That did not go through: ${error.message}`);
          return twiml(`Booked. ${bookTarget.title} is on. A message with the price and how payment works is coming through next.`);
        }
      }

      // Stage 6: a client approving a stage by replying, rather than
      // tapping Approve in the portal. Unlike the worker lanes above, this
      // one is not gated behind an open multi-turn session: every plain
      // text message a client ever sends passes through it, so it only
      // ever acts on an exact, close to uncoincidental match against a
      // job's own code, the same code yaad-notify-client's evidence_landed
      // message tells them to reply with. No "yes", no ordinal number, no
      // title guess here: those are safe conveniences inside a session
      // that is already known to be about picking a job, and this is not
      // that. Anything that does not contain a code it recognises falls
      // straight through to the ordinary pipeline below, unrecognised as
      // an approval rather than guessed at.
      if (!msg.media.length && msg.text.trim()) {
        const { data: awaiting } = await supabase.from("jobs")
          .select("id, title, stage, client_phone, worker_email")
          .eq("status", "evidence")
          .not("client_phone", "is", null);
        const tail = msg.from.replace(/\D/g, "").slice(-9);
        const mine = (awaiting ?? []).filter((j: any) =>
          String(j.client_phone ?? "").replace(/\D/g, "").slice(-9) === tail);

        const target = matchApprovingJob(msg.text, mine);
        if (target) {
          const { error } = await supabase.rpc("approve_stage_via_whatsapp", { p_job: target.id, p_phone: msg.from });
          root.setAttributes({ "yaadly.whatsapp_approval.job": target.id, "yaadly.whatsapp_approval.outcome": error ? "refused" : "approved" });
          if (error) return twiml(`That did not go through: ${error.message}`);
          const label = await stageLabel(supabase, target.id, target.stage ?? 1);
          return twiml(`Approved. ${label} of ${target.title} is confirmed, and the worker is paid for it. Nothing else to do.`);
        }

        // Not a code, and exactly one job is waiting on this client's
        // review: read as a comment on that evidence, not a new job
        // description. Founder's own requirement, 31 Aug 2026: a client
        // who is not satisfied should have a way to say so, and it should
        // reach the worker to answer, not vanish or get misread as
        // somebody describing a fresh problem.
        if (mine.length === 1) {
          const job = mine[0] as { id: string; title: string; stage: number; worker_email: string | null };
          // Same attribution as the worker's reply above: "P2 has a gap
          // still" names one photo, a plain complaint stays about the
          // whole stage, exactly as it always has.
          const { data: stageItems } = await supabase.from("evidence")
            .select("id, item_code").eq("job_id", job.id).eq("stage", job.stage);
          const namedItem = pickEvidenceItem(msg.text, stageItems ?? []);
          await supabase.from("evidence_comments").insert({
            job_id: job.id, stage: job.stage, from_role: "client", body: msg.text.trim().slice(0, 1000),
            evidence_id: namedItem?.id ?? null,
          });
          root.setAttributes({ "yaadly.evidence_comment.job": job.id, "yaadly.evidence_comment.from": "client" });

          let notified = false;
          if (job.worker_email) {
            const { data: worker } = await supabase.from("worker_profiles")
              .select("phone").ilike("worker_email", job.worker_email).maybeSingle();
            if (worker?.phone) {
              notified = await sendWhatsAppTo(
                String(worker.phone),
                `A note from the client on ${job.id} (${job.title}), stage ${job.stage}: "${msg.text.trim().slice(0, 300)}"\n\nReply to this number to answer, and it goes straight back to them.`,
                trace,
              );
            }
          }
          root.setAttributes({ "yaadly.evidence_comment.worker_notified": notified });
          return twiml(notified
            ? `Got it, passed on to the worker on ${job.id}. They'll get back to you.`
            : `Got it, on record against ${job.id}. We could not reach the worker directly just now, but it is saved and Yaadly can follow up.`);
        }
      }

      // A worker's own freeform update, unclaimed by anything more
      // specific above: a reply to yaad-daily-checkin most days, but this
      // is the general door, not a check-in-only one. Voice transcribed
      // right here, locally, so a worker's own voice note never falls
      // through into the client-intake pipeline below and gets read as a
      // stranger describing a brand new job (nothing above this point
      // transcribes, and until this lane existed nothing needed to).
      //
      // Filed straight into evidence, no new pipeline: composeEvidenceReport
      // (yaad-notify-client) already reads evidence.label text for the
      // stage, photo or not, and schedule_evidence_landed_notify() already
      // fires on any insert into evidence, not only one carrying a photo.
      // The worker still confirms the drafted report before the client
      // ever sees it, same as a photo update always has.
      if (!msg.media.length || msg.media.every((m) => m.mime.startsWith("audio/"))) {
        let text = msg.text.trim();
        if (!text) {
          const voiceNote = msg.media.find((m) => m.mime.startsWith("audio/"));
          if (voiceNote) text = (await transcribeUrl(voiceNote.url, trace)).trim();
        }
        if (text) {
          const found = await lookupWorkerWithActiveJobs(supabase, msg.from);
          if (found && found.jobs.length === 1) {
            const job = found.jobs[0];
            const { error } = await supabase.from("evidence").insert({
              job_id: job.id, label: text.slice(0, 1000), stage: job.stage,
              kind: "work", uploaded_by: found.email,
            });
            root.setAttributes({ "yaadly.worker_update.job": job.id, "yaadly.worker_update.outcome": error ? "insert_failed" : "filed" });
            return twiml(error
              ? "That did not save properly. Try sending it again."
              : `Got it, on record for ${job.id}. The client hears about it once it is drafted.`);
          }
          if (found && found.jobs.length > 1) {
            await supabase.from("wa_intake_sessions").upsert({
              wa_id: msg.from,
              answers: { _lane: "text_update", worker_email: found.email, text, job_choices: found.jobs },
              photo_count: 0,
              updated_at: new Date().toISOString(),
            });
            return twiml(`Got it. ${codePrompt(found.jobs)}`);
          }
        }
      }
    }

    // Voice first: it is how most of these actually arrive.
    let spoken = false;
    const voice = msg.media.find((m) => m.mime.startsWith("audio/") || (!m.mime && !msg.text));
    if (!msg.text && voice) {
      const said = await transcribeUrl(voice.url, trace);
      if (said) { msg.text = said; spoken = true; }
    }
    if (!msg.text) msg.text = "[message with no readable text, review manually]";

    // An intake is a conversation. Somebody writes "roof a leak", then two
    // minutes later "it in Portland". Read against the whole thread or the
    // second line is meaningless and they get asked the same thing twice.
    //
    // Twelve hours, because a client abroad answers when they wake up, and a
    // brand new problem a week later is genuinely a new job.
    const THREAD_HOURS = 12;
    const threadKey = { channel: msg.channel, from_addr: msg.from || "unknown" };
    const priorQ = await supabase.from("intake_threads")
      .select("job_id,transcript,turns,last_at,stage,human_handling")
      .eq("channel", threadKey.channel).eq("from_addr", threadKey.from_addr)
      .maybeSingle();
    // let, not const: the website-chat adoption below swaps in the web
    // conversation as this number's prior thread, so the ordinary pipeline
    // continues it rather than starting over.
    let prior = priorQ.data as {
      job_id: string; transcript: string; turns: number; last_at: string; stage: string; human_handling: boolean;
    } | null;
    // A thread already at 'done' produced its job; nothing left to gather.
    // A reply about THAT job (approving a stage, replying to a comment) is
    // already intercepted above, before this point, by its own lane. So a
    // message that reaches here with the prior thread 'done' is not a reply
    // about the old job, it is the next thing this number has said, and the
    // comment above this block has called that "genuinely a new job" since
    // before this line ever enforced it. Found live, 1 Sep 2026: a second,
    // unrelated job sent within the window read back a stale summary of the
    // first one and never started gathering the second at all.
    const continuing = !!prior && prior.stage !== "done" &&
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

    // Monique has this thread. The assistant stands down: no model call, no
    // fresh question, no read-back. What they say is still kept word for word
    // and still lands on her phone, because a person waiting on a person
    // should never find out later that their extra detail went nowhere.
    // Deliberately checked before the 12 hour conversation window: a human
    // conversation runs on the humans' clock, not the bot's, and the flag
    // outliving the window is the point. Only the desk's "Hand back to the
    // assistant" button clears it; nothing in this function ever does.
    if (prior?.human_handling === true) {
      const heldJobId = String(prior.job_id);
      const before = String(prior.transcript ?? "");
      const heldRepeat = before.trimEnd().endsWith(thisTurn.trim()) && thisTurn.trim().length > 0;
      const heldTranscript = heldRepeat ? before.slice(-8000) : `${before}\n\n${thisTurn}`.slice(-8000);
      if (msg.media.length) {
        await keepMedia(supabase as unknown as MediaWriter, heldJobId, msg.media, Number(prior.turns) * 10, trace);
      }
      await supabase.from("intake_threads").upsert({
        channel: threadKey.channel,
        from_addr: threadKey.from_addr,
        job_id: heldJobId,
        transcript: heldTranscript,
        turns: Number(prior.turns) + 1,
        stage: String(prior.stage ?? "gathering"),
        last_at: new Date().toISOString(),
      }, { onConflict: "channel,from_addr" });
      try {
        const { data: st } = await supabase.from("app_settings").select("value").eq("key", "ntfy_topic").single();
        if (st?.value) {
          await fetch(`https://ntfy.sh/${st.value}`, {
            method: "POST",
            headers: { Title: `They wrote again: ${msg.channel}`, Priority: "high", Tags: "raising_hand" },
            body: `${heldJobId}: waiting on you. The assistant is standing down until the desk hands the thread back.`,
            signal: AbortSignal.timeout(4000),
          });
        }
      } catch (_) { /* never let a notification break intake */ }
      root.setAttributes({ "yaadly.inbound.outcome": "held_for_human", "yaadly.job.id": heldJobId });
      if (isTwilio) {
        return twiml("Monique has this and is coming back to you herself. I have added your message so she sees it.");
      }
      if (isWeb) {
        // On the web there is no reply lane back to this widget, so the
        // honest sentence is where she will actually answer: WhatsApp.
        return webSay(
          "Monique has this and is picking it up herself. I have added your message so she sees it. Her reply will show up here, or carry on with her on WhatsApp if you are leaving this page.",
          { reference: heldJobId, handoff: true },
        );
      }
      return json({ ok: true, jobId: heldJobId, heldForHuman: true });
    }

    // A visitor arriving on WhatsApp from the website chat, with the
    // reference the widget put in their first message. Adopt the web thread
    // rather than start a fresh one: the transcript carries across and the
    // job they were describing keeps its code. This is what makes "you will
    // not have to say it twice" true.
    //
    // Who answers next is the founder's call, 2 Sep 2026, on watching it
    // live: "AI should try help in the whatsapp chat before get passed to
    // me". So the assistant carries on here, reading the whole web
    // conversation, with a fresh three-turn allowance, and hands over by the
    // same rules as any WhatsApp thread. The one exception is a web chat
    // Monique had already personally replied in: that conversation is hers,
    // and it stays hers on this number.
    if (msg.channel === "whatsapp" && msg.from) {
      const typedRef = webReferenceIn(msg.text);
      if (typedRef) {
        // Exact first. Then tolerant: the founder's own first live test (2
        // Sep 2026) typed the reference one digit short, and a 13 digit
        // code that has to be perfect is a code that will be wrong. Among
        // the web threads of the last week, one whose code starts with what
        // was typed, or whose code the typed one starts with, is the
        // conversation they mean, provided exactly one fits. Two fitting is
        // ambiguous and falls through to a fresh chat rather than a guess.
        let webThread: { job_id: string; transcript: string; turns: number; stage: string } | null = null;
        const { data: exact } = await supabase.from("intake_threads")
          .select("job_id,transcript,turns,stage")
          .eq("channel", "web").eq("job_id", typedRef).maybeSingle();
        if (exact) webThread = exact;
        else {
          const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
          const { data: recent } = await supabase.from("intake_threads")
            .select("job_id,transcript,turns,stage")
            .eq("channel", "web").gt("last_at", weekAgo).limit(200);
          const near = (recent ?? []).filter((t) =>
            String(t.job_id).startsWith(typedRef) || typedRef.startsWith(String(t.job_id)));
          if (near.length === 1) webThread = near[0];
          root.setAttributes({ "yaadly.web_adopt.near_matches": near.length });
        }
        const ref = webThread?.job_id ?? typedRef;
        if (webThread) {
          const { count: herReplies } = await supabase.from("web_chat_replies")
            .select("id", { count: "exact", head: true }).eq("job_id", ref);
          const hers = (herReplies ?? 0) > 0;
          const webTranscript = String(webThread.transcript ?? "");
          root.setAttributes({ "yaadly.inbound.outcome": "web_thread_adopted", "yaadly.job.id": ref, "yaadly.web_adopt.hers": hers });

          if (hers) {
            // She was already talking to them in the web chat. Keep it hers:
            // record this message on the carried thread, hold it, tell her.
            const carried = `${webTranscript}\n\n[Continued on WhatsApp]\n${thisTurn}`.slice(-8000);
            await supabase.from("intake_threads").upsert({
              channel: threadKey.channel, from_addr: threadKey.from_addr, job_id: ref,
              transcript: carried, turns: Number(webThread.turns) + 1,
              stage: String(webThread.stage ?? "gathering"), last_at: new Date().toISOString(),
              human_handling: true,
            }, { onConflict: "channel,from_addr" });
            await supabase.from("jobs").update({ client_phone: msg.from }).eq("id", ref);
            if (msg.media.length) {
              await keepMedia(supabase as unknown as MediaWriter, ref, msg.media, Number(webThread.turns) * 10, trace);
            }
            try {
              const { data: st } = await supabase.from("app_settings").select("value").eq("key", "ntfy_topic").single();
              if (st?.value) {
                await fetch(`https://ntfy.sh/${st.value}`, {
                  method: "POST",
                  headers: { Title: "Your web chat moved to WhatsApp", Priority: "high", Tags: "raising_hand" },
                  body: `${ref}: the person you were replying to on the website has carried on by WhatsApp. The whole conversation is on the thread, held for you.`,
                  signal: AbortSignal.timeout(4000),
                });
              }
            } catch (_) { /* never let a notification break intake */ }
            return twiml(`Thanks, I have your chat from the website here as ${ref}, so there is no need to say any of it again. Monique was already on this one and will come back to you on this number.`);
          }

          // Otherwise the assistant carries on. The web conversation becomes
          // this number's prior thread, turns reset so the three-turn handoff
          // counts afresh from here, and the pipeline below reads the whole
          // thing and replies as it would to any continuing conversation.
          // The job row is updated by that same pipeline, which on WhatsApp
          // writes this number into client_phone, the first proven way to
          // reach them.
          prior = {
            job_id: ref,
            transcript: `${webTranscript}\n\n[Continued on WhatsApp]`,
            turns: 0,
            last_at: new Date().toISOString(),
            stage: String(webThread.stage ?? "gathering") === "done" ? "confirming" : String(webThread.stage ?? "gathering"),
            human_handling: false,
          };
        }
      }
    }

    // A repeat of the immediately preceding turn, word for word, is not new
    // information: it is WhatsApp retrying, or someone impatient tapping
    // send twice. Folding it into the transcript anyway made the model read
    // an increasingly repetitive conversation and increasingly convince
    // itself there was a great deal to reason through before answering,
    // until it ran out of room mid-thought and never answered at all.
    // Caught live, 1 Sep 2026: the same opening line sent three times over,
    // each one costing more of the model's own token budget than the last
    // for content it had already read. Recorded once, not once per repeat.
    const priorTranscript = continuing ? String(prior!.transcript ?? "") : "";
    const isRepeat = continuing && priorTranscript.trimEnd().endsWith(thisTurn.trim()) && thisTurn.trim().length > 0;
    const transcript = !continuing
      ? thisTurn
      : isRepeat
        ? priorTranscript.slice(-8000)
        : `${priorTranscript}\n\n${thisTurn}`.slice(-8000);

    const card = await readTheJob(transcript, trace);
    const enough = card?.enough === true;
    // wants_human is one model call's read of one message, and when the call
    // fails outright (it did, live, 2 Sep 2026, on "Can I talk to a real
    // person please" from the website chat) the card is null and the person
    // who asked for a person gets the generic opener instead. Same backstop
    // shape as saidConfirmed below: a plain word match on THIS turn's own
    // text that can only ever add a true the model missed.
    const saidHuman =
      /\b(speak|talk|chat|deal)\s+(to|with)\s+(a\s+|an\s+)?(real\s+|actual\s+|live\s+)?(person|human|someone|somebody|monique|agent|operator)\b|\b(real|actual|live)\s+(person|human)\b|\b(are you|is this) a (bot|robot|machine)\b/i
        .test(msg.text);
    const wantsHuman = card?.wants_human === true || saidHuman;

    // Three stages, and the client owns the last one. The assistant may decide
    // it has enough; only they can say it is right and complete.
    const wasStage = continuing ? String(prior!.stage ?? "gathering") : "gathering";
    // card.confirmed is one model call's read of one message, and it can miss
    // an unambiguous yes the way any single classification can. Found live,
    // 1 Sep 2026: "Monique Sewell-Bennett, [email]. Yes, that's everything, go
    // ahead." came back confirmed: false, the client was told nothing more
    // than a plain thank you, and the portal link never went out; the job
    // still wrote to the database because the row write is unconditional
    // every turn, so it looked finished from the data alone while the
    // conversation logic still thought it was waiting. A plain word match on
    // THIS turn's own text is the backstop under the model, the same shape
    // wantsOut() already is for "cancel": only ever adds a true the model
    // missed, on this turn's own words, never overrides a model that read it
    // right. A false positive here costs nothing worse than the "already
    // finished and still talking" path already handles for a late detail.
    const saidConfirmed = /\b(yes|yeah|yep|yup|correct|that'?s\s+(it|right|correct|all\s+correct|everything)|go\s*ahead|all\s+good|sounds\s+good|good\s+to\s+go|confirmed|perfect)\b/i
      .test(msg.text.trim());
    const confirmedNow = enough && wasStage === "confirming" && (card?.confirmed === true || saidConfirmed);
    const stage = confirmedNow || wasStage === "done" ? "done"
      : enough ? "confirming"
      : "gathering";

    // JOB-WHAT-… helps nobody. Name the door it came through.
    const CODE: Record<string, string> = { whatsapp: "WA", sms: "SMS", email: "EMAIL", web: "WEB", generic: "WEB" };
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

    // On email the sender address IS the client's email: they had to control
    // that mailbox to send from it, so binding it straight to the job is
    // proof, not trust. On every other channel, an email the model read out
    // of the message text is only ever a claim someone typed, and binding it
    // directly would let a typo, or somebody else's real address entered on
    // purpose, hand that stranger the job the next time they sign in and
    // sign the current Client Guidelines for any reason of their own,
    // anywhere in the product, with the actual client locked out and nothing
    // to click their way back in with. yaad-post-job's draft mode and the
    // deleted Meta webhook both held this line already; found live, 1 Sep
    // 2026, that this channel never had. The portal link still goes to
    // whatever address they gave, same as before: sending them a link proves
    // nothing about who reads it. Attaching client_email to the row is what
    // proves it, and that only happens through claim_code_as_me(), when
    // someone signs in with that address and the code matches.
    const provenEmail = msg.channel === "email" ? bareEmail(msg.from) : "";
    const typedEmail = msg.channel !== "email" ? s(card?.client_email).toLowerCase() : "";

    const descr = [
      s(card?.scope) || transcript,
      s(card?.access_note) ? `Access: ${s(card.access_note)}` : "",
      Array.isArray(card?.questions) && card.questions.filter(Boolean).length
        ? `Worth confirming before quoting: ${card.questions.filter(Boolean).map(s).join("; ")}` : "",
      "",
      `In their own words:\n${transcript}`,
      spoken ? "Source: voice note, transcribed automatically. The wording is theirs." : "",
      msg.channel === "web"
        ? `Arrived by the chat on yaadly.co.uk${turns > 1 ? `, over ${turns} messages` : ""}. No contact details yet: the visitor is anonymous until they carry on by WhatsApp or finish setting up.`
        : `Arrived by ${msg.channel} from ${msg.from || "an unknown sender"}${turns > 1 ? `, over ${turns} messages` : ""}.`,
      enough ? "" : "[Still gathering. The assistant has asked for what is missing and this stays a draft until it comes back.]",
      lostMedia ? `[${lostMedia} attachment${lostMedia > 1 ? "s" : ""} came through but could not be stored. Ask them to send again.]` : "",
      typedEmail
        ? `[EMAIL GIVEN, NOT YET ATTACHED. ${typedEmail} was typed into the chat and the portal link has been sent there. It attaches to this job when they click it and not before, so a typo costs nothing.]`
        : (provenEmail ? "" : "[No email yet, and none needed from us. The job code is theirs to claim, and the email they sign up with is the one that gets attached to this job.]"),
    ].filter(Boolean).join("\n");

    const row: Record<string, unknown> = {
      title: s(card?.title) || (enough ? `Job from ${msg.channel}` : `Someone writing in on ${msg.channel}`),
      parish: s(card?.parish),
      client_name: s(card?.client_name) || msg.name,
      // A web visitor token is not a phone number and must never be shown
      // as one. The WhatsApp lane fills this in if they carry on there.
      client_phone: msg.channel === "email" || msg.channel === "web" ? "" : msg.from,
      // jobs.access_contact is NOT NULL DEFAULT ''. s() already returns "" for
      // nothing given; the || null above this comment briefly sent NULL over
      // the wire instead and every continuing-conversation update on a job
      // failed outright, 23502, until caught live the same session.
      access_contact: s(card?.access_note),
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
    // client_email only ever appears in this row when it is proven (the email
    // channel's own envelope). On a fresh insert, leaving it out is the same
    // as the "" every other creation path in this codebase writes on purpose.
    // On an update to a job already claimed through claim_code_as_me(), never
    // writing the key at all is what stops this turn silently blanking a
    // client_email a later message has no way of knowing was already proven.
    if (provenEmail) row.client_email = provenEmail;

    const { data, error } = continuing
      ? await supabase.from("jobs").update(row).eq("id", jobId).select("portal_code").single()
      // client_email defaults to "" here, matching every other creation path in
      // this codebase, and only when row.client_email (proven) is not already
      // present to override it: the column has no database default of its own.
      : await supabase.from("jobs").insert({ id: jobId, client_email: "", ...row }).select("portal_code").single();

    if (error) {
      root.recordError(error.message);
      return json({ error: error.message }, 500);
    }


    // Handing over now means standing down. From their next message on, the
    // human_handling branch near the top of this handler keeps the record and
    // pings Monique instead of running the model again, so "she will come
    // back to you herself" is true rather than followed by more bot. Set only
    // ever to true here: writing false would silently undo a desk reply's own
    // claim on the thread, and clearing it is the desk's call alone.
    const HANDOFF_TURNS = 3;
    const handingOver = wantsHuman || (!enough && turns >= HANDOFF_TURNS);

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
      ...(handingOver ? { human_handling: true } : {}),
    }, { onConflict: "channel,from_addr" });

    // Three pushes for one conversation is noise, and noise gets muted, and a
    // muted phone loses a real job later. So: once when somebody first writes
    // in, so a lead is never silently sitting there, and once when it becomes
    // a real job. Nothing for the turns in between.
    const worthTelling = stage === "done" || turns === 1 || handingOver;

    const summary = worthTelling ? notifyAdmin(supabase as unknown as SettingsReader, {
      id: jobId,
      trade: s(card?.trade), parish: s(card?.parish), title: s(card?.title),
      urgency: s(card?.urgency), from: msg.channel === "web" ? "the chat on yaadly.co.uk" : msg.from, channel: msg.channel, spoken,
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

    if (isTwilio || isWeb) {
      // One voice, two doors. On WhatsApp the reply is TwiML; on the website
      // chat it is JSON the widget renders, carrying the reference and
      // whether to show the WhatsApp button. Where a sentence promises
      // "on this number", the web version says where she will actually
      // answer instead, because there is no reply lane back to the widget.
      const say = (text: string, handoff = false) =>
        isWeb ? webSay(text, { reference: jobId, handoff }) : twiml(text);

      // The assistant writes this, not a template. Somebody who says "I have a
      // problem at my house" and gets a job reference and a 24 hour promise has
      // been processed, not helped, and the card behind it is empty anyway.
      // Asking the two things a worker would refuse to quote without is worth
      // more to everyone than a tidy autoreply.
      //
      // Still bounded by what the site promises: a person checks it, nothing
      // reaches a worker until it is signed, and no price is ever quoted here.
      const written = s(card?.reply);
      // The figure guard runs on the model's words only. The fixed strings
      // below carry no prices, and the FAQ facts it may repeat are on the
      // published list, so a cut here is always a number the model made up.
      const figures = priceFigureGuard(stripPromises(written.replace(/[\u2010-\u2015]/g, ",")));
      if (figures.cut.length) {
        console.error("price guard: cut unpublished figure(s) from a reply: " + figures.cut.join(", ") + ". Draft was: " + written.slice(0, 500));
        root.setAttributes({ "yaadly.price_guard.cut": figures.cut.length });
      }
      const safe = figures.text.slice(0, 900);

      // They asked for a person. That is not a failure of the assistant, it is
      // a reasonable thing to want when you are about to spend money on a
      // house you cannot see, and the answer is yes.
      if (wantsHuman) {
        if (isWeb) {
          return say(
            `Of course. Everything you have told me is saved as ${jobId}, so you will not have to say it twice. ` +
            `Monique will answer here herself when she picks this up. If you are leaving this page, tap the WhatsApp button and carry on there instead; everything you have said comes with you.`,
            true,
          );
        }
        return say(
          `Of course. I am passing this to Monique now and she will come back to you on this number herself. ` +
          `Everything you have told me is saved${stage === "done" ? ` as ${jobId}` : ""}, so you will not have to say it twice.`,
        );
      }

      // Read back, then wait. The assistant may believe it has enough; only
      // the client can say it is right. Nobody wants to discover afterwards
      // that the thing they thought they mentioned never landed.
      //
      // The model's own read-back usually ends by asking if it is right, but
      // "asks a yes or no question" and "tells them what word moves this
      // along" are not the same sentence, and a client who does not know
      // what makes this finish is a client left guessing. Founder's own
      // point, live, 1 Sep 2026: name the action, do not just imply it. Said
      // in code, not left to the model, for the same reason the confirmation
      // detection itself now has a code backstop below this: consistent
      // every time beats well phrased most of the time.
      if (stage === "confirming") {
        const readBack = safe || "Let me read that back. Have I got it right, and is there anything else before I write it up?";
        return say(`${readBack} Reply yes if that is right, or just tell me what to change.`);
      }

      // Confirmed. This is the only point a link goes out, because it is the
      // only point there is something finished to finish.
      if (confirmedNow || (stage === "done" && wasStage !== "done")) {
        const link = `https://app.yaadly.co.uk/portal/join?job=${encodeURIComponent(jobId)}${data?.portal_code ? `&code=${encodeURIComponent(String(data.portal_code))}` : ""}`;
        return say(
          (safe ? safe + " " : "") +
          `Your job is ${jobId}. Last step, and it is short: ${link} ` +
          `That sets up your portal and the agreement. Nothing reaches a worker until you have signed it, and nothing is charged.`,
        );
      }

      // Already finished and still talking. Take the extra detail, do not
      // re-send the link at them like a machine.
      if (stage === "done") {
        return say(
          (safe ? safe + " " : "") + `Added to ${jobId}. If you still need the link to finish setting up, say "link".`,
        );
      }

      // Asking twice is helping. Asking a fourth time is a phone tree, and the
      // person on the other end is usually the one who most needs a human:
      // older, upset, writing from a bad signal, or describing something the
      // model genuinely cannot categorise. Hand over and say so out loud.
      // Same handingOver already written to the thread above, so the next
      // message from them is held for Monique rather than answered again.
      if (!enough && turns >= HANDOFF_TURNS) {
        // Drop the questions out of whatever it wrote. Asking again in the
        // same breath as "I am giving this to a person" is the worst of both:
        // they do not know whether to answer or wait.
        const noQuestions = safe.split(/(?<=[.!?])\s+/).filter((x) => !x.trim().endsWith("?")).join(" ").trim();
        if (isWeb) {
          return say(
            (noQuestions ? noQuestions + " " : "") +
            `I have not got quite enough to write this up properly, so this is one for Monique to read herself. Your reference is ${jobId}. She will answer here when she picks it up, or carry on on WhatsApp if you are leaving this page; everything you have said comes with you.`,
            true,
          );
        }
        return say(
          (noQuestions ? noQuestions + " " : "") +
          `I have not got quite enough to write this up properly, so I am passing it to Monique to read herself. She will come back to you on this number. Your reference is ${jobId}.`,
        );
      }

      if (!enough) {
        // No reference number yet, on purpose. A reference for a greeting
        // teaches people the number means nothing.
        return say(
          safe ||
          "Thanks for writing in. Yaadly gets property work done in Jamaica for people who are not there to watch it. Tell me what needs doing, which parish the property is in, and who can let a worker in.",
        );
      }

      // Should not be reached: every stage above returns. Kept as a floor so a
      // future branch can never fall through to silence, which on WhatsApp
      // looks exactly like being ignored.
      return say(safe || "Thanks, I have that. What else can you tell me about the job?");
    }

    return json({ ok: true, jobId, portalCode: data?.portal_code ?? null, channel: msg.channel, transcribed: spoken, enough, turns });
  } catch (e) {
    // This used to be the only place in the whole function that recorded an
    // uncaught throw, and it only ever went to root.recordError, which lands
    // on the trace span and nowhere in function_logs. A client whose message
    // hit this branch got a bare 500 in reply, Twilio never even attempted a
    // send (confirmed live, 1 Sep 2026, checking Twilio's own message log:
    // the inbound message was there, no outbound reply anywhere near it),
    // and there was nothing in this project's own logs to say why. console
    // .error alongside the trace record now, same as every other silent
    // catch found and fixed this same session.
    console.error("yaad-inbound: uncaught, replying 500 with no TwiML:", String(e instanceof Error ? e.stack ?? e.message : e).slice(0, 800));
    root.recordError(e);
    return json({ error: "Inbound failed." }, 500);
  }
});
