import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { Trace, SpanKind, httpAttrs } from "./otel.ts";
import { pickTextProvider, providerAttrs } from "./textmodel.ts";

// The six-step "Post a job" wizard on yaadly.co.uk posts here twice.
//
//   mode:"draft"   at step 2, the moment there is a description and a job
//                  card. Someone who closes the tab at step 4 comes back to
//                  a saved job rather than an empty form, which is the whole
//                  reason the draft is written early and not at the end.
//
//   mode:"golive"  at step 6, when they tick the box and type their name.
//                  Creates the account, records the signature, and attaches
//                  the client to the draft.
//
// What this function deliberately does NOT do is open the job.
//
// jobs.open is guarded by enforce_signed_before_open, which calls
// client_cleared_for_golive(client_email). That requires BOTH a current
// client_guidelines signature AND an active row in client_profiles. This
// function writes the signature; it does not write the profile. The profile
// is created in the portal after the client has clicked the confirmation
// link in their email.
//
// That ordering is on purpose. Accounts are created unconfirmed (same as
// yaad-portal-signup) because possession of an email address is not proof
// you can read that mailbox. If this function created the profile too, then
// anyone could post a job in somebody else's name and have it go live to
// workers. Leaving the profile to the portal keeps the invariant in Postgres
// where it belongs, and means no code path here can talk its way past it.
//
// verify_jwt is off: a visitor filling in this form has no session at all,
// the same trust level the public intake endpoint already had. The job id is
// generated server-side and only ever returned to the browser that created
// it, so possession of it is what lets that browser claim its own draft.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const s = (v: unknown) => String(v ?? "").trim();

/** Scope that is safe on the public board. Money never appears here: the
 *  budget band lives in its own column and open_jobs does not select it. */
function buildDescr(b: Record<string, unknown>) {
  return [
    s(b.desc),
    s(b.propertyType) ? `Property: ${s(b.propertyType)}` : "",
    s(b.storey) ? `Access height: ${s(b.storey)}` : "",
    s(b.startDate) ? `Requested start: ${s(b.startDate)}` : "",
    Number(b.stages) ? `Stages: ${Number(b.stages)}` : "",
    Array.isArray(b.evidence) && b.evidence.length
      ? `Evidence required: ${(b.evidence as string[]).map(s).join("; ")}`
      : "",
    "Submitted through the job wizard on yaadly.co.uk.",
  ].filter(Boolean).join("\n");
}

/** The client's answer to where materials are kept, mapped to the three codes
 *  jobs_materials_store_type_chk permits.
 *
 *  Mapped HERE rather than posted as a code from the page, so a stale cached
 *  copy of yaadly.co.uk cannot write a value the database has never heard of.
 *  Anything unrecognised becomes null, and null is refused by the materials
 *  gate rather than quietly passing as an answer. Fail closed: an unanswered
 *  question about who carries a stolen load is the one thing that must not
 *  slip through as a blank. */
const STORE_TYPE: Record<string, string> = {
  "a lockable room, store or container on site": "lockable",
  "indoors, inside the house": "indoors",
  "nowhere securable, buy in drops": "none_available",
};

/** Columns the job card maps onto one-for-one. */
function cardCols(b: Record<string, unknown>) {
  const storeType = STORE_TYPE[s(b.materialsStore).toLowerCase()] ?? null;
  return {
    trade: s(b.workType) || null,
    trade_source: s(b.workType) ? "wizard" : null,
    job_type: s(b.jobType) || null,
    size_band: s(b.sizeBand) || null,
    access_type: s(b.accessType) || null,
    materials_by: s(b.materialsBy) || null,
    // Free text, and it names where the valuable things are kept on a property
    // that is often empty. open_jobs publishes the type and withholds this.
    materials_store: storeType === "none_available"
      ? null
      : (s(b.materialsStoreWhere).slice(0, 160) || null),
    materials_store_type: storeType,
    urgency: s(b.urgency) || null,
    budget_band: s(b.budgetBand) || null,   // never published, see open_jobs
  };
}



// ── The intake agent ─────────────────────────────────────────────────────
//
// Runs HERE, on the server, not from the browser. The build sheet flags the
// reason: firing an AI endpoint for somebody with no account and nothing at
// stake is a bill waiting to happen. Calling it from inside the draft write
// means the only way to reach the model is to actually be posting a job.
//
// It reviews what the person wrote and returns the fields a worker needs to
// quote without a phone call first. It never invents money: budget and
// materials are the client's to state, and a guess there would be Yaadly
// pricing work, which is the one thing the founder rule excludes.
//
// If it fails, the draft still saves. A job with an untidied description is
// worth far more than no job.
// Model and endpoint come from _shared/textmodel.ts. See that file for why.

// The 18 trades are the routing key: workers subscribe by trade and the board
// filters on it, so this list is not free text and never has been.
const TRADES = [
  "Plumbing", "Roofing", "Electrical", "Tiling", "Masonry & Concrete",
  "Painting & Decorating", "Grille & Gate Welding", "Air Conditioning",
  "Landscaping", "General Handyman", "Solar Install", "Water Tank & Pump",
  "Locks & Security Doors", "Windows & Glazing", "Carpentry & Joinery",
  "Drainage & Septic", "Fencing", "CCTV & Alarms",
];

// Every other list the model may answer from is sent up by the page, because
// the taxonomy lives in one place (data/job-taxonomy.js) and a second copy
// here would drift the first time a job type is added. Size bands and job
// types are keyed Trade|Type, so only the browser knows which ones apply.
//
// They are still treated as text from a stranger: capped in count and length,
// newlines stripped so nothing can be smuggled in as an instruction, and every
// answer checked back against the list it came from before it reaches the card
// or the row. The worst a caller can do is widen the options on their own job.
type Lists = Record<string, string[]>;

const LIST_KEYS = [
  "job_type", "property_type", "parish", "size_band", "storey", "access_type", "urgency",
] as const;

function cleanLists(raw: unknown): Lists {
  const out: Lists = {};
  const src = (raw ?? {}) as Record<string, unknown>;
  for (const k of LIST_KEYS) {
    const v = Array.isArray(src[k]) ? (src[k] as unknown[]) : [];
    const list = v.slice(0, 40)
      .map((x) => s(x).replace(/[\r\n]+/g, " ").slice(0, 80))
      .filter(Boolean);
    if (list.length) out[k] = list;
  }
  return out;
}

/** An answer counts only if it is one of the options we offered, matched
 *  case-insensitively and handed back in the list's own spelling. Anything
 *  else is dropped rather than corrected: a blank the client fills herself is
 *  worth more than a value nothing downstream recognises. */
function fromList(value: unknown, list: string[] | undefined): string {
  const v = s(value);
  if (!v || !list?.length) return "";
  return list.find((o) => o.toLowerCase() === v.toLowerCase()) ?? "";
}

function agentPrompt(lists: Lists): string {
  const pick = (key: string, label: string) =>
    lists[key]?.length
      ? `${label}: copy one value EXACTLY from this list, or "" if the text does not say. ${lists[key].join(" | ")}`
      : `${label}: always "".`;
  return `You read a property job described in plain words, often in Jamaican
Patois, and return JSON only. Never invent facts. Never state a price, a budget
or a cost. If something is not in the text, use "".

Return exactly:
{"title":"", "scope":"", "trade":"", "job_type":"", "property_type":"",
 "parish":"", "size_band":"", "storey":"", "access_type":"", "urgency":"",
 "access_note":"", "questions":["",""]}

title: six words maximum, what the job is.
scope: the same facts rewritten so a tradesperson can quote from them. Keep the
  client's meaning. Do not add work nobody asked for.
trade: copy one value EXACTLY from this list, or "" if genuinely unclear.
  ${TRADES.join(" | ")}
${pick("job_type", "job_type")}
${pick("property_type", "property_type")}
${pick("parish", "parish")}
${pick("size_band", "size_band")}
${pick("storey", "storey")}
${pick("access_type", "access_type")}
${pick("urgency", "urgency")}
access_note: anything said about getting in or who is on the ground.
questions: the two things a worker would ring up and ask before quoting.

You are never asked who pays for materials, where materials are kept, or what
the budget is. Those are the client's to state and a guess there would be
Yaadly pricing the work, which Yaadly does not do. Leave them out entirely.`;
}

type Read = {
  title: string; scope: string; access_note: string; trade: string;
  job_type: string; property_type: string; parish: string; size_band: string;
  storey: string; access_type: string; urgency: string; questions: string[];
};

async function readTheJob(text: string, lists: Lists, trace: Trace): Promise<Read | null> {
  const prov = pickTextProvider();
  if (!prov || text.length < 12) return null;
  try {
    return await trace.span(`chat ${prov.model}`, SpanKind.CLIENT, {
      ...providerAttrs(prov),
      "gen_ai.operation.name": "chat",
    }, async (sp) => {
      const r = await fetch(prov.api, {
        method: "POST",
        headers: { Authorization: `Bearer ${prov.key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: prov.model, temperature: 0.2, max_tokens: 900,
          messages: [
            { role: "system", content: agentPrompt(lists) },
            { role: "user", content: text.slice(0, 6000) },
          ],
        }),
        signal: AbortSignal.timeout(20000),
      });
      const raw = await r.text();
      sp.setAttributes({ "http.response.status_code": r.status });
      if (!r.ok) { sp.recordError(`${prov.name} http ${r.status}`); return null; }
      let j: any = {};
      try { j = JSON.parse(raw); } catch (_) { return null; }
      const content = j?.choices?.[0]?.message?.content ?? "";
      const m = String(content).match(/\{[\s\S]*\}/);
      if (!m) return null;
      let out: any;
      try { out = JSON.parse(m[0]); } catch (_) { return null; }
      return {
        title: s(out.title).slice(0, 120),
        scope: s(out.scope).slice(0, 2000),
        access_note: s(out.access_note).slice(0, 300),
        trade: fromList(out.trade, TRADES),
        job_type: fromList(out.job_type, lists.job_type),
        property_type: fromList(out.property_type, lists.property_type),
        parish: fromList(out.parish, lists.parish),
        size_band: fromList(out.size_band, lists.size_band),
        storey: fromList(out.storey, lists.storey),
        access_type: fromList(out.access_type, lists.access_type),
        urgency: fromList(out.urgency, lists.urgency),
        questions: Array.isArray(out.questions)
          ? out.questions.map((q: unknown) => s(q).slice(0, 240)).filter(Boolean).slice(0, 3)
          : [],
      };
    });
  } catch (_) { return null; }
}

// ───────────────────────── throttle ─────────────────────────
//
// This endpoint calls a model, and the only credential it needs is the
// publishable key printed in the page source. Without a cap, one loop drains
// the model balance and fills the jobs table.
//
// Two limits, because they stop two different things. PER_CALLER stops one
// person flooding the table. MODEL_PER_HOUR is a hard ceiling on spend
// whoever is behind it, and when it trips the draft is still saved: the job
// is the client's, the model enrichment is a nicety, so the nicety is what
// gets dropped rather than their work.
const PER_CALLER_PER_HOUR = 8;
const MODEL_PER_HOUR = 120;

// A throttle key, not a visitor log. The address is hashed and truncated and
// never stored, so this cannot be read back as an IP and nothing joins to it.
async function callerKey(req: Request): Promise<string> {
  const raw = req.headers.get("cf-connecting-ip")
           ?? (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim()
           ?? "";
  const bytes = new TextEncoder().encode("yaadly-post-job:" + raw);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).slice(0, 16)
    .map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* ── who is posting ───────────────────────────────────────────────────────
   Nobody, and that is the point.

   signedInUser and verifyPassword lived here and went with the go live
   branch on 31 Aug 2026. Both existed to decide whether the person finishing
   a job already had an account and whether their password was right. There
   are no passwords in the client journey any more, and this function does
   not need to know who is asking: draft mode is deliberately anonymous and
   writes no name, email or phone number onto the row at all. */

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const trace = new Trace("yaad-post-job", req);
  const root = trace.startSpan(`${req.method} /yaad-post-job`, SpanKind.SERVER, httpAttrs(req));
  const done = (res: Response, status: number) => {
    root.setAttributes({ "http.response.status_code": status });
    root.end(); trace.flush(); return res;
  };
  const json = (body: unknown, status = 200) =>
    done(new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } }), status);

  try {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
    if (!SUPABASE_URL || !SERVICE_KEY) {
      root.recordError("service role key not available");
      return json({ error: "Posting is not configured. Message Yaadly." }, 500);
    }

    const b = await req.json().catch(() => ({})) as Record<string, unknown>;
    const mode = s(b.mode) === "golive" ? "golive" : "draft";
    const desc = s(b.desc);
    // Explicit. Anything other than a literal true is a no, including absent.
    const assist = b.assist === true;
    root.setAttributes({ "yaadly.post.mode": mode, "yaadly.job.trade": s(b.workType), "yaadly.agent.asked": assist });

    if (!desc) return json({ error: "A description of the job is needed." }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Counted before anything is written or sent to a model.
    const key = await callerKey(req);
    const hourAgo = new Date(Date.now() - 3600_000).toISOString();

    const { count: mine } = await admin.from("post_job_attempts")
      .select("id", { count: "exact", head: true })
      .eq("caller_key", key).gt("created_at", hourAgo);
    if ((mine ?? 0) >= PER_CALLER_PER_HOUR) {
      root.setAttributes({ "yaadly.post.throttled": "caller" });
      return json({ error: "That is a lot of job requests in one hour. Give it a little while, or message us on WhatsApp and we will finish it with you." }, 429);
    }

    const { count: modelCalls } = await admin.from("post_job_attempts")
      .select("id", { count: "exact", head: true })
      .eq("used_model", true).gt("created_at", hourAgo);
    const modelBudgetLeft = (modelCalls ?? 0) < MODEL_PER_HOUR;
    root.setAttributes({ "yaadly.post.model_budget_left": modelBudgetLeft });

    const parish = s(b.parish);
    const addr = s(b.addr);
    const access = s(b.access);
    const photos: string[] = Array.isArray(b.photos) ? (b.photos as string[]).slice(0, 8) : [];

    // The voice note recorded at step 2. It rides the same JSON the photos
    // ride and lands in evidence like them, so the person reviewing the job
    // hears the words exactly as the client said them. The transcript already
    // went into desc on the client side; what arrives here in voiceNoteText
    // is kept on the evidence row so the recording and its machine reading
    // stay together. The prefix check is the whole validation: anything that
    // is not an audio data URL is not a voice note and is ignored.
    const voiceNote = typeof b.voiceNote === "string" && b.voiceNote.startsWith("data:audio/")
      ? b.voiceNote : "";
    if (voiceNote.length > 8_000_000) return json({ error: "That voice note is too big. Three minutes is the most the form takes." }, 413);
    const voiceNoteText = s(b.voiceNoteText).slice(0, 4000);
    if (voiceNote) root.setAttributes({ "yaadly.post.voice_note_chars": voiceNote.length });

    // Files the clip against the job as evidence so the person reviewing it
    // can listen before it reaches the board. One per job: the wizard saves
    // the same draft several times on the way through (the assistant button,
    // every Continue, go live), and three copies of the same clip helps
    // nobody. The clip is never re-filed and never replaced, because the
    // recording is the record; changing your mind is what Remove and
    // re-record are for on the form, before it is sent.
    const attachVoiceNote = async (jobId: string) => {
      if (!voiceNote) return;
      const { data: had } = await admin.from("evidence")
        .select("id").eq("job_id", jobId).eq("label", "Client voice note").limit(1);
      if (had?.length) return;
      const mime = voiceNote.slice(5, voiceNote.indexOf(";"));
      const { error } = await admin.from("evidence").insert({
        job_id: jobId, label: "Client voice note", mime,
        meta: voiceNoteText
          ? `Recorded in the job wizard. The speech service wrote it out as: ${voiceNoteText}`
          : "Recorded in the job wizard. The speech service could not write it out, so listen to it.",
        img: voiceNote, ok: true,
      });
      if (error) console.warn("voice note insert:", error.message);
    };

    // ───────────────────────── draft ─────────────────────────
    if (mode === "draft") {
      const existing = s(b.jobId);
      const row = {
        title: s(b.workType) ? `${s(b.workType)} job, ${parish || "Jamaica"}` : "Job request",
        parish, descr: buildDescr(b), addr, access_contact: access,
        ...cardCols(b), stage: 0, open: false,
      };

      if (existing) {
        // Only an unclaimed draft can be updated by an anonymous caller.
        const { data: cur } = await admin.from("jobs")
          .select("id, client_email").eq("id", existing).maybeSingle();
        if (cur && !s(cur.client_email)) {
          const { error } = await admin.from("jobs").update(row).eq("id", existing);
          if (error) { root.recordError(error.message); return json({ error: error.message }, 500); }
          // Recorded after the draft was first written, which is the common
          // shape: the draft lands on the first Continue, the voice note can
          // come any time the client is back on step 2.
          await attachVoiceNote(existing);
          const { data } = await admin.from("jobs").select("portal_code").eq("id", existing).single();
          root.setAttributes({ "yaadly.post.outcome": "draft_updated" });
          return json({ ok: true, jobId: existing, portalCode: data?.portal_code ?? null });
        }
      }

      const jobId = `JOB-WEB-${Date.now()}`;

      // The agent reads it before it becomes a row, and ONLY when the client
      // pressed the button that asks it to. It used to run on every draft,
      // which meant a model read the words of somebody who had been told on
      // that very screen that no assistant was involved. The button is the
      // consent, so the flag is what fires the model.
      //
      // Anything it returns is a suggestion the client can still overwrite on
      // the next screen; nothing it says about money is used, because it is
      // not asked about money.
      const read = (assist && modelBudgetLeft) ? await readTheJob(desc, cleanLists(b.options), trace) : null;
      // Recorded whether or not the model ran, so the per-caller count covers
      // every request and the global count only covers the ones that cost.
      await admin.from("post_job_attempts").insert({ caller_key: key, used_model: !!read });
      // try/catch, not .catch(): the query builder is thenable but does not
      // implement .catch, so calling it throws TypeError rather than swallowing
      // anything. Housekeeping must never be able to fail a real request.
      if (Math.random() < 0.02) {
        try { await admin.rpc("post_job_attempts_sweep"); } catch (_) { /* housekeeping only */ }
      }
      if (!modelBudgetLeft) root.setAttributes({ "yaadly.post.model_skipped": "hourly cap" });
      if (read) {
        root.setAttributes({ "yaadly.agent.read": true, "yaadly.agent.trade": String(read.trade ?? "") });
        if (!row.trade && s(read.trade)) { row.trade = s(read.trade); row.trade_source = "model"; }  // jobs_trade_source_chk: wizard | model | regex | admin
        if (!row.job_type && read.job_type) row.job_type = read.job_type;
        if (!row.urgency && read.urgency) row.urgency = read.urgency;
        if (!row.size_band && read.size_band) row.size_band = read.size_band;
        if (!row.access_type && read.access_type) row.access_type = read.access_type;
        if (!row.parish && read.parish) row.parish = read.parish;
        if (s(read.title)) row.title = s(read.title);
        const qs = Array.isArray(read.questions) ? read.questions.filter(Boolean).map(s) : [];
        if (s(read.scope) || qs.length) {
          row.descr = [
            s(read.scope) || desc,
            s(read.access_note) ? `Access: ${s(read.access_note)}` : "",
            qs.length ? `Worth confirming before quoting: ${qs.join("; ")}` : "",
            "",
            `In the client's own words: ${desc}`,
            row.descr.split("\n").slice(1).join("\n"),
          ].filter(Boolean).join("\n");
        }
      }

      const { data, error } = await admin.from("jobs")
        .insert({ id: jobId, client_name: "", client_email: "", client_phone: "", ...row })
        .select("portal_code").single();
      if (error) { root.recordError(error.message); return json({ error: error.message }, 500); }

      if (photos.length) {
        const rows = photos.map((img, i) => ({
          job_id: jobId, label: `Client photo ${i + 1}`,
          meta: "From the job wizard", img, ok: true,
        }));
        const { error: evErr } = await admin.from("evidence").insert(rows);
        if (evErr) console.warn("evidence insert:", evErr.message);
      }
      await attachVoiceNote(jobId);

      root.setAttributes({ "yaadly.post.outcome": "draft_created", "yaadly.job.id": jobId });
      // The read goes back to the page as well as into the row. Writing it to
      // the row alone was the old shape, and it meant the client filled twelve
      // fields by hand and the agent's answers were thrown away behind her.
      return json({ ok: true, jobId, portalCode: data?.portal_code ?? null, read });
    }

    /* GO LIVE IS GONE (31 Aug 2026, Stage 3).
     *
     * This branch created an account from a password, captured the Client
     * Guidelines signature and opened the job, and it was step 6 of the
     * five step funnel that used to live in docs/index.html. That funnel was
     * deleted in Stage 1 and nothing has called this since.
     *
     * Removing it is not tidying. It was a SECOND account creation path, it
     * took a password, and the whole client journey moved to a six digit
     * code with no password anywhere. A dead endpoint that can still mint
     * password accounts is exactly the kind of thing that quietly outlives
     * the decision to stop doing it.
     *
     * What replaced each part: accounts come from yaad-portal-code, the
     * Guidelines signature is signed in the portal, and a job is opened by
     * the client_go_live RPC, which enforce_signed_before_open still guards.
     * Draft mode above is untouched and is what web/app/jobs/new calls.
     */
    root.setAttributes({ "yaadly.post.outcome": "golive_retired" });
    return json({
      error: "This way of finishing a job has been retired. Your job is saved as a draft. Open your portal to sign the Client Guidelines and put it live.",
    }, 410);

  } catch (e) {
    root.recordError(e);
    return json({ error: "Something went wrong. Your draft is saved, try again or message Yaadly." }, 500);
  }
});
