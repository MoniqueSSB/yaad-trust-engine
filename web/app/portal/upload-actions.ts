"use server";

import { randomUUID } from "node:crypto";
import { requireUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { LIMITS, signUpload, type Started, type UploadPurpose } from "@/lib/portal/stored-object";
import { extFor } from "@/lib/portal/job-files";

/**
 * Step one of a direct upload (see lib/portal/stored-object.ts): the server
 * picks where the file goes and hands back a one-path signed upload URL,
 * minted as the signed-in user so Storage's own policies decide. Nothing is
 * recorded here; the file only becomes evidence, an add-on photo or a job
 * file when the matching action verifies and fingerprints it.
 */

const JOB_ID = /^[A-Za-z0-9_-]{1,64}$/;
const PHOTO_EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

export async function startUpload(input: {
  purpose: UploadPurpose;
  jobId: string;
  mime: string;
  bytes: number;
  addonId?: string | null;
}): Promise<Started> {
  let email: string;
  try {
    email = ((await requireUser()).email ?? "").toLowerCase();
  } catch {
    return { ok: false, message: "You have been signed out. Sign in again and send it once more." };
  }
  const { purpose, jobId } = input;
  const mime = String(input.mime ?? "").toLowerCase();
  const bytes = Number(input.bytes ?? 0);
  if (!JOB_ID.test(jobId)) return { ok: false, message: "That job reference is not valid." };
  const max = LIMITS[purpose];
  if (!max) return { ok: false, message: "That kind of upload is not recognised." };
  if (!Number.isFinite(bytes) || bytes <= 0) return { ok: false, message: "That file looks empty." };
  if (bytes > max) {
    return { ok: false, message: `Too large at ${(bytes / 1_000_000).toFixed(1)}MB. Keep it under ${Math.round(max / 1_000_000)}MB.` };
  }

  if (purpose === "evidence_photo" || purpose === "addon_photo") {
    const ext = PHOTO_EXT[mime];
    if (!ext) return { ok: false, message: "Send a JPEG, PNG or WebP photograph." };
    if (purpose === "addon_photo") {
      const addonId = String(input.addonId ?? "");
      if (!/^[0-9a-f-]{36}$/i.test(addonId)) return { ok: false, message: "This form lost track of the add-on. Reload the page." };
      return signUpload("evidence", `${jobId}/addon-${addonId}/${randomUUID()}.${ext}`);
    }
    return signUpload("evidence", `${jobId}/${randomUUID()}.${ext}`);
  }

  // job_file: the folder is the uploader's side of the job, as addJobFile has
  // always stored it, decided here from the job row, never from the browser.
  const ext = extFor(mime);
  if (!ext) return { ok: false, message: "Send it as a PDF, a JPEG, PNG or WebP picture, or a Word document." };
  const supabase = await createClient();
  const { data: job } = await supabase.from("jobs").select("client_email,worker_email").eq("id", jobId).maybeSingle();
  const side = job && (job.client_email ?? "").toLowerCase() === email && job.client_email
    ? "client"
    : job && (job.worker_email ?? "").toLowerCase() === email && job.worker_email
      ? "worker"
      : null;
  if (!side) return { ok: false, message: "Only the client and the booked worker can add files to this job." };
  return signUpload("job-files", `${side}/${jobId}/${randomUUID()}.${ext}`);
}
