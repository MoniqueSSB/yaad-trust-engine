import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { Trace, SpanKind, httpAttrs } from "./otel.ts";

// The vetting reviewer.
//
// Step 6 of the join flow has always said "a machine reads the file before a
// person does". Until now that was copy. This is the machine.
//
// It never decides. There is no code path here that approves, declines, or
// touches an application's status, and that is deliberate rather than
// unfinished. A person approves on the desk, having read this. The row it
// writes is a record of what the machine said, not a verdict it reached.
//
// It also does not run at all unless the applicant said it could. See the
// consent gate inside review().
//
// ── Why it reads one document at a time ──
//
// The obvious build is one call with every document attached, asking the model
// to cross-check them. It was built that way first and the model refused: the
// vision model on this project is llama-3.2-90b-vision-instruct, which accepts
// exactly one image per request.
//
// Rather than pin the whole feature to whichever model happens to allow five,
// it runs in three passes:
//
//   1. read      one call per document, in parallel. What does this page say.
//   2. face      one call with the ID and the live photo together, IF the
//                model will take two images. If it will not, face match comes
//                back "cannot tell" naming the cause, which is the honest
//                answer and tells whoever reads it what to change.
//   3. synthesis one text-only call over everything pass 1 read, plus what the
//                applicant typed.
//
// Reading a document on its own is also simply more accurate than asking one
// prompt to juggle five, and pass 1's raw readings are stored, so when the
// desk disagrees with a flag it can see which page produced it.
//
// ── Who waits ──
//
// The desk gets the finished review, because a person is watching. A submit
// tries to run it in the background so the read is already there. That attempt
// is best effort and known to be: see the dispatch at the bottom.
//
// PRIVACY. This sends identity documents to NVIDIA's hosted model, which is
// exactly why step 3 now asks permission and why the gate below is not
// optional.

const SUPABASE_URL   = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY    = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON_KEY       = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const NVIDIA_API_KEY = Deno.env.get("NVIDIA_API_KEY") ?? "";

// Its own model setting, falling back to the photo reviewer's. Vetting and
// defect-spotting are different jobs and should be able to move apart without
// one retuning the other.
const MODEL = Deno.env.get("NVIDIA_VETTING_MODEL")
  || Deno.env.get("NVIDIA_VISION_MODEL")
  || "meta/llama-3.2-90b-vision-instruct";

const NV_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
const BUCKET = "vetting";

// Only images reach a vision model. A PDF, a Word CV and the face-turn video
// are listed as skipped with the reason, never quietly counted as read.
const READABLE = ["image/jpeg", "image/png", "image/webp"];

const MAX_DOCS = 5;
const MAX_BYTES_EACH = 8 * 1024 * 1024;
const CALL_TIMEOUT = 45000;

const DOC_LABEL: Record<string, string> = {
  photo_id: "Government photo ID",
  selfie_with_id: "Live photo taken in the moment",
  face_video: "Video of the face turning left to right",
  trn: "TRN document",
  proof_of_address: "Proof of address",
  police_check: "JCF police record check",
  cv: "CV",
  portfolio: "Portfolio or photos of finished work",
  certificate: "Trade certificate",
};

const CORE_DOCS = ["photo_id", "selfie_with_id", "trn", "proof_of_address", "police_check"];

/* ── pass 1: read one document ── */

const READ_PROMPT = `You are reading ONE document uploaded by a tradesperson applying to join Yaadly, a property works service in Jamaica. You report only what is visible on this page. You are not deciding anything about the application.

Return STRICT JSON only, no markdown fences, exactly this shape:
{"appears_to_be":"what this document actually is, in your own words","matches_label":"yes|no|unsure","readable":"yes|partly|no","names":["every personal name printed on it, exactly as written"],"dates":[{"label":"what the date is for, e.g. expiry, issued, bill date","value":"as printed"}],"numbers":[{"label":"what the number is, e.g. licence number, TRN, certificate number","value":"as printed"}],"address":"any postal address printed on it, or empty string","concerns":["anything that looks wrong: mismatched fonts, uneven edges, text not sitting on the background, a photograph of a screen rather than a document, a crop that hides part of the page"],"notes":"one sentence a human reviewer would want to know"}

Rules:
- You will be told what the document is SUPPOSED to be. "matches_label" is whether it actually is that. A page filed as a police check that is plainly a payslip is the single most important thing you can catch.
- Copy dates EXACTLY as printed and do not convert, reformat or interpret them. Something else does the arithmetic. Your only job with a date is to read it correctly.
- Never invent a name, a date or a number. If you cannot read it, leave it out and set "readable" honestly.
- Copy names and numbers exactly as printed, including middle names and initials. Do not tidy them up.
- "concerns" is for what you can SEE. Do not speculate about forgery you have no visual evidence for. An empty array is a fine answer.
- Do not comment on the person's appearance, race, age or gender.
- Output ONLY the JSON object.`;

/* ── pass 2: do these two faces match ── */

const FACE_PROMPT = `You are shown two images from one person's application to join Yaadly: first their government photo ID, second a live photo they took in the moment. Say whether they appear to be the same person.

Return STRICT JSON only, no markdown fences, exactly this shape:
{"same_person":"likely|unlikely|cannot_tell","confidence":"high|medium|low","note":"one or two sentences on what you based that on and what limited you"}

Rules:
- "cannot_tell" is the right answer whenever lighting, image quality, angle, or the age of the ID photo stop you being sure. Prefer it to guessing.
- A person can age, change weight, grow or shave a beard, and change their hair. None of those on their own make it a different person.
- Never comment on race or ethnicity. Never describe the person beyond what the comparison needs.
- You are producing a flag for a human, not an identification. Say so in the note if you are anything short of confident.
- Output ONLY the JSON object.`;

/* ── pass 3: put it together ── */

const SYNTH_PROMPT = `You are the Vetting Reviewer for Yaadly, a trust-first property works service in Jamaica. You are given what an applicant typed, what a vision model read off each of their documents separately, a face comparison, and date arithmetic that has already been calculated for you. You produce the note a human reviewer reads before opening the file.

You never decide. You do not approve, decline, or recommend approving or declining. You produce flags and questions for a person to act on.

Cover these, but only where there is something to say:
- Name match. Is the name the same across every document, and does it match what the applicant typed? A middle name on one document and not another is worth a note, not a flag. A different surname with no explanation is a flag.
- Face match. Report what the comparison said, including its confidence.
- Document is what it claims. Any document where matches_label is "no" or "unsure" is a flag, and the most serious one.
- Legibility. Anything that came back partly readable or unreadable needs re-sending, and that is a question for the applicant, not a flag against them.
- Signs of alteration. Report concerns raised on any document.
- Numbers to verify. List certificate, licence and reference numbers that were read, so a person can check them with the issuing body. State plainly that they have NOT been verified.
- Missing documents. Say what was not provided at all.

DO NOT produce any check about how old a document is, or whether a date is inside a window, or whether something has expired. That arithmetic has been done for you and is added to the checks separately. Use it in your summary and your questions, never contradict it, and never restate it as a check of your own.

Return STRICT JSON only, no markdown fences, exactly this shape:
{"summary":"at most three plain sentences on what a person should know before opening these documents","checks":[{"name":"short check name","verdict":"pass|flag|unclear","note":"one or two sentences"}],"questions":["a specific question to put to the applicant, only if something needs asking"]}

Rules:
- verdict "pass" means nothing visibly wrong, NOT that the document is genuine. You cannot establish that, and you must not imply it.
- verdict "unclear" is correct whenever the readings do not let you be sure. Prefer it to guessing.
- Never invent a name, a date or a number that is not in the readings you were given.
- Never comment on the applicant's appearance, race, age or gender.
- Never estimate a price and never comment on their skill.
- Output ONLY the JSON object.`;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const s = (v: unknown) => String(v ?? "").trim();

function b64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let out = "";
  // Chunked, because String.fromCharCode(...wholeArray) blows the stack on a
  // multi-megabyte photograph.
  for (let i = 0; i < bytes.length; i += 8192) out += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(out);
}

/* ── dates are arithmetic, so code does them ──
   The model was asked to judge whether a proof of address was inside its three
   month window. Shown a bill dated 03 January and told today was 27 August, it
   answered that the bill was within the last three months. It was seven months
   old.
   That is not a prompt that needs tightening. Language models are bad at date
   arithmetic and no amount of "do the arithmetic properly" fixes it. So the
   model is asked only to READ the dates off the page, which it does well, and
   the arithmetic happens here where it is deterministic and testable. */

const DAY = 86400000;
const ADDRESS_MAX_DAYS = 92;    // "within three months", generously
const POLICE_MAX_DAYS = 365;    // a check much older than a year is stale

/** Parse a date as printed on a document. Returns null rather than guessing. */
function parseDocDate(v: unknown): { at: Date } | { ambiguous: true } | null {
  const t = s(v).replace(/(\d+)(st|nd|rd|th)/gi, "$1").trim();
  if (!t) return null;

  // All-numeric with separators is genuinely ambiguous: 03/01/2026 is the
  // third of January in Jamaica and the first of March to a US date parser.
  // Saying so beats picking one and being wrong half the time.
  if (/^\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}$/.test(t)) {
    const p = t.split(/[\/.\-]/).map(Number);
    if (p[0] > 12 || p[1] > 12) {
      const [a, b, c] = p;
      const day = a > 12 ? a : b, mon = a > 12 ? b : a;
      const year = c < 100 ? 2000 + c : c;
      const d = new Date(Date.UTC(year, mon - 1, day));
      return isNaN(d.getTime()) ? null : { at: d };
    }
    return { ambiguous: true };
  }

  const d = new Date(t);
  return isNaN(d.getTime()) ? null : { at: d };
}

type Extraction = { doc: string; dates?: { label?: string; value?: string }[] };

/** Deterministic date checks, and the note that explains each one. */
function dateChecks(extracted: Extraction[]): { name: string; verdict: string; note: string }[] {
  const now = Date.now();
  const out: { name: string; verdict: string; note: string }[] = [];

  const pick = (doc: string, re: RegExp) => {
    const e = extracted.find((x) => x.doc === doc);
    for (const d of e?.dates ?? []) {
      if (!re.test(s(d.label))) continue;
      const p = parseDocDate(d.value);
      if (p) return { printed: s(d.value), label: s(d.label), parsed: p };
    }
    return null;
  };

  const age = pick("proof_of_address", /bill|statement|issue|date|period/i);
  if (age) {
    if ("ambiguous" in age.parsed) {
      out.push({
        name: "Proof of address age, computed", verdict: "unclear",
        note: `The date reads "${age.printed}", which could be day-month or month-day. Check it yourself: the three month window turns on which it is.`,
      });
    } else {
      const days = Math.floor((now - age.parsed.at.getTime()) / DAY);
      out.push(days > ADDRESS_MAX_DAYS
        ? { name: "Proof of address age, computed", verdict: "flag",
            note: `Dated ${age.printed}, which is ${days} days ago. The window is three months, so this is ${days - ADDRESS_MAX_DAYS} days past it and needs re-sending.` }
        : { name: "Proof of address age, computed", verdict: "pass",
            note: `Dated ${age.printed}, ${days} days ago, inside the three month window.` });
    }
  }

  for (const doc of ["photo_id", "trn", "certificate"]) {
    const exp = pick(doc, /expir|valid until|valid to/i);
    if (!exp || "ambiguous" in exp.parsed) continue;
    const days = Math.floor((exp.parsed.at.getTime() - now) / DAY);
    out.push(days < 0
      ? { name: `${DOC_LABEL[doc] ?? doc} expiry, computed`, verdict: "flag",
          note: `Expired ${Math.abs(days)} days ago, on ${exp.printed}.` }
      : { name: `${DOC_LABEL[doc] ?? doc} expiry, computed`, verdict: "pass",
          note: `Expires ${exp.printed}, ${days} days from now.` });
  }

  const pc = pick("police_check", /issue|date|dated/i);
  if (pc && !("ambiguous" in pc.parsed)) {
    const days = Math.floor((now - pc.parsed.at.getTime()) / DAY);
    out.push(days > POLICE_MAX_DAYS
      ? { name: "Police check age, computed", verdict: "flag",
          note: `Issued ${pc.printed}, ${days} days ago. Over a year old, so treat it as out of date and ask for a current one.` }
      : { name: "Police check age, computed", verdict: "pass",
          note: `Issued ${pc.printed}, ${days} days ago.` });
  }

  return out;
}

type Answer =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: string };

/** One call to the model, parsed. Never throws. */
async function ask(
  trace: Trace, pass: string, system: string, content: unknown, maxTokens: number,
): Promise<Answer> {
  try {
    const r = await trace.span(`chat ${MODEL}`, SpanKind.CLIENT, {
      "gen_ai.system": "nvidia_nim",
      "gen_ai.operation.name": "chat",
      "gen_ai.request.model": MODEL,
      "gen_ai.request.max_tokens": maxTokens,
      "gen_ai.request.temperature": 0.1,
      "server.address": "integrate.api.nvidia.com",
      "yaadly.agent.name": "vetting_review",
      "yaadly.vetting.pass": pass,
    }, async (sp) => {
      const res = await fetch(NV_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${NVIDIA_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: MODEL,
          messages: [{ role: "system", content: system }, { role: "user", content }],
          max_tokens: maxTokens,
          temperature: 0.1,
        }),
        signal: AbortSignal.timeout(CALL_TIMEOUT),
      });
      sp.setAttributes({ "http.response.status_code": res.status });
      if (!res.ok) sp.recordError(`nvidia http ${res.status}`);
      return res;
    });

    if (!r.ok) return { ok: false, error: `HTTP ${r.status}: ${(await r.text()).slice(0, 240)}` };
    const j = await r.json();
    const raw = j?.choices?.[0]?.message?.content ?? "";
    const m = String(raw).match(/\{[\s\S]*\}/);
    if (!m) return { ok: false, error: `Answer was not JSON: ${String(raw).slice(0, 240)}` };
    return { ok: true, value: JSON.parse(m[0]) };
  } catch (e) {
    return { ok: false, error: String(e).slice(0, 240) };
  }
}

/** The desk's own session, or this project's service role calling itself. */
async function callerAllowed(req: Request): Promise<"admin" | "internal" | null> {
  const tok = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!tok) return null;
  if (SERVICE_KEY && tok === SERVICE_KEY) return "internal";
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/is_admin`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: ANON_KEY, Authorization: `Bearer ${tok}` },
      body: "{}",
    });
    if (r.ok && (await r.json()) === true) return "admin";
  } catch (_) { /* fall through to refusal */ }
  return null;
}

type Result = { body: Record<string, unknown>; status: number };

/** Read one application's documents and write down what was seen. */
async function review(trace: Trace, root: ReturnType<Trace["startSpan"]>, appId: string): Promise<Result> {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const save = async (row: Record<string, unknown>, status = 200): Promise<Result> => {
    const full = { application_id: appId, model: MODEL, ...row };
    const { error } = await admin.from("vetting_reviews").insert(full);
    if (error) root.recordError(error.message);
    return { body: { ok: status === 200, review: full }, status };
  };

  const { data: app, error: appErr } = await admin
    .from("applications")
    .select("id, app_id, name, trade, trade_other, parish, parishes, years, police_status, signed_name, ai_review_consent")
    .eq("id", appId).maybeSingle();
  if (appErr || !app) return { body: { error: "No such application." }, status: 404 };

  // ── the consent gate ──
  //
  // Step 3 lets an applicant refuse to have their identity documents read by
  // an AI model. This is where that refusal is actually enforced, and it is
  // enforced here rather than only at the caller because the desk has a "Run
  // the check again" button and a button must not be able to override a
  // promise made to somebody handing over their passport.
  //
  // NULL counts as declined. Consent is opt in, so an application that predates
  // the question, or one where the field never arrived, does not get read.
  if (app.ai_review_consent !== "granted") {
    root.setAttributes({ "yaadly.vetting.review": "consent_declined" });
    return {
      body: {
        ok: false,
        declined: true,
        error: "This applicant asked that no AI model read their documents. Nothing was sent.",
      },
      status: 409,
    };
  }

  const { data: docs } = await admin
    .from("vetting_documents")
    .select("doc_type, storage_path, mime, bytes")
    .eq("application_id", appId).order("created_at");

  // Nothing to look at. Record that plainly rather than calling the model with
  // an empty hand and letting it fill the silence.
  if (!docs || !docs.length) {
    root.setAttributes({ "yaadly.vetting.review": "no_documents" });
    return save({
      summary: "No documents were uploaded with this application, so there was nothing to read.",
      checks: [{ name: "Documents", verdict: "unclear", note: "The application arrived with no files attached at all." }],
      questions: ["Ask them to send a photo ID, a proof of address and their TRN before this goes any further."],
      extracted: [], docs_read: [], docs_skipped: [], flag_count: 0,
    });
  }

  if (!NVIDIA_API_KEY) return { body: { error: "NVIDIA_API_KEY is not set on this function." }, status: 500 };

  /* ── fetch the files ──
     Inlined as base64 rather than handed over as signed URLs: a signed URL
     given to a third party is a passport sitting on a fetchable address for as
     long as that URL lives. */
  const skipped: { doc: string; why: string }[] = [];
  const loaded: { doc: string; label: string; dataUrl: string }[] = [];

  for (const d of docs) {
    const doc = s(d.doc_type);
    if (!READABLE.includes(s(d.mime))) {
      skipped.push({ doc, why: `${s(d.mime) || "unknown type"}, which a vision model cannot read. Open it yourself.` });
      continue;
    }
    if (loaded.length >= MAX_DOCS) { skipped.push({ doc, why: "Over the five-document limit for one run." }); continue; }
    if (Number(d.bytes ?? 0) > MAX_BYTES_EACH) { skipped.push({ doc, why: "Too large to send to the model." }); continue; }

    const { data: file, error: dlErr } = await admin.storage.from(BUCKET).download(s(d.storage_path));
    if (dlErr || !file) { skipped.push({ doc, why: "The file could not be read out of storage." }); continue; }

    loaded.push({
      doc,
      label: DOC_LABEL[doc] ?? doc,
      dataUrl: `data:${s(d.mime)};base64,${b64(await file.arrayBuffer())}`,
    });
  }

  root.setAttributes({
    "yaadly.vetting.docs_read": loaded.length,
    "yaadly.vetting.docs_skipped": skipped.length,
  });

  if (!loaded.length) {
    return save({
      summary: "Nothing on this application could be machine read. Every file is a PDF, a document or a video, so all of it needs your eyes.",
      checks: [{ name: "Documents", verdict: "unclear", note: "No readable image was attached. " + skipped.map((x) => `${DOC_LABEL[x.doc] ?? x.doc}: ${x.why}`).join(" ") }],
      questions: [], extracted: [], docs_read: [], docs_skipped: skipped, flag_count: 0,
    });
  }

  /* ── pass 1: read each document on its own, in parallel ── */

  const extracted = await Promise.all(loaded.map(async (f) => {
    const out = await ask(trace, `read:${f.doc}`, READ_PROMPT, [
      { type: "text", text: `This document was filed as: ${f.label}. Read it and report what is on it.` },
      { type: "image_url", image_url: { url: f.dataUrl } },
    ], 900);
    return out.ok
      ? { doc: f.doc, label: f.label, ...out.value }
      : { doc: f.doc, label: f.label, read_failed: out.error };
  }));

  const failed = extracted.filter((e) => "read_failed" in e) as { read_failed: string }[];
  if (failed.length === extracted.length) {
    root.setAttributes({ "yaadly.vetting.review": "all_reads_failed" });
    return save({
      summary: "The review could not run. Every document failed to reach the model.",
      checks: [], questions: [], extracted,
      docs_read: loaded.map((f) => f.doc), docs_skipped: skipped, flag_count: 0,
      error: s(failed[0].read_failed).slice(0, 400),
    }, 502);
  }

  /* ── pass 2: face match, only if both photos are here ── */

  const idImg = loaded.find((f) => f.doc === "photo_id");
  const selfie = loaded.find((f) => f.doc === "selfie_with_id");
  let face: Record<string, unknown>;

  if (!idImg || !selfie) {
    face = {
      same_person: "cannot_tell", confidence: "low",
      note: !idImg && !selfie
        ? "Neither the photo ID nor the live photo was readable, so there was nothing to compare."
        : !idImg
        ? "No readable photo ID, so there was nothing to compare the live photo against."
        : "No live photo was readable, so there was nothing to compare the ID against.",
    };
  } else {
    const out = await ask(trace, "face", FACE_PROMPT, [
      { type: "text", text: "First image: the government photo ID. Second image: the live photo. Are they the same person?" },
      { type: "image_url", image_url: { url: idImg.dataUrl } },
      { type: "image_url", image_url: { url: selfie.dataUrl } },
    ], 400);
    face = out.ok ? out.value : {
      same_person: "cannot_tell", confidence: "low",
      // The usual cause is a model that takes one image per request. Naming it
      // beats a bare failure: it tells whoever reads this what to change rather
      // than only that something broke.
      note: `The face comparison did not run, so nobody has checked the ID photo against the live photo. Compare them yourself. Cause: ${s(out.error).slice(0, 160)}`,
    };
  }

  /* ── pass 3: synthesis, text only ── */

  const missing = CORE_DOCS.filter((t) => !docs.some((d) => d.doc_type === t)).map((t) => DOC_LABEL[t]);

  const typed = [
    `Today's date: ${new Date().toISOString().slice(0, 10)}`,
    `Name as typed by the applicant: ${s(app.name) || "not given"}`,
    `Trade: ${s(app.trade) || "not given"}${s(app.trade_other) ? ", plus " + s(app.trade_other) : ""}`,
    `Parishes: ${s(app.parishes) || s(app.parish) || "not given"}`,
    `Years at the trade: ${s(app.years) || "not given"}`,
    s(app.signed_name) ? `Name typed as a signature on the Worker Guidelines: ${s(app.signed_name)}` : "",
    app.police_status === "not_yet" ? "They stated they do not have a police record check yet." : "",
    skipped.length
      ? `Files nobody machine read: ${skipped.map((x) => `${DOC_LABEL[x.doc] ?? x.doc} (${x.why})`).join("; ")}`
      : "",
    `Core documents not provided at all: ${missing.length ? missing.join(", ") : "none, all of them are present"}`,
  ].filter(Boolean).join("\n");

  // Worked out here, not by the model, and handed over as settled fact.
  const computed = dateChecks(extracted as Extraction[]);

  const synth = await ask(trace, "synthesis", SYNTH_PROMPT, [{
    type: "text",
    text: `WHAT THE APPLICANT TYPED\n${typed}\n\n`
      + `WHAT WAS READ OFF EACH DOCUMENT\n${JSON.stringify(extracted, null, 1)}\n\n`
      + `FACE COMPARISON\n${JSON.stringify(face)}\n\n`
      + `DATE ARITHMETIC, ALREADY DONE FOR YOU\nThese were calculated, not judged. Treat them as settled and never contradict them. They are added to the checks after you answer, so do not repeat them as checks of your own; use them for the summary and the questions.\n${JSON.stringify(computed, null, 1)}\n\n`
      + `Now produce the reviewer's note.`,
  }], 1000);

  if (!synth.ok) {
    root.setAttributes({ "yaadly.vetting.review": "synthesis_failed" });
    // The computed date checks survive a failed summary, because they never
    // needed the model in the first place.
    return save({
      summary: "Each document was read, but the summary step failed. The date checks below were calculated rather than written by the model, so they still stand, and the raw readings are on the record.",
      checks: computed, questions: [], extracted,
      docs_read: loaded.map((f) => f.doc), docs_skipped: skipped,
      flag_count: computed.filter((c) => c.verdict === "flag").length,
      error: synth.error,
    }, 502);
  }

  // Computed first: they are arithmetic, and they are the ones to trust.
  const modelChecks = (Array.isArray(synth.value.checks) ? synth.value.checks : []) as { name?: string; verdict?: string }[];
  const checks = [...computed, ...modelChecks];
  const flags = checks.filter((c) => (c as { verdict?: string })?.verdict === "flag").length;

  root.setAttributes({ "yaadly.vetting.review": "reviewed", "yaadly.vetting.flag_count": flags });
  return save({
    summary: s(synth.value.summary).slice(0, 1200),
    checks,
    questions: Array.isArray(synth.value.questions) ? synth.value.questions : [],
    extracted,
    docs_read: loaded.map((f) => f.doc),
    docs_skipped: skipped,
    flag_count: flags,
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const trace = new Trace("yaad-vetting-review", req);
  const root = trace.startSpan(`${req.method} /yaad-vetting-review`, SpanKind.SERVER, httpAttrs(req));
  const done = (res: Response, status: number) => {
    root.setAttributes({ "http.response.status_code": status });
    root.end(); trace.flush(); return res;
  };
  const json = (b: unknown, status = 200) =>
    done(new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } }), status);

  try {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
    if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: "Not configured." }, 500);

    const who = await callerAllowed(req);
    if (!who) {
      root.setAttributes({ "yaadly.auth.outcome": "rejected" });
      return json({ error: "Admin sign in required." }, 403);
    }
    root.setAttributes({ "yaadly.auth.outcome": "authenticated", "yaadly.auth.caller": who });

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const appId = s(body.applicationId);
    if (!appId) return json({ error: "Which application?" }, 400);

    // ── who waits, and who does not ──
    //
    // The desk passes wait:true and gets the finished review, because a person
    // is sitting there watching. That path is the reliable one: a real client
    // on a real connection, nothing depending on background execution.
    //
    // A submit takes this branch and tries to get the review done in advance,
    // so it is already waiting when the desk opens the application. Best
    // effort, and known to be: the isolate is reclaimed around the minute mark
    // and a three-pass review sometimes needs longer. When it does not finish,
    // the desk runs it on open instead.
    if (who === "internal" && body.wait !== true) {
      // A thrown error here used to vanish: the catch swallowed it, no row was
      // written, and the desk saw the same empty box it shows when nothing has
      // run at all. Silence and "the machine found nothing" must never look
      // alike, so a failure writes itself down.
      const work = (async () => {
        try {
          await review(trace, root, appId);
        } catch (e) {
          try {
            await createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
              .from("vetting_reviews").insert({
                application_id: appId, model: MODEL,
                summary: "The automatic run failed. Press Run the check again on the desk.",
                checks: [], questions: [], extracted: [], docs_read: [], docs_skipped: [], flag_count: 0,
                error: String(e).slice(0, 400),
              });
          } catch (_) { /* nothing left to try */ }
        }
      })();

      const rt = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
      if (rt?.waitUntil) {
        rt.waitUntil(work);
        root.setAttributes({ "yaadly.vetting.review": "started" });
        return json({ ok: true, status: "started" }, 202);
      }

      // No waitUntil in this runtime. Awaiting would hold the response open for
      // the whole review and the isolate is killed around the minute mark, so
      // do not pretend: say the automatic run is unavailable and leave it to
      // the desk, which has a person waiting on a connection that stays open.
      root.setAttributes({ "yaadly.vetting.review": "no_background" });
      return json({ ok: false, status: "not_started", reason: "This runtime has no background execution. The desk runs the review when the application is opened." }, 202);
    }

    const out = await review(trace, root, appId);
    return json(out.body, out.status);
  } catch (e) {
    root.recordError(e);
    return json({ error: String(e).slice(0, 300) }, 500);
  }
});
