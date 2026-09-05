"use server";

import { createHash, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { readCapturedAt, stripApp1 } from "@/lib/exif";
import { isPhase } from "@/lib/portal/evidence-sections";

/**
 * Evidence upload, PORTAL-SPEC 5.3. The fingerprint is computed HERE, on
 * the server, from the exact bytes stored, and written once at insert.
 * It is never recomputed on read: change one pixel and it stops matching.
 * RLS decides who may file evidence against which job.
 *
 * The file goes to the private evidence bucket, not into a column. It used to
 * be base64 in evidence.img, which capped a photograph at what a Server Action
 * body would carry, put megabytes of base64 into a table row, and sent every
 * image on a job to the browser on page load. storage_path, bytes and mime
 * were added for the real thing on 27 Aug and nothing wrote them until now.
 * Reads go out on short-lived signed URLs minted per request. Rows written
 * before this keep their data URL and still render.
 *
 * The EXIF timestamp is read off the original bytes and the APP1 segment is
 * then dropped, so captured_at knows when the shutter fired while no GPS
 * coordinate is ever stored. See lib/exif.ts. The fingerprint is taken AFTER
 * the strip, because the invariant is that it covers the exact bytes kept.
 */

const BUCKET = "evidence";

// Generous, because the bytes no longer live in a table row. A 48MP phone
// photograph is about 12MB. The Server Action body limit in next.config.ts
// sits above this: that one stops the request, this one explains itself to
// the person holding the phone.
const MAX_IMAGE_BYTES = 20_000_000;

// Formats a browser will actually paint in an <img>. HEIC is the gap worth
// naming: an iPhone shooting in High Efficiency usually transcodes to JPEG on
// its way through a file input, but when it does not, the file stores fine and
// then renders as a blank tile in the ledger. Refusing it with a sentence
// beats filing evidence nobody can look at.
const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export async function uploadEvidence(formData: FormData): Promise<void> {
  const user = await requireUser();
  const jobId = String(formData.get("jobId") ?? "");
  const label = String(formData.get("label") ?? "").trim();
  const stageRaw = String(formData.get("stage") ?? "");
  const file = formData.get("photo");
  if (!jobId || !label) throw new Error("missing");

  // The job id becomes the first folder of the object path, so it is checked
  // here rather than trusted. A slash or a dot-dot in this value is how one
  // job's evidence gets written into another job's folder, and the storage
  // policy matches on exactly that first folder.
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(jobId)) throw new Error("refused");

  const supabase = await createClient();

  let storagePath: string | null = null;
  let capturedAt: Date | null = null;
  let mime: string | null = null;
  let size: number | null = null;
  let sha256: string;

  if (file instanceof File && file.size > 0) {
    if (!/^image\//.test(file.type)) throw new Error("not an image");
    const ext = EXT[file.type.toLowerCase()];
    if (!ext)
      throw new Error(
        `this is a ${file.type.replace("image/", "").toUpperCase()} image, which most browsers cannot display. Send it as a JPEG.`,
      );
    if (file.size > MAX_IMAGE_BYTES)
      throw new Error(
        `too large at ${(file.size / 1_000_000).toFixed(1)}MB: keep photos under about ${MAX_IMAGE_BYTES / 1_000_000}MB`,
      );

    const raw = Buffer.from(await file.arrayBuffer());
    capturedAt = readCapturedAt(raw);
    const stored = stripApp1(raw);
    mime = file.type.toLowerCase();
    size = stored.length;
    sha256 = createHash("sha256").update(stored).digest("hex");
    storagePath = `${jobId}/${randomUUID()}.${ext}`;

    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, stored, { contentType: mime, upsert: false });
    // The bucket answers to the same predicate as the evidence table, so a
    // refusal here means this person is not party to this job.
    if (upErr) throw new Error("refused");
  } else {
    sha256 = createHash("sha256").update(label + "|" + jobId).digest("hex");
  }

  // Materials evidence is the receipt, the photographs and the video of the
  // materials in the place the CLIENT nominated, and filing it is what moves
  // the risk in them onto the client. It is a declared kind rather than a
  // label the database reads, and it is refused outright on a job with no
  // nomination: see 20260828c_materials_custody.sql. Anything else is work.
  const kindRaw = String(formData.get("kind") ?? "");
  const kind = kindRaw === "materials" ? "materials" : "work";

  // Which section of the job this belongs to, declared in answer to a direct
  // question on the form and never read out of the label. See 20260906000500.
  // Anything that is not one of the four words is null, which means nobody
  // said, and is not the same as no. Materials evidence carries no phase at
  // all: it is a section in its own right on evidence.kind, and the constraint
  // refuses it, so it is dropped here rather than sent to be rejected.
  const phaseRaw = String(formData.get("phase") ?? "");
  const phase = kind === "materials" ? null : isPhase(phaseRaw) ? phaseRaw : null;

  const stage = /^\d+$/.test(stageRaw) ? parseInt(stageRaw, 10) : null;

  const { error } = await supabase.from("evidence").insert({
    job_id: jobId,
    label: label.slice(0, 140),
    img: null,
    storage_path: storagePath,
    bytes: size,
    mime,
    kind,
    phase,
    stage,
    sha256,
    captured_at: capturedAt ? capturedAt.toISOString() : null,
    uploaded_by: (user.email ?? "").toLowerCase(),
    ok: null,
  });
  if (error) {
    // The row is the record. A file with no row is not evidence, it is litter,
    // and the storage policy lets the uploader clear exactly that: the moment
    // a row points at the path, nobody but an admin can remove it.
    if (storagePath) await supabase.storage.from(BUCKET).remove([storagePath]);
    // The materials gate raises with a sentence written for the person reading
    // it, so pass it through rather than flattening it to "refused". Being told
    // the client has not said where the materials go is actionable; being told
    // the database said no is not.
    throw new Error(/materials store/i.test(error.message) ? error.message : "refused");
  }
  revalidatePath("/portal/jobs/" + jobId);
}
