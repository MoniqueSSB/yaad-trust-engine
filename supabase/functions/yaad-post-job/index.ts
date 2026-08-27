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
