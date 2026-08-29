"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * Evidence upload, PORTAL-SPEC 5.3. The fingerprint is computed HERE, on
 * the server, from the exact bytes stored, and written once at insert.
 * It is never recomputed on read: change one pixel and it stops matching.
 * RLS decides who may file evidence against which job.
 */

const MAX_DATAURL = 1_800_000; // ~1.3MB of image after base64

export async function uploadEvidence(formData: FormData): Promise<void> {
  const user = await requireUser();
  const jobId = String(formData.get("jobId") ?? "");
  const label = String(formData.get("label") ?? "").trim();
  const stageRaw = String(formData.get("stage") ?? "");
  const file = formData.get("photo");
  if (!jobId || !label) throw new Error("missing");

  let img: string | null = null;
  if (file instanceof File && file.size > 0) {
    if (!/^image\//.test(file.type)) throw new Error("not an image");
    const buf = Buffer.from(await file.arrayBuffer());
    img = `data:${file.type};base64,${buf.toString("base64")}`;
    if (img.length > MAX_DATAURL)
      throw new Error("too large: keep photos under about 1.3MB");
  }

  // Materials evidence is the receipt, the photographs and the video of the
  // materials in the place the CLIENT nominated, and filing it is what moves
  // the risk in them onto the client. It is a declared kind rather than a
  // label the database reads, and it is refused outright on a job with no
  // nomination: see 20260828c_materials_custody.sql. Anything else is work.
  const kindRaw = String(formData.get("kind") ?? "");
  const kind = kindRaw === "materials" ? "materials" : "work";

  const stage = /^\d+$/.test(stageRaw) ? parseInt(stageRaw, 10) : null;
  const sha256 = createHash("sha256")
    .update(img ?? label + "|" + jobId)
    .digest("hex");

  const supabase = await createClient();
  const { error } = await supabase.from("evidence").insert({
    job_id: jobId,
    label: label.slice(0, 140),
    img,
    kind,
    stage,
    sha256,
    uploaded_by: (user.email ?? "").toLowerCase(),
    ok: null,
  });
  // The materials gate raises with a sentence written for the person reading
  // it, so pass it through rather than flattening it to "refused". Being told
  // the client has not said where the materials go is actionable; being told
  // the database said no is not.
  if (error) throw new Error(/materials store/i.test(error.message) ? error.message : "refused");
  revalidatePath("/portal/jobs/" + jobId);
}
