import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { Trace, SpanKind, httpAttrs } from "./otel.ts";

// Worker video evidence, Stage 5.5. Two calls, same shape as
// yaad-vetting-upload's start/finish, chosen deliberately because that
// pattern already solves the problem a video has that a 12MB photo does not:
// the file is too big to ride inside a Next.js Server Action body, so it has
// to go straight to Storage on a URL the server hands out, not through here.
//
//   {action:"start"}   the worker says which job, stage and file. The server
//                      picks the storage path (a client-chosen path is how
//                      one job's evidence lands in another job's folder) and
//                      mints a one-path signed upload URL.
//   PUT to the URL     the video goes straight to Storage.
//   {action:"finish"}  the server downloads what actually arrived, hashes it,
//                      and writes the evidence row. The row is never written
//                      from a client-reported hash: evidence-actions.ts's own
//                      rule for photos ("computed HERE, on the server, from
//                      the exact bytes stored") applies exactly the same to
//                      video, and there is no reason it should apply less.
//
// UNLIKE vetting, there is no bespoke token here. A worker filing evidence
// already has a real account and a real session, and public.evidence plus
// the evidence bucket already carry RLS that lets a job's own worker (or
// client) read and write exactly their own job's folder and nothing else
// (20260827a, 20260830b). So this function is built to run AS the caller,
// never as service role: every storage and database call below uses a client
// constructed from the caller's own bearer token, and RLS is the only
// authorisation check that exists. If a worker who is not on this job calls
// either action, Postgres refuses it the same way it would refuse them
// calling supabase-js directly from a browser console. Nothing here decides
// who may file evidence a second time; that decision already lives in the
// database and this function does not repeat it.
//
// The materials-store gate (20260828c) is untouched by any of this: the
// finish step inserts into public.evidence exactly as evidence-actions.ts
// does, so a materials-kind video filed with no store nominated is refused
// by the same trigger, with the same message, whether it arrived as a photo
// or a video.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

const BUCKET = "evidence";

// Bounded well under the bucket's own 500MB ceiling. The finish step has to
// hold the whole file in memory to hash it, the same way yaad-vetting-upload
// already does for its 50MB video cap, and this runs on the same free-plan
// edge runtime. 80MB is a few minutes of ordinary phone video at a
// reasonable bitrate, which is what a stage walkthrough needs, and it leaves
// headroom for the runtime itself rather than chasing the bucket's limit.
const MAX_VIDEO_BYTES = 80_000_000;

const MIME_OK = ["video/mp4", "video/webm", "video/quicktime"];
const EXT: Record<string, string> = {
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
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

  const trace = new Trace("yaad-evidence-video", req);
  const root = trace.startSpan(`${req.method} /yaad-evidence-video`, SpanKind.SERVER, httpAttrs(req));
  const done = (res: Response, status: number) => {
    root.setAttributes({ "http.response.status_code": status });
    root.end(); trace.flush(); return res;
  };
  const json = (b: unknown, status = 200) =>
    done(new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } }), status);

  try {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
    if (!SUPABASE_URL || !ANON_KEY) return json({ error: "Uploads are not configured." }, 500);

    // The platform already refused this request if the bearer token did not
    // verify; verify_jwt stays true for this function (see CLAUDE.md 12), so
    // arriving here means Authorization carries a real, checked session.
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return json({ error: "Not signed in." }, 401);

    // A client built from the CALLER's own token, not the service role.
    // Every call below is subject to exactly the RLS a browser would face.
    const asUser = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const b = await req.json().catch(() => ({})) as Record<string, unknown>;
    const action = s(b.action);
    const jobId = s(b.jobId);

    if (!/^[A-Za-z0-9_-]{1,64}$/.test(jobId)) {
      return json({ error: "That job id does not look right." }, 400);
    }

    // ── start: pick the path, mint a one-path URL ──
    if (action === "start") {
      const mime = s(b.mime).toLowerCase();
      const bytes = Number(b.bytes ?? 0);
      if (!MIME_OK.includes(mime)) {
        return json({ error: "That file type is not accepted. Send an MP4, WebM or MOV video." }, 400);
      }
      if (!Number.isFinite(bytes) || bytes <= 0 || bytes > MAX_VIDEO_BYTES) {
        return json({ error: `That video is too large. Keep it under ${Math.round(MAX_VIDEO_BYTES / 1_000_000)}MB.` }, 400);
      }

      const path = `${jobId}/${crypto.randomUUID()}.${EXT[mime]}`;
      const { data, error } = await asUser.storage.from(BUCKET).createSignedUploadUrl(path);
      if (error || !data) {
        // RLS refusing this looks identical to any other storage error here,
        // which is deliberate: a worker probing a job that is not theirs
        // learns nothing more than "could not start", the same as any other
        // failure would tell them.
        root.setAttributes({ "yaadly.evidence_video.outcome": "start_refused" });
        return json({ error: "Could not start the upload. You may not be on this job." }, 403);
      }

      root.setAttributes({ "yaadly.evidence_video.outcome": "signed" });
      return json({ ok: true, path, token: data.token, signedUrl: data.signedUrl });
    }

    // ── finish: verify the object, hash it, write the row ──
    if (action === "finish") {
      const path = s(b.path);
      const label = s(b.label).slice(0, 140);
      const stageRaw = s(b.stage);
      const stage = /^\d+$/.test(stageRaw) ? parseInt(stageRaw, 10) : null;
      const kind = s(b.kind) === "materials" ? "materials" : "work";

      if (!path.startsWith(`${jobId}/`)) {
        return json({ error: "That file does not belong to this job." }, 403);
      }
      if (!label) return json({ error: "A label is needed." }, 400);

      const { data: file, error: dlErr } = await asUser.storage.from(BUCKET).download(path);
      if (dlErr || !file) {
        root.setAttributes({ "yaadly.evidence_video.outcome": "not_uploaded" });
        return json({ error: "That video did not arrive. Try again." }, 409);
      }

      const buf = await file.arrayBuffer();
      if (buf.byteLength === 0 || buf.byteLength > MAX_VIDEO_BYTES) {
        await asUser.storage.from(BUCKET).remove([path]);
        return json({ error: "That video was empty or too large." }, 400);
      }

      const hash = await sha256(buf);
      const mime = file.type || "application/octet-stream";

      const { data: userRes } = await asUser.auth.getUser();
      const uploadedBy = (userRes?.user?.email ?? "").toLowerCase();

      const { error: insErr } = await asUser.from("evidence").insert({
        job_id: jobId,
        label,
        img: null,
        storage_path: path,
        bytes: buf.byteLength,
        mime,
        kind,
        stage,
        sha256: hash,
        captured_at: null,
        uploaded_by: uploadedBy,
        ok: null,
      });

      if (insErr) {
        // Same cleanup rule as evidence-actions.ts: a row that failed to
        // write must not leave an object nothing points at.
        await asUser.storage.from(BUCKET).remove([path]);
        root.recordError(insErr.message);
        // The materials gate raises a sentence written for the person
        // reading it (20260828c); pass it through rather than flattening it,
        // exactly as the photo path does.
        const msg = /materials store/i.test(insErr.message) ? insErr.message : "Could not record that video.";
        return json({ error: msg }, insErr.message.includes("materials store") ? 409 : 500);
      }

      root.setAttributes({ "yaadly.evidence_video.outcome": "stored", "yaadly.evidence_video.bytes": buf.byteLength });
      return json({ ok: true, bytes: buf.byteLength, sha256: hash, storagePath: path });
    }

    return json({ error: "Unknown action." }, 400);
  } catch (e) {
    root.recordError(e);
    return json({ error: "Something went wrong. Nothing was stored." }, 500);
  }
});
