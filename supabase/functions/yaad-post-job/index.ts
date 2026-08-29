import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { Trace, SpanKind, httpAttrs } from "./otel.ts";

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
const MIN_PASSWORD = 8;

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
const MINIMAX_API = "https://api.minimax.io/v1/chat/completions";
const AGENT_MODEL = "MiniMax-M2.7";

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
  const key = Deno.env.get("MINIMAX_API_KEY");
  if (!key || text.length < 12) return null;
  try {
    return await trace.span(`chat ${AGENT_MODEL}`, SpanKind.CLIENT, {
      "gen_ai.system": "minimax",
      "gen_ai.operation.name": "chat",
      "gen_ai.request.model": AGENT_MODEL,
      "server.address": "api.minimax.io",
    }, async (sp) => {
      const r = await fetch(MINIMAX_API, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: AGENT_MODEL, temperature: 0.2, max_tokens: 900,
          messages: [
            { role: "system", content: agentPrompt(lists) },
            { role: "user", content: text.slice(0, 6000) },
          ],
        }),
        signal: AbortSignal.timeout(20000),
      });
      const raw = await r.text();
      sp.setAttributes({ "http.response.status_code": r.status });
      if (!r.ok) { sp.recordError(`minimax http ${r.status}`); return null; }
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

// ── who is posting ───────────────────────────────────────────────────────
//
// An email address is a claim. These two turn it into proof.
//
// signedInUser reads a real session token off the request. The page sends the
// publishable key in that header when nobody is signed in, so anything that is
// not a three-part JWT is not a session and is not asked about.
// The auth server is asked, rather than the token being decoded and believed.
// A signature and an account are downstream of the answer, so "who is this"
// has to come from something that checks, not from base64 the caller wrote.
async function signedInUser(req: Request) {
  const tok = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!tok || !tok.startsWith("ey") || tok.split(".").length !== 3) return null;
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (!anon) return null;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: anon, Authorization: `Bearer ${tok}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) return null;
    const u = await r.json();
    const email = s(u?.email).toLowerCase();
    if (!u?.id || !email) return null;
    return {
      id: String(u.id),
      email,
      confirmed: Boolean(u.email_confirmed_at ?? u.confirmed_at),
    };
  } catch (_) { return null; }
}

// verifyPassword is for the client who is not signed in but whose email is
// already known here. An account that has never confirmed its email cannot
// sign in at all, and the token endpoint says so specifically, so that answer
// counts as the password being right. It is the only thing being asked.
async function verifyPassword(email: string, password: string): Promise<"ok" | "unconfirmed" | "wrong"> {
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (!anon || !password) return "wrong";
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: anon },
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(10000),
    });
    if (r.ok) return "ok";
    const j = await r.json().catch(() => ({}));
    const said = `${j?.error_code ?? ""} ${j?.error ?? ""} ${j?.msg ?? ""} ${j?.error_description ?? ""}`;
    return /not.?confirmed/i.test(said) ? "unconfirmed" : "wrong";
  } catch (_) { return "wrong"; }
}

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

      root.setAttributes({ "yaadly.post.outcome": "draft_created", "yaadly.job.id": jobId });
      // The read goes back to the page as well as into the row. Writing it to
      // the row alone was the old shape, and it meant the client filled twelve
      // fields by hand and the agent's answers were thrown away behind her.
      return json({ ok: true, jobId, portalCode: data?.portal_code ?? null, read });
    }

    // ───────────────────────── go live ─────────────────────────
    const jobId    = s(b.jobId);
    const email    = s(b.email).toLowerCase();
    const name     = s(b.name);
    const phone    = s(b.phone);
    const password = String(b.password ?? "");
    const sig      = s(b.signature);
    const consent  = s(b.consentText);
    let version   = s(b.guidelinesVersion);

    // A session for THIS email, or nothing. Someone signed in as one person
    // cannot post as another: the token has to match the email on the form.
    const session = await signedInUser(req);
    const signedIn = !!session && session.email === email;
    root.setAttributes({ "yaadly.post.signed_in": signedIn });

    if (!jobId) return json({ error: "That draft could not be found. Start again and it will save as you go." }, 400);
    if (!name) return json({ error: "Your name is needed." }, 400);
    if (!email || !email.includes("@")) return json({ error: "A valid email is needed." }, 400);
    if (!phone) return json({ error: "A phone or WhatsApp number is needed." }, 400);
    if (!signedIn && password.length < MIN_PASSWORD) return json({ error: `Password needs to be at least ${MIN_PASSWORD} characters.` }, 400);
    // The signature is checked further down, once we know whether this person
    // has already signed the version in force. Somebody who signed it last
    // month is not asked to sign it again.

    // The draft must exist and must not already belong to somebody else.
    const { data: job, error: jobErr } = await admin.from("jobs")
      .select("id, client_email").eq("id", jobId).maybeSingle();
    if (jobErr) { root.recordError(jobErr.message); return json({ error: "Could not read that job." }, 500); }
    if (!job) return json({ error: "That draft could not be found." }, 404);
    if (s(job.client_email) && s(job.client_email).toLowerCase() !== email) {
      root.setAttributes({ "yaadly.post.outcome": "job_claimed_by_other" });
      return json({ error: "That job already belongs to another account." }, 403);
    }

    // The account. Three cases, and they are not the same trust level.
    //
    //   signed in       the browser sent a session token for this email.
    //                   Nothing is created, no password is asked for, and a
    //                   signature they already gave still counts.
    //
    //   new email       created unconfirmed on purpose: the confirmation link
    //                   is what proves the mailbox is theirs, and that is what
    //                   later lets the job open.
    //
    //   known email,    the password is checked BEFORE anything is written.
    //   not signed in   This used to be waved through. createUser failed with
    //                   "already registered", the code carried on, and a
    //                   signature in somebody else's name went onto their
    //                   account with their job attached. Any eight characters
    //                   did it. An account that has never confirmed its email
    //                   cannot sign in yet, so "email not confirmed" from the
    //                   token endpoint counts as the password being right.
    let emailed = false;
    let user: { id: string; confirmed: boolean };

    if (signedIn && session) {
      user = { id: session.id, confirmed: session.confirmed };
      root.setAttributes({ "yaadly.post.account": "session" });
    } else {
      const { error: createErr } = await admin.auth.admin.createUser({ email, password, email_confirm: false });
      const alreadyExisted = !!createErr && /already|registered|exists/i.test(String(createErr.message || ""));
      if (createErr && !alreadyExisted) {
        root.recordError(String(createErr.message));
        return json({ error: "Could not create the account. Try again, or message Yaadly." }, 502);
      }

      if (alreadyExisted) {
        const proof = await verifyPassword(email, password);
        if (proof === "wrong") {
          root.setAttributes({ "yaadly.post.outcome": "existing_account_not_proven" });
          return json({
            error: "That email already has a Yaadly account. Sign in with it and this job attaches to it, or use a different email.",
            accountExists: true,
          }, 403);
        }
        root.setAttributes({ "yaadly.post.account": "existing_password_checked" });
      } else {
        root.setAttributes({ "yaadly.post.account": "created" });
        try {
          const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
          const r = await fetch(`${SUPABASE_URL}/auth/v1/resend`, {
            method: "POST",
            headers: { "Content-Type": "application/json", apikey: anon, Authorization: `Bearer ${anon}` },
            body: JSON.stringify({ type: "signup", email }),
          });
          emailed = r.ok;
          if (!r.ok) root.recordError(`confirmation email not sent: ${r.status}`);
        } catch (e) { root.recordError(`confirmation email threw: ${String(e).slice(0, 200)}`); }
      }

      // Find the user so the signature can be attributed. doc_signatures.signer_user
      // is NOT NULL by design: a signature that is not tied to an account is not a
      // signature, it is a checkbox.
      const { data: list } = await admin.auth.admin.listUsers();
      const found = list?.users?.find((u) => (u.email ?? "").toLowerCase() === email);
      if (!found) {
        root.recordError("user not found after create");
        return json({ error: "Could not attach your signature to an account. Message Yaadly." }, 502);
      }
      user = {
        id: found.id,
        confirmed: Boolean(found.email_confirmed_at ?? (found as { confirmed_at?: string }).confirmed_at),
      };
    }
    const confirmed = user.confirmed;

    // The version the page DISPLAYED is what gets recorded, because a signature
    // belongs to the words the person actually read. A stale cached page
    // signing 1.2 records 1.2, and the portal then asks them to re-sign the
    // current one, which is exactly what versioned signatures are for.
    //
    // The fallback is the one thing that must not be a guess. It used to be the
    // literal "1.0", which quietly stamped a signature against a version nobody
    // had seen, and which drifted out of step with app_settings the moment the
    // wording moved on. Ask the database what is in force instead.
    //
    // Resolved here rather than with the other fields above so that a request
    // missing a name is told about the name, not billed a database round trip
    // and then told something about guidelines versions.
    if (!version) {
      const { data: cur } = await admin.from("app_settings")
        .select("value").eq("key", "client_guidelines_version").maybeSingle();
      version = s(cur?.value);
      root.setAttributes({ "yaadly.guidelines.version_from": "app_settings" });
    }
    if (!version) {
      root.recordError("no guidelines version available to stamp");
      return json({ error: "Could not confirm which Client Guidelines you signed. Nothing was recorded, and nothing was charged. Message Yaadly." }, 500);
    }

    // The signature. One row per version: signing again for a new version is a
    // new row, never an edit of the old one.
    //
    // A returning client who has already signed the version in force is not
    // asked to sign it again. That is the whole point of versioning them: the
    // question is "have these words been agreed", not "has a box been ticked
    // today". A version bump brings the box back for everybody.
    const { data: prior } = await admin.from("doc_signatures")
      .select("id")
      .eq("signer_user", user.id)
      .eq("doc_type", "client_guidelines")
      .eq("doc_version", version)
      .limit(1);
    const alreadySigned = !!prior?.length;
    root.setAttributes({ "yaadly.guidelines.already_signed": alreadySigned });

    if (!alreadySigned) {
      if (sig.length < 3) return json({ error: "Type your full name to sign." }, 400);
      const { error: sigErr } = await admin.from("doc_signatures").insert({
        signer_user: user.id,
        signer_email: email,
        signer_name: sig,
        doc_type: "client_guidelines",
        doc_version: version,
        consent_text: consent || `Client Guidelines v${version} accepted through the job wizard.`,
      });
      if (sigErr) { root.recordError(sigErr.message); return json({ error: "Could not record the signature. Nothing was charged, message Yaadly." }, 500); }
    }

    // Attach the client and their final answers to the draft.
    const { error: updErr } = await admin.from("jobs").update({
      client_name: name, client_email: email, client_phone: phone,
      parish, addr, access_contact: access,
      title: s(b.workType) ? `${s(b.workType)} job for ${name}` : `Job for ${name}`,
      descr: buildDescr(b), ...cardCols(b),
    }).eq("id", jobId);
    if (updErr) { root.recordError(updErr.message); return json({ error: updErr.message }, 500); }

    if (photos.length) {
      const rows = photos.map((img, i) => ({
        job_id: jobId, label: `Client photo ${i + 1}`,
        meta: "From the job wizard", img, ok: true,
      }));
      const { error: evErr } = await admin.from("evidence").insert(rows);
      if (evErr) console.warn("evidence insert:", evErr.message);
    }

    // Ask the database to open it. It will refuse until the client is cleared,
    // which needs the profile as well as this signature, and the profile only
    // exists once they have confirmed their email in the portal. A refusal here
    // is the system working, not an error, so it is reported as "not open yet".
    let open = false;
    if (confirmed) {
      const { error: openErr } = await admin.from("jobs").update({ open: true }).eq("id", jobId);
      open = !openErr;
      if (openErr) root.setAttributes({ "yaadly.post.golive_refused": openErr.message.slice(0, 120) });
    }

    // Tell Monique. Fire and forget, and no contact details leave for the relay.
    const notify = (async () => {
      try {
        const { data: st } = await admin.from("app_settings").select("value").eq("key", "ntfy_topic").single();
        if (!st?.value) return;
        await fetch(`https://ntfy.sh/${st.value}`, {
          method: "POST",
          headers: { Title: "Job signed on the website", Priority: "high", Tags: "house" },
          body: `${jobId}: ${s(b.workType) || "job"}, ${parish || "parish not given"}. Guidelines v${version} signed. ${open ? "Live on the board." : "Waiting on email confirmation."}`,
          signal: AbortSignal.timeout(4000),
        });
      } catch (_) { /* never let a notification break a signature */ }
    })();
    const rt = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
    if (rt?.waitUntil) rt.waitUntil(notify);

    root.setAttributes({ "yaadly.post.outcome": open ? "live" : "signed_awaiting_confirmation", "yaadly.job.id": jobId });
    return json({ ok: true, jobId, open, emailed, alreadySigned, signedIn, guidelinesVersion: `v${version}` });

  } catch (e) {
    root.recordError(e);
    return json({ error: "Something went wrong. Your draft is saved, try again or message Yaadly." }, 500);
  }
});
