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

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const BUCKET = "vetting";
const MAX_BYTES = 26214400;                       // 25 MB, matches the bucket
const KEEP_DAYS = 90;                             // purge clock on the file
const DOC_TYPES = ["photo_id", "selfie_with_id", "police_check", "proof_of_address", "trn"];
const MIME_OK = ["image/jpeg", "image/png", "image/heic", "image/webp", "application/pdf"];
const EXT: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/heic": "heic",
  "image/webp": "webp", "application/pdf": "pdf",
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

    if (!appId || !token) return json({ error: "This upload link is not valid." }, 400);
    if (!DOC_TYPES.includes(docType)) return json({ error: "Unknown document type." }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

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

    // ── start: the server picks the path and mints a one-path URL ──
    if (action === "start") {
      const mime = s(b.mime);
      const size = Number(b.bytes ?? 0);
      if (!MIME_OK.includes(mime)) {
        return json({ error: "That file type is not accepted. Photos or a PDF." }, 400);
      }
      if (!Number.isFinite(size) || size <= 0 || size > MAX_BYTES) {
        return json({ error: "That file is too large. 25MB maximum." }, 400);
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

    return json({ error: "Unknown action." }, 400);
  } catch (e) {
    root.recordError(e);
    return json({ error: "Something went wrong. Nothing was stored." }, 500);
  }
});
