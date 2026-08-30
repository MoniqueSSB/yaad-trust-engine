import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { Trace, SpanKind, httpAttrs } from "./otel.ts";
import { pickTextProvider, providerAttrs } from "./textmodel.ts";

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
// database the moment this insert lands, and that code is required by
// claim_portal_code() before the client portal will let anyone sign up. A
// WhatsApp message that never turns into a real job never gets a code, so it
// can never be used to self-serve an account, matching how the admin desk
// works.
//
// The email on the job is left empty here, on purpose and unavoidably:
// WhatsApp gives us a phone number, and clients do not type their email into
// a chat message. Claiming the code is what attaches an email to the job, so
// there is nothing to chase on this side. Note that the check used to demand
// a matching email as well, which meant every job created here was born
// unclaimable. See 20260829f_whatsapp_jobs_could_never_be_claimed.sql.
//
// Follow-ups: not every message is a new job. Somebody chasing "any news on
// my job?" used to get a brand new job card and a fresh portal link for work
// they had already sent in. Now the intake model classifies intent first. A
// follow-up is answered from the job record where the record can honestly
// answer it (the wording comes from code, keyed on jobs.status, never from
// the model), and anything the record cannot answer goes in front of Monique
// herself: the client is told she will reply personally, the message lands in
// the enquiries table so the desk shows it, and she gets the full text by
// email plus an anonymous push on her phone. The model only ever decides
// "is this a chase or a new job"; what the client is told about their money
// and their job is read straight off the row.
//
// Guided intake: a new job is collected one question at a time, not built
// from whatever a single opening message happened to contain. "I would like
// to start a job" used to become a job card with no location, no access
// contact and no timing, and all the asking landed on Monique afterwards. A
// client shown six blanks at once fills in two; asked one short question at
// a time, they answer all six (founder's instruction, 29 August 2026). The
// answers live in wa_intake_sessions between messages, keyed on the WhatsApp
// number, and the row is deleted the moment the job is created. Anything the
// opening message already answered is not asked again. Photos sent mid-chat
// are counted and noted on the job. The model is only needed twice: to
// classify the opener, and to structure the finished set of answers; the
// questions themselves are fixed text, so the guided flow keeps working even
// when the model is down.
//
// Tracing: every stage of the pipeline below (signature check, model call,
// database insert, outbound reply) is a child span of the request span, so a
// single inbound WhatsApp message can be read end to end as one trace.

// Model and endpoint come from _shared/textmodel.ts. See that file for why.
const JOIN_URL = "https://app.yaadly.co.uk/portal/join";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };

const INTAKE_PROMPT = `You are the Intake Agent for Yaadly, a trust-first property works service in Jamaica (Kingston metro first: Kingston and Portmore). You read a raw WhatsApp message (English or Jamaican Patois) and produce a structured card.
Return STRICT JSON only, no markdown fences, exactly this shape:
{"intent":"new_job or follow_up or worker_signup","title":"short job title naming the issue","client_name":"client's name if stated","client_email":"email address if stated, otherwise empty string","trade":"main trade needed","parish":"place if stated","urgency":"their words for timing","preferred_date":"any specific date or time they want the work done, as stated","scope":"clear plain-English scope of works, 2-4 sentences","questions":["up to 3 questions Yaadly should ask before quoting"]}
Intent: set worker_signup when the sender is a TRADESPERSON offering their own labour: saying what trade they work, asking to join, register or apply, or looking for work. A person asking FOR a tradesperson is never worker_signup, they are new_job. Set follow_up when the message is mainly chasing something already sent in: asking what is happening with their job, quote, call request or enquiry, whether it was received, when they will hear back, or why nobody has replied. Set new_job when the message describes property work to be done, even if it also asks for an update on that same new request. When unsure use new_job.
Rules: never invent facts, if a field is not in the message use empty string. Do not estimate any price. Keep the client's meaning, not their exact slang. Never use dash characters in any field, use a comma or colon instead.`;

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
  const prov = pickTextProvider();
  if (!prov) return null;
  return await trace.span(`chat ${prov.model}`, SpanKind.CLIENT, {
    ...providerAttrs(prov),
    "gen_ai.operation.name": "chat",
    "gen_ai.request.temperature": 0.2,
    "yaadly.agent.name": "intake",
    "yaadly.input.chars": String(text || "").length,
  }, async (s) => {
    const r = await fetch(prov.api, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${prov.key}` },
      body: JSON.stringify({
        model: prov.model,
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
    if (!r.ok) s.recordError(`${prov.name} http ${r.status}`);
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

// The intake questions, in the order they are asked. Fixed text on purpose:
// the client experience Monique specified is exact, and a question that needs
// no model cannot be taken down by one. Each key is also the slot the answer
// is stored under in wa_intake_sessions.answers.
// Seven, not nine. The trade is not asked because the model already reads it
// off the description and records where it came from, and a phone number is
// not asked because the WhatsApp number the message arrived on is already the
// best one there is. Every question that can be answered without the client
// is a question that should not be put to them.
const INTAKE_STEPS = ["what", "where", "access", "when", "name", "from", "email"] as const;
type IntakeStep = typeof INTAKE_STEPS[number];
const INTAKE_QUESTIONS: Record<IntakeStep, string> = {
  what: "First thing: what needs doing? Tell me in your own words, for example the zinc lift off the back and water a run down the bedroom wall. A voice note is fine too.",
  where: "Where is the property? Town and parish is enough, for example Portmore, St Catherine.",
  access: "Who can let a worker in to look at it? A name and a number is perfect, for example my aunt next door, 876 555 0142.",
  when: "How soon do you need it? Emergency, a few weeks, or just pricing it up for now?",
  name: "Nearly done. What is your name?",
  from: "Where are you writing from? UK, US, Canada, Jamaica, or somewhere else?",
  email: "Last one: what email address should Yaadly use for you? That is where your portal link, your quotes and your progress photos go. If you would rather not share one here, just say no email.",
};

// Deliberately loose, same reasoning as yaad-enquiry: this decides "did they
// give an address or something else", not "is it deliverable".
const looksLikeEmail = (v: string) => /^[^\s@]+@[^\s@.]+\.[^\s@]{2,}$/.test(v.trim());

// The email question offers a way out, so the way out has to be recognised.
// Anything that is neither an address nor a refusal gets asked again.
const saidNoEmail = (v: string) =>
  /^(no|none|nope|skip|no email|not now|no thanks|rather not|don'?t have one|do not have one)\b/i.test(v.trim());
const INTAKE_INTRO = "Happy to help. I will ask a few short questions, one at a time, so nothing gets missed. Photos help a lot, send them straight into this chat whenever you like.";

// ── the worker lane ──────────────────────────────────────────────────────
// A tradesperson who messages this number is signing up, not booking work,
// and until now the only way in was app.yaadly.co.uk/apply. Most of the
// supply side is on a phone, on WhatsApp, and a form on a website is a
// worse door than the chat they are already in.
//
// This is Phase 1 of the founder's three-phase design, the profile hook,
// and nothing more: enough to put a live applicant in front of the desk
// while they are still warm. Everything heavier (the intro video, the
// testimonials, the police check) belongs to Phase 2, after a human has
// said yes.
//
// Five questions, and deliberately not seven. No email: the WhatsApp
// number the message arrived on is already the best contact there is,
// same reasoning as the client intake not asking for a phone number.
const WORKER_STEPS = ["name", "trade", "parishes", "years", "proof"] as const;
type WorkerStep = typeof WORKER_STEPS[number];
const WORKER_QUESTIONS: Record<WorkerStep, string> = {
  name: "Good to hear from you. First, what is your name?",
  trade: "What trade do you work? For example plumbing, roofing, electrical, mason work. If you do more than one, list them.",
  parishes: "Which parishes can you work in? Kingston and St Andrew, St Catherine including Portmore, or wherever you travel to.",
  years: "How long have you been doing this work?",
  proof: "Last one, and it is the one that matters most: send a photo of a job you have finished. A picture straight from your phone is perfect. A link to your Facebook or Instagram works too, or say none for now and Yaadly will ask later.",
};
const WORKER_INTRO = "Happy to take your details. Free to join, free to quote, and you are never charged for a lead. I will ask five short questions, one at a time.";

// The payoff, said at the end rather than the start, because it means more
// once they have put the work in. Wage language is deliberately absent:
// the price is agreed per job, it is not a cut of anybody's wage.
const WORKER_PAYOFF =
  "Free to join and free to quote, win or lose. Your price is agreed with you per job, in writing, before you start, and your materials are paid at cost on top of it. Once the client approves the evidence you are paid within 3 working days.";

// The keyword door. The classifier below names this intent too, but a
// tradesperson must be able to sign up when the model is down, so the
// obvious openers are matched here without it. Kept tight on purpose:
// "mi need a plumber" is a client and must never land in this lane, so a
// first person claim is required, never a bare trade word.
const TRADE_WORDS =
  "plumber|plumbing|mason|masonry|electrician|electrical|roofer|roofing|carpenter|carpentry|painter|painting|tiler|tiling|welder|welding|handyman|technician|contractor|builder|labourer|laborer|tradesman|tradesperson";
const looksLikeWorkerSignup = (t: string) => {
  const s = t.trim();
  if (s.length > 400) return false;
  // Asking FOR a trade is a client, whatever else the message says. This runs
  // first and refuses outright, because "I am looking for a roofer to fix the
  // back room" contains a first person trade claim and is not one.
  if (new RegExp(`\\b(looking for|need|want|send|get|find|hire|book)\\s+(a|an|any|some)\\s+(${TRADE_WORDS})\\b`, "i").test(s)) return false;
  // "I am a plumber", "mi a plumber", "me a roofer and mi want work"
  if (new RegExp(`\\b(i am|i'?m|mi a|me a|im)\\b[^.!?]{0,30}\\b(${TRADE_WORDS})\\b`, "i").test(s)) return true;
  // "I want to join", "how do I sign up as a worker", "register as a pro"
  if (/\b(join|sign ?up|register|apply)\b[^.!?]{0,40}\b(work|worker|pro|tradesman|tradesperson|team|yaadly)\b/i.test(s)) return true;
  // "looking for work as a tiler" has no first person pronoun in it at all.
  if (/\blooking for work\b/i.test(s)) return true;
  if (/\b(i|mi|me)\b[^.!?]{0,20}\b(want|need|looking for)\b[^.!?]{0,20}\bwork\b/i.test(s)) return true;
  if (/\bwant (to )?(join|work with|work for)\b/i.test(s)) return true;
  return false;
};

const workerNextStep = (answers: Record<string, string>): WorkerStep | null =>
  (WORKER_STEPS.find((k) => !String(answers?.[k] ?? "").trim()) as WorkerStep | undefined) ?? null;

// The lane a session is running. Stored inside the answers jsonb rather
// than as a column, so this needed no migration and an old session with
// no marker still reads as what it was, a client.
const laneOf = (session: any): "client" | "worker" =>
  String(session?.answers?._lane ?? "") === "worker" ? "worker" : "client";

// The applicant said they have nothing to show yet. Accepted, because
// Phase 1 is a hook and not a gate: the desk can ask again, and a worker
// turned away at question five never comes back.
const saidNoProof = (v: string) =>
  /^(no|none|nope|skip|not now|no photo|none for now|later|nothing|i don'?t have|mi nuh have)\b/i.test(v.trim());

// Persona's hosted flow. The embedded SDK on /apply cannot run in a chat,
// but the same template opens as a link, and reference-id carries the
// application id exactly as the web flow sets it. That matters: the server
// confirms every inquiry against that id before recording it, so a link
// forwarded to somebody else lands on nothing.
const PERSONA_TEMPLATE_ID = Deno.env.get("PERSONA_TEMPLATE_ID") ?? "";
const PERSONA_ENVIRONMENT_ID = Deno.env.get("PERSONA_ENVIRONMENT_ID") ?? "";
const personaLink = (appRowId: string): string | null => {
  if (!PERSONA_TEMPLATE_ID || !PERSONA_ENVIRONMENT_ID) return null;
  const q = new URLSearchParams({
    "inquiry-template-id": PERSONA_TEMPLATE_ID,
    "reference-id": appRowId,
  });
  // Same two shapes the web flow accepts, for the same reason: Persona's
  // dashboard shows environments by NAME, and the value configured here is
  // "production", not an "env_..." id. Sending a name as environment-id
  // builds a link that opens on nothing.
  if (PERSONA_ENVIRONMENT_ID.startsWith("env_")) q.set("environment-id", PERSONA_ENVIRONMENT_ID);
  else q.set("environment", PERSONA_ENVIRONMENT_ID);
  return `https://withpersona.com/verify?${q.toString()}`;
};

// A session older than this is abandoned, not resumed: whatever the person
// says two days later, it is not the answer to "who can let a worker in".
const SESSION_STALE_MS = 48 * 3600_000;

const nextStep = (answers: Record<string, string>): IntakeStep | null =>
  (INTAKE_STEPS.find((k) => !String(answers?.[k] ?? "").trim()) as IntakeStep | undefined) ?? null;

// "cancel" must always work. Being trapped by a questionnaire is worse than
// never having been asked. A leading cancel word always counts; elsewhere in
// the message it only counts when the message is short, because "actually
// never mind, leave it for now" is a cancel and "the water nah stop run down
// the wall since the storm" is an answer. "stop" is start-anchored only for
// exactly that reason.
const wantsOut = (t: string) => {
  const s = t.trim();
  if (/^(cancel|stop)\b/i.test(s)) return true;
  return s.length <= 60 && /\b(cancel|never ?mind|forget (it|that)|leave it)\b/i.test(s);
};

// The bracketed stand-ins this function writes for media it cannot read.
// They are fine inside a job description and useless as the answer to a
// question, so the guided flow re-asks instead of recording them.
const isPlaceholder = (t: string) => /^\[.*\]$/.test(t.trim());

// The last nine digits are the stable part of a phone number however it was
// typed: "+44 7878 877567", "07878877567" and WhatsApp's "447878877567" all
// end the same way.
const digitsTail = (v: string) => String(v || "").replace(/\D/g, "").slice(-9);

// What is already on file for the person sending this message. Jobs are
// matched on the exact wa_id first, since that is what this webhook writes,
// then by digit tail to catch jobs typed in by hand on the desk. Enquiries
// and call requests store whatever contact the person typed, so those are
// digit-tail only. The scans are bounded and recent-first: this database is
// one founder's pipeline, not a warehouse, and a chase is always about
// something recent.
async function findHistory(supabase: any, waId: string, trace: Trace) {
  return await trace.span("db.lookup client history", SpanKind.CLIENT, {
    "db.system.name": "postgresql",
    "db.operation.name": "SELECT",
    "db.collection.name": "jobs",
  }, async (s) => {
    const tail = digitsTail(waId);
    const { data: exact } = await supabase.from("jobs")
      .select("id,title,status,portal_code,updated_at")
      .eq("client_phone", waId)
      .order("updated_at", { ascending: false })
      .limit(1);
    let job: any = exact?.[0] ?? null;
    if (!job && tail) {
      const { data: recent } = await supabase.from("jobs")
        .select("id,title,status,portal_code,updated_at,client_phone")
        .not("client_phone", "is", null)
        .neq("client_phone", "")
        .order("updated_at", { ascending: false })
        .limit(50);
      job = (recent ?? []).find((j: any) => digitsTail(j.client_phone) === tail) ?? null;
    }
    let enquiry: any = null;
    let call: any = null;
    if (tail) {
      const { data: enqs } = await supabase.from("enquiries")
        .select("created_at,contact,topic,status")
        .order("created_at", { ascending: false }).limit(30);
      enquiry = (enqs ?? []).find((e: any) => digitsTail(e.contact) === tail) ?? null;
      const { data: calls } = await supabase.from("calls")
        .select("created_at,contact,svc,status")
        .order("created_at", { ascending: false }).limit(30);
      call = (calls ?? []).find((c: any) => digitsTail(c.contact) === tail) ?? null;
    }
    s.setAttributes({
      "yaadly.history.job": Boolean(job),
      "yaadly.history.enquiry": Boolean(enquiry),
      "yaadly.history.call": Boolean(call),
    });
    return { job, enquiry, call };
  });
}

// The facts come from the row and the words come from code. The model decides
// only that this is a follow-up; what the client is then told about their job
// and their money is the status column read back deterministically, because a
// status invented by a language model is exactly the kind of confident guess
// this business exists to end. Returns null where the record cannot honestly
// answer (draft, disputed, cancelled, or anything unrecognised): those are
// Monique's to answer personally.
function statusReadback(job: any): string | null {
  if (!job) return null;
  const label = job.title ? `your job "${job.title}"` : "your job";
  switch (job.status) {
    case "awaiting_client_setup": {
      const link = `${JOIN_URL}?job=${encodeURIComponent(job.id)}${job.portal_code ? `&code=${encodeURIComponent(job.portal_code)}` : ""}`;
      return `Good to hear from you. Yaadly has ${label} on file, and it is waiting on one short step from your side: setting up your portal. ${link} ${job.portal_code ? `Your job code is ${job.portal_code} if you are asked for it. ` : ""}Once that is done, everything from quotes to evidence shows up there. If you would rather Monique called you, just say so here.`;
    }
    case "open_for_quotes":
      return `Good to hear from you. Yaadly has ${label} live and is lining up quotes from vetted workers now. Quotes show in your portal the moment they land. If you want Monique to look at anything personally, just reply here.`;
    case "quoted":
      return `Good news: quotes are in for ${label}. Sign in to your portal to read them and choose. Nothing moves and nothing is charged until you decide. If anything is unclear, reply here and Monique will pick it up personally.`;
    case "in_progress":
      return `Right now ${label} is in progress. Each stage is documented with photo and video evidence in your portal, and money is only released when you approve the work. If anything worries you, reply here and Monique will pick it up personally.`;
    case "complete":
      return `Our records show ${label} is complete and closed. If that does not match what you see on the ground, reply here and Monique will look at it personally.`;
    default:
      return null;
  }
}

// Somebody chasing an answer is the one person who must never be met with
// silence. When the record cannot answer, three things carry the chase to
// Monique: a row in enquiries so the desk shows it, an email with the full
// message so she can review it wherever she is, and an anonymous push so her
// phone buzzes without the relay seeing a name or a number. This runs after
// the response has gone out, because Meta's webhook timeout does not wait for
// Resend, so failures land on the console rather than the trace.
async function notifyMonique(admin: any, args: {
  name: string; waId: string; text: string;
  job: any; enquiry: any; call: any; toldClient: string;
}) {
  const RESEND_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
  const FROM_EMAIL = Deno.env.get("YAAD_FROM_EMAIL") ?? "jobs@in.yaadly.co.uk";
  let cfg: Record<string, string> = {};
  try {
    const { data: rows } = await admin.from("app_settings")
      .select("key,value").in("key", ["ntfy_topic", "admin_email"]);
    cfg = Object.fromEntries((rows ?? []).map((r: any) =>
      [r.key, String(r.value ?? "").trim().replace(/^"(.*)"$/, "$1")]));
  } catch (_) { /* both notifications degrade to nothing, the desk row still stands */ }

  if (cfg.ntfy_topic) {
    try {
      await fetch(`https://ntfy.sh/${cfg.ntfy_topic}`, {
        method: "POST",
        headers: { Title: "WhatsApp follow-up needs you", Priority: "high", Tags: "speech_balloon" },
        body: "Somebody on WhatsApp is chasing something the agent could not answer from the record. They have been told you will reply personally. The full message is in your email and on the desk.",
        signal: AbortSignal.timeout(4000),
      });
    } catch (_) { /* a nudge that did not arrive is not worth a crash */ }
  }

  if (cfg.admin_email && RESEND_KEY) {
    const who = args.name ? `${args.name} (${args.waId})` : args.waId;
    const onFile = [
      args.job ? `Job ${args.job.id} "${args.job.title}", status ${args.job.status}, last updated ${new Date(args.job.updated_at).toUTCString()}` : "",
      args.enquiry ? `Enquiry from ${new Date(args.enquiry.created_at).toUTCString()}, about ${args.enquiry.topic || "no topic"}, marked ${args.enquiry.status}` : "",
      args.call ? `Call request from ${new Date(args.call.created_at).toUTCString()}, service ${args.call.svc || "not said"}, marked ${args.call.status}` : "",
    ].filter(Boolean);
    const onFileText = onFile.length ? onFile.join("\n")
      : "Nothing found: no job, no enquiry and no call request matches this number.";

    const esc = (t: string) =>
      t.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c] as string));

    const text =
`${who} sent a WhatsApp follow-up the agent could not answer from the record.

Reply to them: https://wa.me/${args.waId}

What they said
--------------
${args.text}

On file for this number
-----------------------
${onFileText}

What the agent told them
------------------------
${args.toldClient}

They are waiting on you now. The desk row stays marked new until it is dealt with.`;

    const html =
`<div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.6;color:#0b1a16;max-width:600px">
<p style="margin:0 0 14px"><b>${esc(who)}</b> sent a WhatsApp follow-up the agent could not answer from the record.</p>
<p style="margin:0 0 16px"><a href="https://wa.me/${esc(args.waId)}" style="color:#0d8c7f">Reply to them on WhatsApp</a></p>
<div style="margin:0 0 18px;padding:14px 16px;border-radius:12px;background:#f2f7f5;border:1px solid #dbe7e3">
  <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#67807a">What they said</p>
  <p style="margin:0;white-space:pre-wrap">${esc(args.text)}</p>
</div>
<div style="margin:0 0 18px;padding:14px 16px;border-radius:12px;background:#f2f7f5;border:1px solid #dbe7e3">
  <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#67807a">On file for this number</p>
  <p style="margin:0;white-space:pre-wrap">${esc(onFileText)}</p>
</div>
<div style="margin:0 0 18px;padding:14px 16px;border-radius:12px;background:#f2f7f5;border:1px solid #dbe7e3">
  <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#67807a">What the agent told them</p>
  <p style="margin:0;white-space:pre-wrap">${esc(args.toldClient)}</p>
</div>
<p style="margin:0;font-size:12.5px;color:#67807a">They are waiting on you now. The desk row stays marked new until it is dealt with.</p>
</div>`;

    try {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: `Yaadly <${FROM_EMAIL}>`,
          to: [cfg.admin_email],
          subject: `WhatsApp follow-up from ${args.name || args.waId} needs your personal reply`,
          text,
          html,
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (!r.ok) console.error("follow-up escalation email", r.status, (await r.text()).slice(0, 200));
    } catch (e) {
      console.error("follow-up escalation email failed:", String(e).slice(0, 200));
    }
  } else if (!cfg.admin_email) {
    console.error("app_settings.admin_email is not set, follow-up escalation email not sent");
  } else {
    console.error("RESEND_API_KEY is not set, follow-up escalation email not sent");
  }
}

// The address a client typed into WhatsApp gets one thing sent to it: the link
// that lets them prove it is theirs. Nothing here binds anything. A failure is
// logged and swallowed, because the job is already saved and the same link has
// already gone to them on WhatsApp, so email is the second route, not the only
// one.
async function sendPortalLink(to: string, firstName: string, link: string, portalCode: string | null) {
  const RESEND_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
  const FROM_EMAIL = Deno.env.get("YAAD_FROM_EMAIL") ?? "jobs@in.yaadly.co.uk";
  if (!RESEND_KEY) { console.error("RESEND_API_KEY is not set, portal link email not sent"); return; }

  const hello = firstName ? `Hi ${firstName},` : "Hi,";
  const codeLine = portalCode ? `Your job code is ${portalCode} if you are asked for it.` : "";
  const text = `${hello}

Thanks for your message on WhatsApp. Yaadly has your job written up and Monique will review it shortly.

One short step sets up your portal, where you sign the agreement, see every quote and watch the evidence come in as the work happens:

${link}

${codeLine}

Nothing is booked and nothing is charged until you approve it.

Yaadly`;

  const esc = (t: string) =>
    t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const html = `<div style="font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#15302b;max-width:560px">
<p style="margin:0 0 14px">${esc(hello)}</p>
<p style="margin:0 0 14px">Thanks for your message on WhatsApp. Yaadly has your job written up and Monique will review it shortly.</p>
<p style="margin:0 0 18px">One short step sets up your portal, where you sign the agreement, see every quote and watch the evidence come in as the work happens.</p>
<p style="margin:0 0 18px"><a href="${esc(link)}" style="display:inline-block;padding:12px 20px;border-radius:10px;background:#15302b;color:#fff;text-decoration:none;font-weight:600">Set up your portal</a></p>
${portalCode ? `<p style="margin:0 0 14px;font-size:13px;color:#67807a">Your job code is <strong>${esc(portalCode)}</strong> if you are asked for it.</p>` : ""}
<p style="margin:0;font-size:13px;color:#67807a">Nothing is booked and nothing is charged until you approve it.</p>
</div>`;

  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `Yaadly <${FROM_EMAIL}>`,
        to: [to],
        subject: "Set up your Yaadly portal",
        text,
        html,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) console.error("portal link email", r.status, (await r.text()).slice(0, 200));
  } catch (e) {
    console.error("portal link email failed:", String(e).slice(0, 200));
  }
}

// All seven answers are in: build the job. The model gets one shot at turning
// the answers into a clean title, trade and scope, and if it is down the job
// is built from the raw answers instead, because a client who just answered
// seven questions must never be told to come back later. The session row is
// deleted only after the job insert succeeds; if the insert fails, the
// answers survive and the client's next message triggers another attempt.
// Ask Persona what happened to the check we sent, matched on the reference
// id we set when the link was built. Nothing the applicant says is trusted:
// "done" is a prompt to go and look, never evidence in itself. Same rule the
// web flow follows in yaad-vetting-upload, for the same reason.
async function reconcilePersona(
  supabase: any, appRowId: string, trace: Trace,
): Promise<{ status: string; verified: boolean; checked: boolean }> {
  const key = Deno.env.get("PERSONA_API_KEY") ?? "";
  if (!key) return { status: "unchecked", verified: false, checked: false };
  return await trace.span("persona.reconcile", SpanKind.CLIENT, {
    "yaadly.persona.reference_id": appRowId,
  }, async (s) => {
    let r: Response;
    try {
      r = await fetch(
        `https://api.withpersona.com/api/v1/inquiries?filter%5Breference-id%5D=${encodeURIComponent(appRowId)}`,
        { headers: { Authorization: `Bearer ${key}`, "Persona-Version": "2023-01-05" }, signal: AbortSignal.timeout(15000) },
      );
    } catch {
      s.setAttributes({ "yaadly.persona.outcome": "unreachable" });
      return { status: "unchecked", verified: false, checked: false };
    }
    if (!r.ok) {
      s.recordError(`persona http ${r.status}`);
      return { status: "unchecked", verified: false, checked: false };
    }
    const j = await r.json().catch(() => null) as { data?: Array<{ id?: string; attributes?: Record<string, unknown> }> } | null;
    const rows = j?.data ?? [];
    if (!rows.length) {
      s.setAttributes({ "yaadly.persona.outcome": "not_started" });
      return { status: "not_started", verified: false, checked: true };
    }
    // Most recent wins: an applicant who restarted the flow has more than one.
    const best = rows.find((x) => {
      const st = String(x.attributes?.status ?? "");
      return st === "approved" || st === "completed";
    }) ?? rows[rows.length - 1];
    const status = String(best.attributes?.status ?? "unknown");
    const verified = status === "completed" || status === "approved";
    await supabase.from("applications").update({
      persona_inquiry_id: String(best.id ?? ""),
      persona_status: status,
      persona_checked_at: new Date().toISOString(),
    }).eq("id", appRowId);
    s.setAttributes({ "yaadly.persona.status": status, "yaadly.persona.verified": verified });
    return { status, verified, checked: true };
  });
}

// Phase 1 lands here: an application row the desk can see, and the ID check
// sent straight back into the chat. Both halves matter. A profile with no
// verification started is a lead; a verification with no profile is nothing.
async function finalizeWorkerApplication(
  supabase: any, waId: string, contactName: string,
  answers: Record<string, string>, photoCount: number, trace: Trace,
) {
  const name = String(answers.name || contactName || "").slice(0, 120);
  const trade = String(answers.trade || "").slice(0, 200);
  const proof = String(answers.proof || "").trim();
  const gaveProof = proof && !saidNoProof(proof);

  const work = [
    gaveProof ? `Work proof given over WhatsApp: ${proof}` : "No work proof given yet, the applicant said they would send it later.",
    photoCount ? `${photoCount} photo${photoCount === 1 ? "" : "s"} sent into the WhatsApp chat, review them there.` : "",
    `Applied over WhatsApp from ${waId}.`,
    "[Phase 1 profile hook, collected in chat. The intro video, testimonials and police check are Phase 2, after a human says yes.]",
  ].filter(Boolean).join("\n").slice(0, 2000);

  const { data, error } = await trace.span("db.insert applications", SpanKind.CLIENT, {
    "db.system.name": "postgresql",
    "db.operation.name": "INSERT",
    "db.collection.name": "applications",
    "yaadly.application.source": "whatsapp",
  }, async (s) => {
    const r = await supabase.from("applications").insert({
      app_id: "APP-" + crypto.randomUUID().slice(0, 6).toUpperCase(),
      name,
      trade,
      parish: String(answers.parishes || "").split(",")[0].trim().slice(0, 120),
      parishes: String(answers.parishes || "").slice(0, 400),
      phone: waId.slice(0, 40),
      email: "",
      years: String(answers.years || "").slice(0, 60),
      work,
      // "received" and not "started": unlike the web flow, which opens a row
      // the moment somebody starts typing, nothing is written here until all
      // five answers are in. What the desk sees is a finished Phase 1.
      status: "received",
      submitted_at: new Date().toISOString(),
    }).select("id, app_id").single();
    if (r.error) s.recordError(r.error.message);
    return { data: r.data, error: r.error };
  });

  if (error || !data) {
    const replyResult = await maybeSendReply(waId,
      "Thank you, that is everything. Saving it hit a snag on our side just now, and nothing you sent is lost. Monique will pick it up and come back to you here.", trace);
    return { applicationId: null, reference: null, insertError: error?.message ?? "no row", replyResult };
  }

  await supabase.from("wa_intake_sessions").delete().eq("wa_id", waId);

  const firstName = name.trim().split(/\s+/)[0] || "";
  const link = personaLink(String(data.id));
  const head = firstName ? `Thank you, ${firstName}.` : "Thank you.";
  const idBit = link
    ? `\n\nOne more thing and you are done. Yaadly checks who everybody is before they set foot on a client's property, and this is that check: ${link}\n\nIt takes about two minutes on your phone. Your voter ID, driver's licence or passport, and a photo of your face. Do it whenever suits you, then send me a message here and I will confirm it came through.`
    : `\n\nMonique will come back to you here with the ID check, which is the last step before you can quote.`;

  const replyBody =
    `${head} Your application is in, reference ${data.app_id}, and a person reads it rather than a queue.\n\n${WORKER_PAYOFF}${idBit}`;

  const replyResult = await maybeSendReply(waId, replyBody, trace);
  return { applicationId: String(data.id), reference: String(data.app_id), insertError: null, replyResult };
}

async function finalizeIntake(
  supabase: any, waId: string, contactName: string,
  answers: Record<string, string>, photoCount: number, trace: Trace,
) {
  const combined =
`New job request collected over WhatsApp, one question at a time.
What needs doing: ${answers.what}
Where the property is: ${answers.where}
Who can let a worker in: ${answers.access}
How soon they need it: ${answers.when}
Client name: ${answers.name}
Writing from: ${answers.from}`;

  // Deliberately NOT written to jobs.client_email. That column is the binding:
  // claim_portal_code only binds a job whose client_email is still empty, and
  // every portal policy matches on it. Writing an address somebody typed into
  // a chat would bind the job to an unproven mailbox, and a single fat finger
  // would lock the real client out of their own job with no way back. Same
  // reasoning Monique held to on 29 Aug: the click on the link is what proves
  // the mailbox, so the click is what binds. This address only gets the link
  // sent to it.
  const givenEmail = looksLikeEmail(String(answers.email ?? "")) ? String(answers.email).trim() : "";

  const card = await structureJob(combined, trace);

  const jobId = `JOB-WA-${Date.now()}`;
  const title = card?.title || String(answers.what || "WhatsApp job, needs review").slice(0, 90);
  const descr = [
    card?.scope || answers.what,
    `Where: ${answers.where}`,
    `Access: ${answers.access}`,
    `Urgency: ${answers.when}`,
    `Writing from: ${answers.from}`,
    card?.trade ? `Trade: ${card.trade}` : "",
    givenEmail ? `Email they gave: ${givenEmail}` : "",
    photoCount ? `Photos: ${photoCount} sent in the WhatsApp chat, review them there.` : "",
    `Collected question by question by the WhatsApp agent. Raw answers:\n${combined}`,
  ].filter(Boolean).join("\n")
    + (givenEmail
      ? `\n\n[EMAIL GIVEN, NOT YET ATTACHED. ${givenEmail} was typed into the chat and the portal link has been sent there. It attaches to this job when they click it and not before, so a typo costs nothing.]`
      : "\n\n[NO EMAIL YET, client came in via WhatsApp. Nothing to chase: the job code below is theirs to claim, and the email they sign up with is the one that gets attached to this job.]");

  const { inserted, insertError } = await trace.span("db.insert jobs", SpanKind.CLIENT, {
    "db.system.name": "postgresql",
    "db.operation.name": "INSERT",
    "db.collection.name": "jobs",
    "yaadly.job.id": jobId,
    "yaadly.job.source": "whatsapp_guided",
  }, async (s: any) => {
    const { data, error } = await supabase.from("jobs").insert({
      id: jobId,
      title,
      parish: card?.parish || answers.where || "",
      client_name: answers.name || card?.client_name || contactName || "",
      client_email: "",
      client_phone: waId,
      urgency: String(answers.when || "").slice(0, 200),
      access_contact: String(answers.access || "").slice(0, 300),
      descr,
      stage: 0,
      open: false
    }).select("portal_code").single();
    if (error) s.recordError(error.message);
    s.setAttributes({ "yaadly.job.portal_code_issued": Boolean(data?.portal_code) });
    return { inserted: data, insertError: error };
  });

  if (insertError) {
    // The answers stay in the session, so nothing the client typed is lost
    // and their next message retries this. Say something honest meanwhile.
    const replyResult = await maybeSendReply(waId,
      "Thank you, that is everything Yaadly needs. Saving it hit a snag on our side just now, but nothing you sent is lost. Monique will pick it up, and you will get your portal link shortly.", trace);
    return { jobId: null, portalCode: null, insertError: insertError.message, replyResult };
  }

  await supabase.from("wa_intake_sessions").delete().eq("wa_id", waId);

  const portalCode = inserted?.portal_code || null;
  const firstName = String(answers.name || "").trim().split(/\s+/)[0] || "";
  const thanks = firstName ? `Thank you, ${firstName}.` : "Thank you.";
  const link = `${JOIN_URL}?job=${encodeURIComponent(jobId)}${portalCode ? `&code=${encodeURIComponent(portalCode)}` : ""}`;
  const emailedNote = givenEmail && portalCode ? ` I have sent the same link to ${givenEmail} so it is there when you want it.` : "";
  const replyBody = portalCode
    ? `${thanks} That is everything Yaadly needs. Last step, and it is short: ${link} That sets up your portal, where you sign the agreement and see every quote. Your job code is ${portalCode} if you are asked for it.${emailedNote} Monique will review this and follow up shortly.`
    : `${thanks} That is everything Yaadly needs. Monique will review this and follow up shortly with the link to set up your portal.`;
  const replyResult = await maybeSendReply(waId, replyBody, trace);
  if (givenEmail && portalCode) await sendPortalLink(givenEmail, firstName, link, portalCode);

  return { jobId, portalCode, emailedLink: Boolean(givenEmail && portalCode), insertError: null, replyResult };
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

    // ── idempotency ─────────────────────────────────────────────────────────
    // Meta retries a delivery on a timeout or a non-2xx, and the retry carries
    // the same message.id. Without this, a retry re-enters the intake below
    // and answers the same question twice, or inserts a second job. Recorded
    // before any state change and before the slow work, so a retry costs one
    // insert and nothing else. upsert, not insert: only upsert honours
    // onConflict, and ON CONFLICT DO NOTHING returns no row, which is how a
    // duplicate is recognised here.
    const messageId = String(message.id ?? "");
    if (messageId) {
      const { data: seen, error: seenErr } = await supabase
        .from("wa_inbound_seen")
        .upsert(
          { wa_message_id: messageId, channel: "whatsapp", from_addr: String(message.from ?? "") },
          { onConflict: "wa_message_id", ignoreDuplicates: true },
        )
        .select("wa_message_id")
        .maybeSingle();
      if (seenErr) {
        root.recordError(seenErr.message);
        return done(new Response(JSON.stringify({ ok: false, error: seenErr.message }), { status: 500, headers: { ...CORS, "Content-Type": "application/json" } }), 500);
      }
      if (!seen) {
        root.setAttributes({ "yaadly.webhook.outcome": "duplicate" });
        return done(new Response(JSON.stringify({ ok: true, duplicate: true, signatureVerified: sig.checked }), { status: 200, headers: { ...CORS, "Content-Type": "application/json" } }), 200);
      }
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

    const isMedia = ["image", "video", "document"].includes(message.type ?? "");
    const jsonReply = (body: Record<string, unknown>, outcome: string) => {
      root.setAttributes({ "yaadly.webhook.outcome": outcome });
      return done(new Response(JSON.stringify({ ok: true, signatureVerified: sig.checked, ...body }), { status: 200, headers: { ...CORS, "Content-Type": "application/json" } }), 200);
    };

    // ── a conversation already underway comes before everything ─────────────
    let session: any = null;
    if (fromWaId) {
      const { data: sess } = await supabase.from("wa_intake_sessions")
        .select("wa_id,answers,photo_count,updated_at").eq("wa_id", fromWaId).maybeSingle();
      session = sess ?? null;
    }

    // An abandoned half-intake is salvaged, never resumed: whatever this new
    // message says, it is not the answer to a question asked two days ago.
    // If they got as far as describing the work, that description becomes a
    // needs-review job so nothing typed is lost, and this message is then
    // treated fresh.
    if (session && Date.now() - new Date(session.updated_at).getTime() > SESSION_STALE_MS) {
      const a: Record<string, string> = session.answers ?? {};
      // A worker who went quiet part way is salvaged the same way a client
      // is, into a row the desk can chase, provided they got as far as
      // naming a trade. A name on its own is not an application.
      if (laneOf(session) === "worker") {
        if (String(a.trade ?? "").trim()) {
          await supabase.from("applications").insert({
            app_id: "APP-" + crypto.randomUUID().slice(0, 6).toUpperCase(),
            name: String(a.name ?? contactName ?? "").slice(0, 120),
            trade: String(a.trade).slice(0, 200),
            parish: String(a.parishes ?? "").split(",")[0].trim().slice(0, 120),
            parishes: String(a.parishes ?? "").slice(0, 400),
            phone: fromWaId.slice(0, 40),
            email: "",
            years: String(a.years ?? "").slice(0, 60),
            work: [
              a.proof ? `Work proof: ${a.proof}` : "",
              session.photo_count ? `${session.photo_count} photo(s) sent in the WhatsApp chat, review them there.` : "",
              "[Applied over WhatsApp and stopped partway. These are the answers gathered before it went quiet. No ID check was sent.]",
            ].filter(Boolean).join("\n").slice(0, 2000),
            status: "started",
          });
        }
        await supabase.from("wa_intake_sessions").delete().eq("wa_id", fromWaId);
        root.setAttributes({ "yaadly.worker_signup.abandoned": true });
        session = null;
      }
    }
    if (session && Date.now() - new Date(session.updated_at).getTime() > SESSION_STALE_MS) {
      const a: Record<string, string> = session.answers ?? {};
      if (String(a.what ?? "").trim()) {
        await supabase.from("jobs").insert({
          id: `JOB-WA-${Date.now()}`,
          title: String(a.what).slice(0, 90),
          parish: a.where || "",
          client_name: a.name || contactName || "",
          client_email: "",
          client_phone: fromWaId,
          urgency: String(a.when ?? "").slice(0, 200),
          access_contact: String(a.access ?? "").slice(0, 300),
          descr: [
            a.what,
            a.where ? `Where: ${a.where}` : "",
            a.access ? `Access: ${a.access}` : "",
            a.when ? `Urgency: ${a.when}` : "",
            a.from ? `Writing from: ${a.from}` : "",
            session.photo_count ? `Photos: ${session.photo_count} sent in the WhatsApp chat, review them there.` : "",
            "[Client started the guided WhatsApp intake and stopped partway. These are the answers gathered before it went quiet. Review before quoting.]",
          ].filter(Boolean).join("\n"),
          stage: 0,
          open: false
        });
      }
      await supabase.from("wa_intake_sessions").delete().eq("wa_id", fromWaId);
      root.setAttributes({ "yaadly.intake.abandoned": true });
      session = null;
    }

    // ── a worker part way through signing up ────────────────────────────────
    if (session && fromWaId && laneOf(session) === "worker") {
      const answers: Record<string, string> = { ...(session.answers ?? {}) };
      let photoCount: number = session.photo_count ?? 0;
      const pending = workerNextStep(answers);

      if (wantsOut(text)) {
        await supabase.from("wa_intake_sessions").delete().eq("wa_id", fromWaId);
        const replyResult = await maybeSendReply(fromWaId,
          "No problem, I have closed this off and nothing is saved. Whenever you want to pick it up, message here and we start again.", trace);
        return jsonReply({ intent: "worker_signup", cancelled: true, replyResult }, "worker_cancelled");
      }

      // A photo IS the answer to the last question, and often arrives before
      // it is asked. Bank it either way rather than making them type
      // something to go with it.
      if (isMedia) {
        photoCount += 1;
        if (pending === "proof") answers.proof = `Photo sent in the WhatsApp chat (${photoCount} so far).`;
        await supabase.from("wa_intake_sessions")
          .update({ answers, photo_count: photoCount, updated_at: new Date().toISOString() })
          .eq("wa_id", fromWaId);
        const after = workerNextStep(answers);
        if (!after) {
          const fin = await finalizeWorkerApplication(supabase, fromWaId, contactName, answers, photoCount, trace);
          return jsonReply({ intent: "worker_signup", ...fin }, fin.insertError ? "worker_insert_failed" : "worker_application_created");
        }
        const replyResult = await maybeSendReply(fromWaId, `Got the photo, thank you. ${WORKER_QUESTIONS[after]}`, trace);
        return jsonReply({ intent: "worker_signup", step: after, photoCount, replyResult }, "worker_photo");
      }

      if (isPlaceholder(text)) {
        const body = pending
          ? `Sorry, I could not catch that. Type it as a message please, or try the voice note again. ${WORKER_QUESTIONS[pending]}`
          : "Sorry, I could not catch that. Type it as a message please.";
        const replyResult = await maybeSendReply(fromWaId, body, trace);
        return jsonReply({ intent: "worker_signup", step: pending, replyResult }, "worker_retry");
      }

      if (pending) answers[pending] = text.slice(0, pending === "proof" ? 1000 : 300);

      await supabase.from("wa_intake_sessions")
        .update({ answers, updated_at: new Date().toISOString() })
        .eq("wa_id", fromWaId);

      const remaining = workerNextStep(answers);
      if (remaining) {
        const replyResult = await maybeSendReply(fromWaId, `Got it. ${WORKER_QUESTIONS[remaining]}`, trace);
        return jsonReply({ intent: "worker_signup", step: remaining, replyResult }, "worker_answer");
      }
      const fin = await finalizeWorkerApplication(supabase, fromWaId, contactName, answers, photoCount, trace);
      return jsonReply({ intent: "worker_signup", ...fin }, fin.insertError ? "worker_insert_failed" : "worker_application_created");
    }

    if (session && fromWaId) {
      const answers: Record<string, string> = { ...(session.answers ?? {}) };
      let photoCount: number = session.photo_count ?? 0;
      const pending = nextStep(answers);

      if (isMedia) {
        photoCount += 1;
        await supabase.from("wa_intake_sessions")
          .update({ photo_count: photoCount, updated_at: new Date().toISOString() })
          .eq("wa_id", fromWaId);
        const body = pending
          ? `Got the photo, thank you. Whenever you are ready: ${INTAKE_QUESTIONS[pending]}`
          : "Got the photo, thank you.";
        const replyResult = await maybeSendReply(fromWaId, body, trace);
        return jsonReply({ intent: "guided_intake", step: pending, photoCount, replyResult }, "intake_photo");
      }

      if (wantsOut(text)) {
        await supabase.from("wa_intake_sessions").delete().eq("wa_id", fromWaId);
        const replyResult = await maybeSendReply(fromWaId,
          "No problem, I have closed this off. Nothing has been booked and nothing is charged. Whenever you are ready to pick it back up, just message here and we start fresh.", trace);
        return jsonReply({ intent: "guided_intake", cancelled: true, replyResult }, "intake_cancelled");
      }

      // A voice note that would not transcribe, or a sticker, is not an
      // answer. Ask again rather than record a bracketed stand-in.
      if (isPlaceholder(text)) {
        const body = pending
          ? `Sorry, I could not catch that. Type it as a message please, or try the voice note again. ${INTAKE_QUESTIONS[pending]}`
          : "Sorry, I could not catch that. Type it as a message please.";
        const replyResult = await maybeSendReply(fromWaId, body, trace);
        return jsonReply({ intent: "guided_intake", step: pending, replyResult }, "intake_retry");
      }

      // The email step is the only one that can refuse an answer. Every other
      // question takes the client's own words and those cannot be wrong. An
      // address either is one or it is not, and a mistyped one saved here is a
      // portal link posted into the void.
      if (pending === "email" && !looksLikeEmail(text) && !saidNoEmail(text)) {
        const replyResult = await maybeSendReply(fromWaId,
          "That does not look like an email address to me. Send it once more, or just say no email and Yaadly will carry on without one.", trace);
        return jsonReply({ intent: "guided_intake", step: "email", replyResult }, "intake_email_retry");
      }

      if (pending) answers[pending] = text.slice(0, pending === "what" ? 3000 : 500);

      // Persist before finalising, so a failed job insert can retry off the
      // stored answers on the client's next message.
      await supabase.from("wa_intake_sessions")
        .update({ answers, updated_at: new Date().toISOString() })
        .eq("wa_id", fromWaId);

      const remaining = nextStep(answers);
      if (remaining) {
        const replyResult = await maybeSendReply(fromWaId, `Got it. ${INTAKE_QUESTIONS[remaining]}`, trace);
        return jsonReply({ intent: "guided_intake", step: remaining, replyResult }, "intake_answer");
      }

      const fin = await finalizeIntake(supabase, fromWaId, contactName, answers, photoCount, trace);
      return jsonReply({ intent: "guided_intake", ...fin }, fin.insertError ? "job_insert_failed" : "job_created");
    }

    // A photo with no conversation underway starts one. The model has nothing
    // to classify in a bracketed stand-in, so it is not asked.
    const card = isMedia ? null : await structureJob(text, trace);

    // A follow-up is not a new job. Answer it from the record when the record
    // can, and put it in front of Monique when it cannot. Either way, no new
    // job card and no fresh portal code: the ones they already have stand.
    // If the model is down, card is null and the message falls through to the
    // guided intake below, which is the safe default: an unnecessary question
    // is recoverable, a lost chase is not.
    if (card?.intent === "follow_up" && fromWaId) {
      const history = await findHistory(supabase, fromWaId, trace);
      const readback = statusReadback(history.job);
      const answered = Boolean(readback);

      const escalation = history.job || history.enquiry || history.call
        ? `Thanks for checking in. What you sent is on file with Yaadly, and this one needs Monique herself rather than the assistant. Your message has just been passed straight to her and she will come back to you personally. If there is anything to add in the meantime, reply here and she sees it.`
        : `Thanks for checking in. The assistant could not match this number to a job on file, so your message has just been passed straight to Monique and she will come back to you personally. If there is anything to add in the meantime, reply here and she sees it.`;
      const replyBody = readback ?? escalation;

      // The desk row is the thing that must survive, same rule as enquiries
      // from the website. Answered ones arrive already marked answered, so
      // the desk only demands attention for the ones waiting on her.
      const { error: rowError } = await trace.span("db.insert enquiries", SpanKind.CLIENT, {
        "db.system.name": "postgresql",
        "db.operation.name": "INSERT",
        "db.collection.name": "enquiries",
      }, async (s) => {
        const note = answered
          ? `\n\n[The WhatsApp agent answered this automatically from job ${history.job.id}, status ${history.job.status}.]`
          : `\n\n[Needs a personal reply. The WhatsApp agent could not answer this from the record, and told them Monique will come back personally.]`;
        const r = await supabase.from("enquiries").insert({
          name: (contactName || "WhatsApp client").slice(0, 120),
          contact: fromWaId.slice(0, 200),
          topic: "WhatsApp follow-up",
          message: (text.slice(0, 3800) + note).slice(0, 4000),
          status: answered ? "answered" : "new",
        });
        if (r.error) s.recordError(r.error.message);
        return { error: r.error };
      });

      const replyResult = await maybeSendReply(fromWaId, replyBody, trace);

      if (!answered) {
        const after = notifyMonique(supabase, {
          name: contactName, waId: fromWaId, text,
          job: history.job, enquiry: history.enquiry, call: history.call,
          toldClient: replyBody,
        }).catch((e) => console.error("follow-up escalation failed:", String(e).slice(0, 200)));
        const rt = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
        if (rt?.waitUntil) rt.waitUntil(after); else await after;
      }

      root.setAttributes({ "yaadly.webhook.outcome": answered ? "follow_up_answered" : "follow_up_escalated" });
      return done(new Response(JSON.stringify({
        ok: true,
        intent: "follow_up",
        answered,
        jobMatched: history.job?.id ?? null,
        deskRowError: rowError ? rowError.message : null,
        signatureVerified: sig.checked,
        replyResult,
      }), { status: 200, headers: { ...CORS, "Content-Type": "application/json" } }), 200);
    }

    // ── a tradesperson signing up, or coming back from the ID check ─────────
    // Placed after follow_up and before the job intake, because a worker
    // message must never become a job card: a job card with a plumber's own
    // details in it is worse than no row at all.
    // The keyword door only opens where the model did not produce real work to
    // do. "I am a plumber and I need someone to fix my roof" is a CLIENT, and
    // the phrase that starts it would otherwise route them into the wrong
    // lane. A described job always wins over a first person trade claim.
    const workerByWords = !isMedia && !card?.scope && looksLikeWorkerSignup(text);
    if (fromWaId && (card?.intent === "worker_signup" || workerByWords)) {
      // Already applied from this number? Then this is them coming back, and
      // the useful thing to do is go and ask Persona what happened rather
      // than start a second application.
      const { data: prior } = await supabase.from("applications")
        .select("id, app_id, name, persona_status")
        .eq("phone", fromWaId)
        .order("created_at", { ascending: false })
        .limit(1);
      const existing = prior?.[0] ?? null;

      if (existing) {
        const pv = await reconcilePersona(supabase, String(existing.id), trace);
        const link = personaLink(String(existing.id));
        let body: string;
        if (pv.verified) {
          body = `You are already on file, reference ${existing.app_id}, and your ID check came back clear. Nothing else is needed from you right now. Monique reviews every application herself and will come back to you here.`;
        } else if (pv.status === "not_started" && link) {
          body = `You are already on file, reference ${existing.app_id}. The ID check is the one thing still outstanding: ${link}\n\nAbout two minutes on your phone, then message me here and I will confirm it came through.`;
        } else if (pv.checked) {
          body = `You are already on file, reference ${existing.app_id}. Your ID check is showing as "${pv.status}" at the moment, so it is with Persona rather than with you. Monique will come back to you here.`;
        } else {
          body = `You are already on file, reference ${existing.app_id}. Monique reviews every application herself and will come back to you here.`;
        }
        const replyResult = await maybeSendReply(fromWaId, body, trace);
        return jsonReply({ intent: "worker_signup", existing: existing.app_id, persona: pv, replyResult }, "worker_returning");
      }

      const answers: Record<string, string> = { _lane: "worker" };
      // Bank what the opener already gave. The name is only taken from the
      // model, never from the WhatsApp profile: a profile name is whatever
      // somebody typed into their phone once, and this one goes on a vetting
      // record.
      if (card?.client_name) answers.name = String(card.client_name).slice(0, 200);
      if (card?.trade) answers.trade = String(card.trade).slice(0, 200);
      const first = workerNextStep(answers) as WorkerStep;
      await supabase.from("wa_intake_sessions").upsert({
        wa_id: fromWaId,
        answers,
        photo_count: isMedia ? 1 : 0,
        updated_at: new Date().toISOString(),
      });
      const replyResult = await maybeSendReply(fromWaId, `${WORKER_INTRO} ${WORKER_QUESTIONS[first]}`, trace);
      return jsonReply({ intent: "worker_signup", step: first, prefilled: Object.keys(answers).filter((k) => k !== "_lane"), replyResult }, "worker_started");
    }

    // ── a new job starts the guided intake, one question at a time ──────────
    // Whatever the opener already answered is banked and not asked again: a
    // voice note that names the problem, the parish and the timing goes
    // straight to the access question. Prefills come off the model card, and
    // the raw opener text stands in for the scope because the client's own
    // words are what the final structuring pass should read.
    if (fromWaId) {
      const answers: Record<string, string> = {};
      // A scope alone is not proof the opener described real work: the model
      // paraphrases "I would like to start a job" into a scope too. A trade
      // is only ever inferred from an actual description, so it gates the
      // prefill, and "what needs doing" gets asked whenever it is missing.
      if (card?.scope && card?.trade && !isPlaceholder(text)) answers.what = text.slice(0, 3000);
      if (card?.parish) answers.where = String(card.parish).slice(0, 500);
      if (card?.urgency) answers.when = String(card.urgency).slice(0, 500);
      if (card?.client_name) answers.name = String(card.client_name).slice(0, 200);
      const first = nextStep(answers) as IntakeStep; // "from" is never prefilled, so never null
      await supabase.from("wa_intake_sessions").upsert({
        wa_id: fromWaId,
        answers,
        photo_count: isMedia ? 1 : 0,
        updated_at: new Date().toISOString(),
      });
      const intro = isMedia
        ? "Thanks for the photo, that helps a lot. I will ask a few short questions, one at a time, so nothing gets missed."
        : INTAKE_INTRO;
      const replyResult = await maybeSendReply(fromWaId, `${intro} ${INTAKE_QUESTIONS[first]}`, trace);
      return jsonReply({ intent: "guided_intake", step: first, prefilled: Object.keys(answers), replyResult }, "intake_started");
    }

    // No sender id at all: nothing to hold a conversation with, so fall back
    // to the old single-shot job card rather than lose the message.
    const jobId = `JOB-WA-${Date.now()}`;
    const title = card?.title || (contactName ? `WhatsApp job from ${contactName}` : "WhatsApp job, needs review");
    const noEmailNote = card?.client_email ? "" : "\n\n[NO EMAIL YET, client came in via WhatsApp. Nothing to chase: the job code below is theirs to claim, and the email they sign up with is the one that gets attached to this job.]";
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
      // One link, and it carries the code. Asking someone to copy six
      // characters between two apps on a phone is a step people drop out on,
      // and asking them to reply with an email first was a step that did not
      // need to exist: claiming the code is what attaches their email.
      const link = `${JOIN_URL}?job=${encodeURIComponent(jobId)}${portalCode ? `&code=${encodeURIComponent(portalCode)}` : ""}`;
      const replyBody = portalCode
        ? `Thanks, Yaadly got your message. Last step, and it is short: ${link} That sets up your portal, where you sign the agreement and see every quote. Your job code is ${portalCode} if you are asked for it. A project manager will follow up shortly.`
        : `Thanks, Yaadly got your message. A project manager will follow up shortly with the link to set up your portal.`;
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
