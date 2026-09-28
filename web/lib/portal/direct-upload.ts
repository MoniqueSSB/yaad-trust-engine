import { createClient } from "@/lib/supabase/client";
import { readCapturedAt, stripApp1 } from "@/lib/exif";
import { startUpload } from "@/app/portal/upload-actions";
import type { UploadPurpose } from "@/lib/portal/stored-object";

/**
 * Browser half of a direct upload (see lib/portal/stored-object.ts). A JPEG's
 * location segment comes off here, on the phone, before a byte leaves it; the
 * capture time is read first so it is not lost with it. The server picks the
 * path and signs it; the file goes straight to Storage; the calling form then
 * hands the path to its own action, which verifies and fingerprints what
 * arrived. Returned, never thrown, so the page can say what happened.
 */
export type DirectUploaded =
  | { ok: true; path: string; capturedAt: string | null }
  | { ok: false; message: string };

export async function directUpload(
  file: File,
  purpose: UploadPurpose,
  jobId: string,
  addonId?: string | null,
): Promise<DirectUploaded> {
  const mime = (file.type || "").toLowerCase();
  let body: Blob = file;
  let capturedAt: string | null = null;
  if (mime === "image/jpeg") {
    const raw = new Uint8Array(await file.arrayBuffer());
    const when = readCapturedAt(raw);
    capturedAt = when ? when.toISOString() : null;
    body = new Blob([stripApp1(raw) as BlobPart], { type: mime });
  }

  const started = await startUpload({ purpose, jobId, mime, bytes: body.size, addonId: addonId ?? null });
  if (!started.ok) return { ok: false, message: started.message };

  const supabase = createClient();
  const { error } = await supabase.storage
    .from(started.bucket)
    .uploadToSignedUrl(started.path, started.token, body, { contentType: mime });
  if (error) {
    return { ok: false, message: "The file did not finish uploading. Check the signal and try again. Nothing was filed." };
  }
  return { ok: true, path: started.path, capturedAt };
}
