import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { Trace, SpanKind, httpAttrs } from "./otel.ts";

// Vetting document upload, for the join-as-a-pro flow.
//
// Three calls, in this order, per document:
//
//   {action:"start"}   the browser says which document it wants to send.
//                      The server picks the path. A browser-supplied path is
//                      how you get directory traversal and overwritten
//                      evidence, so the browser never chooses one.
//   PUT to the URL     the file goes straight to Storage, not through here.
//   {action:"finish"}  the server confirms the object exists, reads its real
//                      size and mime, hashes it, and writes the row.
//
// The row is written by the server after the object is verified, never by the
// browser. If the browser could write it, an applicant could claim a police
// check that does not exist and the checklist would pass on a lie.
//
// The hash is computed HERE, from the bytes actually in the bucket, not taken
// from the client. A fingerprint you were handed proves nothing.
//
// Authorisation: an applicant has no account yet, so the pair
// (application_id, upload_token) is the credential. The token is minted by
// the database, returned once to the browser that created the application,
// and never rendered anywhere else.
//
// {action:"persona"} is the odd one out: no file moves through us at all.
// The ID and selfie go to Persona inside their own flow, the browser reports
// the inquiry id, and this function asks Persona's API whether that inquiry
// is real, belongs to this application, and passed. See the action itself.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const BUCKET = "vetting";
const MAX_BYTES = 52428800;                       // 50 MB, matches the bucket
const KEEP_DAYS = 90;                             // purge clock on the file

// Identity papers, and the work evidence from step 2. A CV and a portfolio are
// documents like any other: same private bucket, same purge clock, same rule
// that the server writes the row only after it has seen the bytes.
const DOC_TYPES = [
  "photo_id", "selfie_with_id", "face_video", "police_check", "proof_of_address", "trn",
  "cv", "portfolio", "certificate",
];

// Video is here for one reason: the left-to-right face turn in step 3. A still
// cannot prove a turn, so a still cannot be the check.
const MIME_OK = [
  "image/jpeg", "image/png", "image/heic", "image/webp", "application/pdf",
  "video/mp4", "video/webm", "video/quicktime",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];
const EXT: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/heic": "heic",
  "image/webp": "webp", "application/pdf": "pdf",
  "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const s = (v: unknown) => String(v ?? "").trim();

async function sha256(buf: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const trace = new Trace("yaad-vetting-upload", req);
  const root = trace.startSpan(`${req.method} /yaad-vetting-upload`, SpanKind.SERVER, httpAttrs(req));
  const done = (res: Response, status: number) => {
    root.setAttributes({ "http.response.status_code": status });
    root.end(); trace.flush(); return res;
  };
  const json = (b: unknown, status = 200) =>
    done(new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } }), status);

  try {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
    if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: "Uploads are not configured." }, 500);

    const b = await req.json().catch(() => ({})) as Record<string, unknown>;
    const action  = s(b.action);
    const appId   = s(b.applicationId);
    const token   = s(b.uploadToken);
    const docType = s(b.docType);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // ── apply: open the application, and hand back the claim token once ──
    //
    // Done here rather than by the browser writing to `applications` itself,
    // because the row needs to come back with its upload_token and the table
    // is deliberately unreadable to anyone who is not an admin. One audited
    // path in, nothing readable out.
    if (action === "apply") {
      const name  = s(b.name);
      const trade = s(b.trade);
      if (!name)  return json({ error: "Your name is needed." }, 400);
      if (!trade) return json({ error: "Pick at least one trade." }, 400);

      const { data, error } = await admin.from("applications").insert({
        app_id: "APP-" + crypto.randomUUID().slice(0, 6).toUpperCase(),
        name,
        trade,
        trade_other: s(b.tradeOther).slice(0, 120),
        // parish stays the first one for the desk, which reads a single parish.
        // parishes is the real answer, and it is the one matching will use.
        parish:   s(b.parish),
        parishes: s(b.parishes).slice(0, 400),
        phone:  s(b.phone),
        email:  s(b.email).toLowerCase(),
        years:  s(b.years),
        work:   s(b.work).slice(0, 2000),
        status: "started",
      }).select("id, app_id, upload_token").single();

      if (error || !data) {
        root.recordError(error?.message ?? "no application row");
        return json({ error: "Could not start your application." }, 500);
      }
      root.setAttributes({ "yaadly.vetting.outcome": "application_started" });
      return json({ ok: true, applicationId: data.id, reference: data.app_id, uploadToken: data.upload_token });
    }

    if (!appId || !token) return json({ error: "This upload link is not valid." }, 400);

    // Only the two file actions name a document. `submit` names none, and
    // demanding one here is what made every submit fail with "Unknown
    // document type" for an application that was otherwise complete.
    if ((action === "start" || action === "finish") && !DOC_TYPES.includes(docType)) {
      return json({ error: "Unknown document type." }, 400);
    }

    // The credential check. Both halves must match one row.
    const { data: app } = await admin
      .from("applications")
      .select("id, upload_token, status")
      .eq("id", appId)
      .maybeSingle();

    if (!app || s(app.upload_token) !== token) {
      root.setAttributes({ "yaadly.vetting.outcome": "bad_token" });
      return json({ error: "This upload link is not valid." }, 403);
    }
    root.setAttributes({ "yaadly.vetting.doc_type": docType });

    // ── persona: record the ID check, confirmed with Persona, not the browser ──
    //
    // The browser reports an inquiry id when the Persona flow completes. That
    // report is worth nothing on its own: a browser that can call this
    // function can type any string it likes. So the server asks Persona's API
    // whether the inquiry is real, whether it belongs to THIS application
    // (reference-id was set to the application id when the flow opened), and
    // what its status actually is. What gets stored is Persona's answer.
    //
    // If PERSONA_API_KEY is not set the inquiry id is still recorded, with
    // status "unchecked", and the response says verified:false, so the page
    // cannot show a tick the server never earned. The desk looks it up by
    // hand in the Persona dashboard in that case.
    if (action === "persona") {
      const inquiryId = s(b.inquiryId);
      if (!/^inq_[A-Za-z0-9]{6,64}$/.test(inquiryId)) {
        return json({ error: "That does not look like a Persona inquiry." }, 400);
      }

      const personaKey = Deno.env.get("PERSONA_API_KEY") ?? "";
      let status = "unchecked";
      let verified = false;

      if (personaKey) {
        let r: Response;
        try {
          r = await fetch(`https://api.withpersona.com/api/v1/inquiries/${inquiryId}`, {
            headers: {
              Authorization: `Bearer ${personaKey}`,
              "Persona-Version": "2023-01-05",
            },
            signal: AbortSignal.timeout(15000),
          });
        } catch {
          root.setAttributes({ "yaadly.vetting.outcome": "persona_unreachable" });
          return json({ error: "Persona could not be reached to confirm the check. Nothing was recorded. Try again." }, 502);
        }
        if (r.status === 404) {
          root.setAttributes({ "yaadly.vetting.outcome": "persona_no_such_inquiry" });
          return json({ error: "Persona has no record of that check." }, 403);
        }
        if (!r.ok) {
          root.recordError(`persona http ${r.status}`);
          return json({ error: "Persona would not confirm the check. Nothing was recorded. Try again." }, 502);
        }
        const j = await r.json().catch(() => null) as
          { data?: { attributes?: Record<string, unknown> } } | null;
        const attrs = j?.data?.attributes ?? {};
        const ref = s(attrs["reference-id"]);
        // An inquiry opened for a different application must not land on this
        // one. An empty reference is also a refusal: every inquiry this page
        // opens carries one, so a bare inquiry was not opened by this page.
        if (ref !== appId) {
          root.setAttributes({ "yaadly.vetting.outcome": "persona_wrong_application" });
          return json({ error: "That check belongs to a different application." }, 403);
        }
        status = s(attrs.status) || "unknown";
        // "completed" is a finished flow awaiting a decision; "approved" is the
        // template's own decision. Either way the applicant has done their
        // part. Everything else (pending, needs_review, declined, expired) is
        // stored as-is and shown as-is: the page never rounds it up to a pass.
        verified = status === "completed" || status === "approved";
      }

      const { error: upErr } = await admin.from("applications").update({
        persona_inquiry_id: inquiryId,
        persona_status: status,
        persona_checked_at: new Date().toISOString(),
      }).eq("id", appId);
      if (upErr) { root.recordError(upErr.message); return json({ error: "Could not record the check." }, 500); }

      root.setAttributes({ "yaadly.vetting.outcome": "persona_recorded", "yaadly.vetting.persona_status": status });
      return json({ ok: true, status, verified });
    }

    // ── start: the server picks the path and mints a one-path URL ──
    if (action === "start") {
      const mime = s(b.mime);
      const size = Number(b.bytes ?? 0);
      if (!MIME_OK.includes(mime)) {
        return json({ error: "That file type is not accepted. A photo, a video, a PDF or a Word document." }, 400);
      }
      if (!Number.isFinite(size) || size <= 0 || size > MAX_BYTES) {
        return json({ error: "That file is too large. 50MB maximum." }, 400);
      }

      // Path carries no personal data: an application id, not a name or email.
      const path = `applications/${appId}/${docType}-${crypto.randomUUID()}.${EXT[mime]}`;
      const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(path);
      if (error || !data) {
        root.recordError(error?.message ?? "no signed url");
        return json({ error: "Could not start the upload. Try again." }, 502);
      }
      root.setAttributes({ "yaadly.vetting.outcome": "signed" });
      return json({ ok: true, path, token: data.token, signedUrl: data.signedUrl });
    }

    // ── finish: verify the object, hash it, then write the row ──
    if (action === "finish") {
      const path = s(b.path);
      if (!path.startsWith(`applications/${appId}/`)) {
        root.setAttributes({ "yaadly.vetting.outcome": "path_mismatch" });
        return json({ error: "That file does not belong to this application." }, 403);
      }

      const { data: file, error: dlErr } = await admin.storage.from(BUCKET).download(path);
      if (dlErr || !file) {
        root.setAttributes({ "yaadly.vetting.outcome": "not_uploaded" });
        return json({ error: "That file did not arrive. Try again." }, 409);
      }

      const buf = await file.arrayBuffer();
      if (buf.byteLength === 0 || buf.byteLength > MAX_BYTES) {
        await admin.storage.from(BUCKET).remove([path]);
        return json({ error: "That file was empty or too large." }, 400);
      }
      const hash = await sha256(buf);
      const mime = file.type || "application/octet-stream";

      // One current document per type per application. A re-upload replaces
      // the previous one rather than leaving two passports on file.
      const { data: prior } = await admin
        .from("vetting_documents")
        .select("id, storage_path")
        .eq("application_id", appId).eq("doc_type", docType);
      for (const p of prior ?? []) {
        if (p.storage_path && p.storage_path !== path) {
          await admin.storage.from(BUCKET).remove([p.storage_path]);
        }
      }
      if (prior?.length) {
        await admin.from("vetting_documents").delete().eq("application_id", appId).eq("doc_type", docType);
      }

      const purge = new Date(Date.now() + KEEP_DAYS * 86400_000).toISOString();
      const { error: insErr } = await admin.from("vetting_documents").insert({
        application_id: appId,
        doc_type: docType,
        storage_path: path,
        sha256: hash,
        bytes: buf.byteLength,
        mime,
        purge_after: purge,
      });
      if (insErr) {
        root.recordError(insErr.message);
        return json({ error: "Could not record that document." }, 500);
      }

      root.setAttributes({ "yaadly.vetting.outcome": "stored", "yaadly.vetting.bytes": buf.byteLength });
      return json({ ok: true, docType, bytes: buf.byteLength, sha256: hash, purgeAfter: purge });
    }

    // ── submit: the applicant is done, hand it to the desk ──
    if (action === "submit") {
      // Three references are asked for on screen, so three are stored. An
      // application that names fewer, or that has not confirmed the referees
      // were warned, is still accepted: it is the desk's job to decide, not
      // this function's. What it must not do is quietly lose the answer.
      const signedName = s(b.signedName).slice(0, 120);

      // Consent to a machine reading their identity documents. Opt in only:
      // anything that is not the word "granted" is a no, including a browser
      // that never sent the field. Silence is not consent, and the safe reading
      // of a missing answer is the one that sends the passport nowhere.
      const aiConsent = s(b.aiReviewConsent) === "granted" ? "granted" : "declined";

      const { error } = await admin.from("applications").update({
        status: "received",
        ai_review_consent: aiConsent,
        ai_review_consent_at: new Date().toISOString(),
        ai_review_consent_version: s(b.aiReviewConsentVersion).slice(0, 40) || "ai-review-v1",
        phone:    s(b.phone)  || undefined,
        email:    s(b.email).toLowerCase() || undefined,
        parish:   s(b.parish) || undefined,
        parishes: s(b.parishes).slice(0, 400) || undefined,
        trade:    s(b.trade)  || undefined,
        trade_other: s(b.tradeOther).slice(0, 120) || undefined,
        years:    s(b.years)  || undefined,
        work:     s(b.work).slice(0, 2000) || undefined,
        links:    s(b.links).slice(0, 1000) || undefined,
        ref1:     s(b.ref1)   || undefined,
        ref2:     s(b.ref2)   || undefined,
        ref3:     s(b.ref3)   || undefined,
        refs_told: b.refsTold === true,
        police_status: s(b.policeStatus) || undefined,
        // Signed once, at submit, with the name they typed. The timestamp is
        // the server's, never the browser's: a signature dated by the thing
        // being signed against is not a signature.
        signed_name:    signedName || undefined,
        signed_at:      signedName ? new Date().toISOString() : undefined,
        signed_version: signedName ? s(b.signedVersion) || "v1" : undefined,
        submitted_at:   new Date().toISOString(),
      }).eq("id", appId);
      if (error) { root.recordError(error.message); return json({ error: error.message }, 500); }

      // ── the public profile, created here and not after vetting ────────────
      //
      // Founder decision, 30 Aug 2026, revised the same day: the row is
      // created when Phase 1 lands, and it is created HIDDEN. active=false
      // until the Phase 2 checks clear, so the profile exists from the first
      // sitting and nothing unvetted is ever publicly listed.
      //
      // Publishing is a human act, deliberately. Flipping a profile live is
      // the moment Yaadly vouches for somebody in public, and the governing
      // rule is that a named human confirms every consequential step. There
      // is no automatic promotion here and there should not be one. See
      // RUNBOOK.md for the step the desk runs.
      //
      // Keyed on application_id, so a second submit updates the profile rather
      // than making a rival one. The email is written only when there is one:
      // Phase 1 takes a phone number OR an email, and a made up address in
      // this column would eventually be mailed.
      try {
        const { data: appRow } = await admin.from("applications")
          .select("name, trade, parish, parishes, years, email")
          .eq("id", appId).single();

        if (appRow?.name) {
          const slugBase = String(appRow.name).toLowerCase()
            .normalize("NFKD").replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "").slice(0, 40) || "pro";
          // The application id tail keeps two Delroy Campbells apart without
          // a lookup, and the slug is stable for the life of the application.
          const slug = `${slugBase}-${String(appId).slice(0, 6)}`;
          const yearsInt = parseInt(String(appRow.years ?? "").replace(/\D/g, ""), 10);
          const email = String(appRow.email ?? "").trim().toLowerCase();

          const { error: profErr } = await admin.from("worker_profiles").upsert({
            application_id: appId,
            worker_email: email || null,
            name: String(appRow.name).slice(0, 120),
            trade: String(appRow.trade ?? "").split(",")[0].trim() || null,
            parish: String(appRow.parish ?? "").split(",")[0].trim() || null,
            areas: String(appRow.parishes ?? "").slice(0, 400) || null,
            years: Number.isFinite(yearsInt) ? yearsInt : null,
            slug,
            active: false,
            vetting_state: "probation",
            updated_at: new Date().toISOString(),
          }, { onConflict: "application_id" });
          if (profErr) root.recordError(`profile: ${profErr.message}`);
          else root.setAttributes({ "yaadly.profile.created": true, "yaadly.profile.slug": slug });
        }
      } catch (e) {
        // A profile that failed to write must never lose the application. The
        // desk can create it by hand, and the applicant is already recorded.
        root.recordError(`profile: ${String(e).slice(0, 200)}`);
      }

      // Tell Monique. No contact details leave for the relay.
      try {
        const { data: st } = await admin.from("app_settings").select("value").eq("key", "ntfy_topic").single();
        if (st?.value) {
          const { count } = await admin.from("vetting_documents")
            .select("id", { count: "exact", head: true }).eq("application_id", appId);
          await fetch(`https://ntfy.sh/${st.value}`, {
            method: "POST",
            headers: { Title: "New Yaadly pro application", Priority: "default", Tags: "hammer" },
            body: `${s(b.trade) || "trade"}, ${s(b.parish) || "parish not given"}. ${count ?? 0} document(s) on file.`
              + (aiConsent === "granted" ? "" : " No AI read, they refused. You promised an answer within 48 hours."),
            signal: AbortSignal.timeout(4000),
          });
        }
      } catch (_) { /* never let a notification break an application */ }

      // Hand it to the vetting reviewer straight away, so the machine read is
      // already sitting on the application by the time the desk opens it. That
      // is the whole point of it: nobody should have to run a prompt by hand
      // before they can start closing the file.
      //
      // waitUntil, not await: the applicant should not watch a spinner while a
      // vision model reads five photographs. If it fails, the desk carries a
      // "Run the check again" button, and yaad-vetting-review writes its own
      // failures down rather than leaving a silence that reads like a clean
      // result.
      //
      // Unless they said no. An applicant who declined the machine read must
      // not have it run anyway because a background job was already wired up.
      // yaad-vetting-review checks the same column itself, so this is the first
      // of two gates rather than the only one.
      if (aiConsent === "granted") try {
        const review = fetch(`${SUPABASE_URL}/functions/v1/yaad-vetting-review`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${SERVICE_KEY}`,
            apikey: SERVICE_KEY,
          },
          body: JSON.stringify({ applicationId: appId }),
          signal: AbortSignal.timeout(120000),
        }).catch(() => { /* the desk can re-run it */ });
        const rt = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
        if (rt?.waitUntil) rt.waitUntil(review);
      } catch (_) { /* never let the reviewer break an application */ }

      root.setAttributes({ "yaadly.vetting.outcome": "submitted", "yaadly.vetting.ai_consent": aiConsent });
      return json({ ok: true });
    }

    return json({ error: "Unknown action." }, 400);
  } catch (e) {
    root.recordError(e);
    return json({ error: "Something went wrong. Nothing was stored." }, 500);
  }
});
