import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { Trace, SpanKind, httpAttrs } from "./otel.ts";
import { stripApp1, hasApp1 } from "./strip-exif.ts";

// Photographs attached on the job form itself, before anybody has an account.
//
// FOUNDER INSTRUCTION, 6 September 2026: a photograph must be attachable while
// the job is being posted, and it must land on the job. Until now the only two
// doors were a WhatsApp message and the signed-in portal, and the wizard could
// only hand out a link to the second one. Somebody standing in front of the
// problem with the picture already on their phone had to leave the form to use
// it.
//
// The other door into the same bucket, and the difference is the credential.
// A signed-in client uploads through web/app/portal/job-photo-actions.ts, where
// a Postgres policy matches their session email against the job. A visitor on
// /jobs/new has no session by deliberate decision (no account to get quotes),
// so the pair (job id, portal code) is the credential here, the same shape as
// (application id, upload token) in yaad-vetting-upload. Both halves must match
// one row and that row must still be unclaimed.
//
// UNCLAIMED IS THE FENCE, and it is the part to leave alone. The moment a
// client_email is on the job, the job belongs to an account and the portal is
// the only route: policy, session, deletable by its owner. This anonymous door
// only ever opens on a draft nobody has claimed, which is exactly the window
// the wizard runs in, and it is the same rule yaad-post-job applies to an
// anonymous draft update. Widening it would mean a leaked code could put a
// picture on somebody's live job.
//
// Three calls per photograph, in this order, the same as vetting:
//
//   {action:"start"}    the browser says what it is sending. The server picks
//                       the path, because a browser-chosen path is how one
//                       job's photograph gets written into another job's
//                       folder.
//   PUT to the URL      the file goes straight to Storage, not through here.
//   {action:"finish"}   the server downloads what actually arrived, strips
//                       every APP1 segment, and only then writes the row.
//
// The row is written after the bytes are seen, never from what the browser
// claims. And the strip happens server-side rather than in the page for the
// same reason: a coordinate removed by code the uploader controls has not been
// removed at all.
//
// board_ok is false on every row this function writes, and there is no input
// that can change it. Publishing a photograph to app.yaadly.co.uk/jobs stays a
// decision at the desk. Nothing here is a public picture.
//
// verify_jwt is off, because a visitor filling in this form has no session.
// The credential check below is the door. CLAUDE.md §12 carries the list of
// endpoints that run this way, and this one belongs on it.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const BUCKET = "intake";

// 12MB. A phone photograph is two to five, and the portal's own action refuses
// above twenty. Lower here on purpose: this door is open to anybody holding a
// job code, so it carries the tighter limit of the two.
const MAX_BYTES = 12_000_000;

// Eight per job, counted across every route into job_photos, so a client who
// has already sent five on WhatsApp can add three here and no more. It is a
// bound on an anonymous door, not a rule about how many photographs are
// useful: the portal takes more once there is an account behind it.
const MAX_PER_JOB = 8;

// Only what a browser will paint. HEIC is refused by name rather than by
// silence: an iPhone shooting in High Efficiency usually transcodes to JPEG on
// its way through a file input, and when it does not, the file stores fine and
// then renders as a blank tile for the worker who needed to see it.
const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const s = (v: unknown) => String(v ?? "").trim();

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const trace = new Trace("yaad-job-photo", req);
  const root = trace.startSpan(`${req.method} /yaad-job-photo`, SpanKind.SERVER, httpAttrs(req));
  const done = (res: Response, status: number) => {
    root.setAttributes({ "http.response.status_code": status });
    root.end(); trace.flush(); return res;
  };
  const json = (b: unknown, status = 200) =>
    done(new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } }), status);

  try {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
    if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: "Photo upload is not configured." }, 500);

    const b = await req.json().catch(() => ({})) as Record<string, unknown>;
    const action = s(b.action);
    const jobId  = s(b.jobId);
    const code   = s(b.code).toUpperCase();

    // The job id becomes the second folder of the object path. A slash, a
    // dot-dot or a percent in this value is how one job's photograph is
    // written into another job's folder, so it is checked rather than trusted,
    // exactly as the portal's own action checks it.
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(jobId)) return json({ error: "That job reference is not valid." }, 400);
    if (!code) return json({ error: "That job code is not valid." }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // ── the credential, and the fence ──────────────────────────────────────
    const { data: job } = await admin
      .from("jobs")
      .select("id, portal_code, client_email")
      .eq("id", jobId)
      .maybeSingle();

    if (!job || s(job.portal_code).toUpperCase() !== code) {
      root.setAttributes({ "yaadly.photo.outcome": "bad_code" });
      return json({ error: "That job code is not valid." }, 403);
    }
    if (s(job.client_email)) {
      // Not an error the client caused, so it says where the door is instead.
      root.setAttributes({ "yaadly.photo.outcome": "already_claimed" });
      return json({ error: "This job already has an account on it. Sign in to your portal to send photographs." }, 409);
    }
    root.setAttributes({ "yaadly.job.id": jobId });

    // ── start: pick the path, hand back a signed upload URL ────────────────
    if (action === "start") {
      const mime = s(b.mime).toLowerCase();
      const size = Number(b.bytes ?? 0);
      const ext = EXT[mime];
      if (!ext) {
        return json({
          error: mime.startsWith("image/")
            ? `This is a ${mime.replace("image/", "").toUpperCase()} image, which most browsers cannot display. Send it as a JPEG.`
            : "That is not a photograph. JPEG, PNG or WebP.",
        }, 400);
      }
      if (!Number.isFinite(size) || size <= 0 || size > MAX_BYTES) {
        return json({ error: `That photo is too large. Keep them under about ${MAX_BYTES / 1_000_000}MB.` }, 400);
      }

      const { count } = await admin
        .from("job_photos")
        .select("id", { count: "exact", head: true })
        .eq("job_id", jobId);
      if ((count ?? 0) >= MAX_PER_JOB) {
        return json({ error: `That is ${MAX_PER_JOB} photographs, which is plenty. Send any more when we reply.` }, 409);
      }

      const path = `client/${jobId}/${crypto.randomUUID()}.${ext}`;
      const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(path);
      if (error || !data) {
        root.recordError(error?.message ?? "no signed url");
        return json({ error: "Could not start that upload. Try again." }, 502);
      }
      root.setAttributes({ "yaadly.photo.outcome": "signed" });
      return json({ ok: true, path, token: data.token, signedUrl: data.signedUrl });
    }

    // ── finish: read what arrived, strip the location, then write the row ──
    if (action === "finish") {
      const path = s(b.path);
      if (!path.startsWith(`client/${jobId}/`)) {
        root.setAttributes({ "yaadly.photo.outcome": "path_mismatch" });
        return json({ error: "That file does not belong to this job." }, 403);
      }

      const { data: file, error: dlErr } = await admin.storage.from(BUCKET).download(path);
      if (dlErr || !file) {
        root.setAttributes({ "yaadly.photo.outcome": "not_uploaded" });
        return json({ error: "That photo did not arrive. Try again." }, 409);
      }

      const raw = new Uint8Array(await file.arrayBuffer());
      if (raw.byteLength === 0 || raw.byteLength > MAX_BYTES) {
        await admin.storage.from(BUCKET).remove([path]);
        return json({ error: "That photo was empty or too large." }, 400);
      }
      const mime = (file.type || "image/jpeg").toLowerCase();
      if (!EXT[mime]) {
        await admin.storage.from(BUCKET).remove([path]);
        return json({ error: "That is not a photograph we can show." }, 400);
      }

      // The APP1 segment carries the coordinate the phone wrote when the
      // shutter fired. Removed from the bytes in the bucket, not merely from
      // what gets read back, so there is no copy of it anywhere afterwards.
      const stored = stripApp1(raw);
      if (stored.byteLength !== raw.byteLength) {
        const { error: reErr } = await admin.storage.from(BUCKET)
          .upload(path, stored, { contentType: mime, upsert: true });
        if (reErr) {
          // Refusing is the only safe answer. Keeping the row would mean a
          // photograph on the job with its location still attached.
          await admin.storage.from(BUCKET).remove([path]);
          root.recordError(reErr.message);
          return json({ error: "That photo could not be stored safely. Try again." }, 502);
        }
      }
      if (hasApp1(stored)) {
        await admin.storage.from(BUCKET).remove([path]);
        root.setAttributes({ "yaadly.photo.outcome": "strip_failed" });
        return json({ error: "That photo could not be stored safely. Try again." }, 502);
      }

      // Positions follow the WhatsApp convention of tens, so a photograph sent
      // here and one sent on WhatsApp interleave in the order they arrived
      // rather than one set always sorting before the other.
      const { data: last } = await admin
        .from("job_photos")
        .select("position")
        .eq("job_id", jobId)
        .order("position", { ascending: false })
        .limit(1)
        .maybeSingle();

      const { data: row, error: insErr } = await admin.from("job_photos").insert({
        job_id: jobId,
        caption: s(b.caption).slice(0, 140) || "Sent with the job",
        img: null,
        storage_path: path,
        mime,
        bytes: stored.byteLength,
        kind: "photo",
        source: "client",
        board_ok: false,
        position: (last?.position ?? -10) + 10,
      }).select("id").single();

      if (insErr || !row) {
        // A file with no row is litter, and this is the only moment anything
        // can clear it: from the next line on, a row points at the path.
        await admin.storage.from(BUCKET).remove([path]);
        root.recordError(insErr?.message ?? "no photo row");
        return json({ error: "Could not attach that photo to the job." }, 500);
      }

      root.setAttributes({ "yaadly.photo.outcome": "stored", "yaadly.photo.bytes": stored.byteLength });
      return json({ ok: true, photoId: row.id, bytes: stored.byteLength });
    }

    // ── remove: take one back, before anybody else has seen it ─────────────
    //
    // Somebody who has just sent a picture of the inside of their house to the
    // wrong place must be able to take it back, and on this form they have no
    // account to do it from. Only a row this route wrote, only while the job is
    // still unclaimed, and never one the desk saved out of a WhatsApp thread.
    if (action === "remove") {
      const photoId = s(b.photoId);
      if (!photoId) return json({ error: "Which photo?" }, 400);

      const { data: row } = await admin
        .from("job_photos")
        .select("id, storage_path, source, board_ok")
        .eq("id", photoId)
        .eq("job_id", jobId)
        .maybeSingle();
      if (!row) return json({ error: "That photo is not on this job." }, 404);
      if (row.source !== "client" || row.board_ok === true) {
        return json({ error: "A person at Yaadly removes that one. Ask, and it is done the same day." }, 403);
      }

      const { error: delErr } = await admin.from("job_photos").delete().eq("id", photoId);
      if (delErr) {
        root.recordError(delErr.message);
        return json({ error: "Could not remove that photo." }, 500);
      }
      // Row first, then the file: a failure halfway leaves a file with no row,
      // which is litter, rather than a row with no file, which is a broken
      // picture on somebody's job.
      if (row.storage_path) await admin.storage.from(BUCKET).remove([row.storage_path as string]);

      root.setAttributes({ "yaadly.photo.outcome": "removed" });
      return json({ ok: true });
    }

    return json({ error: "Unknown action." }, 400);
  } catch (e) {
    root.recordError(e instanceof Error ? e.message : String(e));
    return json({ error: "That did not work. Try again." }, 500);
  }
});
