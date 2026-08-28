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

/** Columns the job card maps onto one-for-one. */
function cardCols(b: Record<string, unknown>) {
  return {
    trade: s(b.workType) || null,
    trade_source: s(b.workType) ? "wizard" : null,
    job_type: s(b.jobType) || null,
    size_band: s(b.sizeBand) || null,
    access_type: s(b.accessType) || null,
    materials_by: s(b.materialsBy) || null,
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

const AGENT_PROMPT = `You read a property job described in plain words, often
in Jamaican Patois, and return JSON only. Never invent facts. Never state a
price, a budget or a cost. If something is not in the text, use "".

Return exactly:
{"title":"", "scope":"", "trade":"", "job_type":"", "urgency":"",
 "access_note":"", "questions":["",""]}

title: six words maximum, what the job is.
scope: the same facts rewritten so a tradesperson can quote from them. Keep
  the client's meaning. Do not add work nobody asked for.
trade: one of Plumbing, Roofing, Electrical, Tiling, Masonry & Concrete,
  Painting & Decorating, Grille & Gate Welding, Air Conditioning, Landscaping,
  General Handyman, Solar Install, Water Tank & Pump, Locks & Security Doors,
  Windows & Glazing, Carpentry & Joinery, Drainage & Septic, Fencing,
  CCTV & Alarms. Empty if genuinely unclear.
urgency: Emergency, within 48 hours | Within two weeks | Within a month |
  Flexible, planning ahead. Empty if not stated.
questions: the two things a worker would ring up and ask before quoting.`;

async function readTheJob(text: string, trace: Trace) {
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
            { role: "system", content: AGENT_PROMPT },
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
      try { return JSON.parse(m[0]); } catch (_) { return null; }
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
    root.setAttributes({ "yaadly.post.mode": mode, "yaadly.job.trade": s(b.workType) });

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

      // The agent reads it before it becomes a row. Anything it returns is a
      // suggestion the client can still overwrite on the next screen; nothing
      // it says about money is used, because it is not asked about money.
      const read = modelBudgetLeft ? await readTheJob(desc, trace) : null;
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
        if (!row.job_type && s(read.job_type)) row.job_type = s(read.job_type);
        if (!row.urgency && s(read.urgency)) row.urgency = s(read.urgency);
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
      return json({ ok: true, jobId, portalCode: data?.portal_code ?? null });
    }

    // ───────────────────────── go live ─────────────────────────
    const jobId    = s(b.jobId);
    const email    = s(b.email).toLowerCase();
    const name     = s(b.name);
    const phone    = s(b.phone);
    const password = String(b.password ?? "");
    const sig      = s(b.signature);
    const consent  = s(b.consentText);
    const version  = s(b.guidelinesVersion) || "1.0";

    if (!jobId) return json({ error: "That draft could not be found. Start again and it will save as you go." }, 400);
    if (!name) return json({ error: "Your name is needed." }, 400);
    if (!email || !email.includes("@")) return json({ error: "A valid email is needed." }, 400);
    if (!phone) return json({ error: "A phone or WhatsApp number is needed." }, 400);
    if (password.length < MIN_PASSWORD) return json({ error: `Password needs to be at least ${MIN_PASSWORD} characters.` }, 400);
    if (sig.length < 3) return json({ error: "Type your full name to sign." }, 400);

    // The draft must exist and must not already belong to somebody else.
    const { data: job, error: jobErr } = await admin.from("jobs")
      .select("id, client_email").eq("id", jobId).maybeSingle();
    if (jobErr) { root.recordError(jobErr.message); return json({ error: "Could not read that job." }, 500); }
    if (!job) return json({ error: "That draft could not be found." }, 404);
    if (s(job.client_email) && s(job.client_email).toLowerCase() !== email) {
      root.setAttributes({ "yaadly.post.outcome": "job_claimed_by_other" });
      return json({ error: "That job already belongs to another account." }, 403);
    }

    // The account. Created unconfirmed on purpose: the confirmation link is
    // what proves the mailbox is theirs, and that is what later lets the job
    // open. An email we have already seen is not an error here, they may be
    // posting a second job before confirming the first.
    let emailed = false;
    const { error: createErr } = await admin.auth.admin.createUser({ email, password, email_confirm: false });
    const alreadyExisted = createErr && /already|registered|exists/i.test(String(createErr.message || ""));
    if (createErr && !alreadyExisted) {
      root.recordError(String(createErr.message));
      return json({ error: "Could not create the account. Try again, or message Yaadly." }, 502);
    }
    if (!alreadyExisted) {
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
    const user = list?.users?.find((u) => (u.email ?? "").toLowerCase() === email);
    if (!user) {
      root.recordError("user not found after create");
      return json({ error: "Could not attach your signature to an account. Message Yaadly." }, 502);
    }
    const confirmed = Boolean(user.email_confirmed_at ?? (user as { confirmed_at?: string }).confirmed_at);

    // The signature. One row per version: signing again for a new version is a
    // new row, never an edit of the old one.
    const { error: sigErr } = await admin.from("doc_signatures").insert({
      signer_user: user.id,
      signer_email: email,
      signer_name: sig,
      doc_type: "client_guidelines",
      doc_version: version,
      consent_text: consent || `Client Guidelines v${version} accepted through the job wizard.`,
    });
    if (sigErr) { root.recordError(sigErr.message); return json({ error: "Could not record the signature. Nothing was charged, message Yaadly." }, 500); }

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
    return json({ ok: true, jobId, open, emailed, guidelinesVersion: `v${version}` });

  } catch (e) {
    root.recordError(e);
    return json({ error: "Something went wrong. Your draft is saved, try again or message Yaadly." }, 500);
  }
});
