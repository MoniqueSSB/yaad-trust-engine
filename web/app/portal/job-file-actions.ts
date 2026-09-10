"use server";

import { createHash, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { stripApp1 } from "@/lib/exif";
import { extFor, fileProblem, isFileKind } from "@/lib/portal/job-files";

/**
 * Files on a job, from either side: receipts, quotes, permits, plans,
 * certificates, pictures that are not evidence. 20260910120000.
 *
 * Same shape as job-photo-actions.ts and evidence-actions.ts, on purpose: the
 * browser posts to a Server Action, the action writes into a PRIVATE bucket
 * through the person's own session, and a Postgres policy decides whether
 * that is allowed. The side on the path and on the row is the side this
 * person actually is on the job, and job_party_side() in Postgres is what
 * says so; this file asks the same question first only so the refusal can
 * be a sentence.
 *
 * The sha256 is computed HERE, on the server, from the exact bytes stored,
 * and written once. For a JPEG the APP1 segment (the GPS coordinate the
 * phone wrote) is dropped first, the same way evidence and job photos do it,
 * and the fingerprint covers the bytes actually kept.
 *
 * Nothing here is evidence. No status changes, no approval snapshot, no
 * check lock. No model ever reads a job file.
 */

const BUCKET = "job-files";
const JOB_ID = /^[A-Za-z0-9_-]{1,64}$/;

async function mySide(jobId: string, email: string): Promise<"client" | "worker" | null> {
  const supabase = await createClient();
  const { data: job } = await supabase
    .from("jobs")
    .select("client_email,worker_email")
    .eq("id", jobId)
    .maybeSingle();
  if (!job) return null;
  const me = email.toLowerCase();
  if ((job.client_email ?? "").toLowerCase() === me && job.client_email) return "client";
  if ((job.worker_email ?? "").toLowerCase() === me && job.worker_email) return "worker";
  return null;
}

export async function addJobFile(formData: FormData): Promise<void> {
  const user = await requireUser();
  const email = (user.email ?? "").toLowerCase();
  const jobId = String(formData.get("jobId") ?? "");
  const file = formData.get("file");
  const kindRaw = String(formData.get("kind") ?? "other");
  const label = String(formData.get("label") ?? "").trim().slice(0, 140);

  if (!JOB_ID.test(jobId) || !email) throw new Error("refused");
  if (!(file instanceof File)) throw new Error("no file chosen");
  const problem = fileProblem(file.type, file.size);
  if (problem) throw new Error(problem);
  const kind = isFileKind(kindRaw) ? kindRaw : "other";
  const ext = extFor(file.type)!;
  const mime = file.type.toLowerCase();

  const side = await mySide(jobId, email);
  if (!side) throw new Error("refused");

  const raw = Buffer.from(await file.arrayBuffer());
  const stored = mime === "image/jpeg" ? stripApp1(raw) : raw;
  const sha256 = createHash("sha256").update(stored).digest("hex");
  const storagePath = `${side}/${jobId}/${randomUUID()}.${ext}`;

  const supabase = await createClient();
  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, stored, { contentType: mime, upsert: false });
  // The bucket answers to the same predicate as the table, so a refusal here
  // means this person is not on this job, or the job is closed.
  if (upErr) throw new Error("refused");

  const { error } = await supabase.from("job_files").insert({
    job_id: jobId,
    side,
    uploaded_by: email,
    kind,
    label,
    storage_path: storagePath,
    mime,
    bytes: stored.length,
    sha256,
  });
  if (error) {
    // A file with no row is litter. The storage policy lets the uploader clear
    // exactly that, and stops the moment a row points at the path.
    await supabase.storage.from(BUCKET).remove([storagePath]);
    throw new Error(error.message.includes("policy") ? "refused" : error.message);
  }
  revalidatePath("/portal/jobs/" + jobId);
}

/**
 * Take one back. Row first, then the file: the storage policy only permits
 * removing an object nothing points at, so this order is the only one that
 * works, and a failure halfway leaves a file with no row rather than a row
 * with no file, which is the harmless way round. The delete policy is what
 * limits this to your own file on a job that is not complete.
 */
export async function removeJobFile(formData: FormData): Promise<void> {
  await requireUser();
  const jobId = String(formData.get("jobId") ?? "");
  const fileId = String(formData.get("fileId") ?? "");
  if (!JOB_ID.test(jobId) || !/^[0-9a-f-]{36}$/.test(fileId)) throw new Error("refused");

  const supabase = await createClient();
  const { data: row } = await supabase
    .from("job_files")
    .select("id,storage_path")
    .eq("id", fileId)
    .eq("job_id", jobId)
    .maybeSingle();
  if (!row) throw new Error("refused");

  const { error, count } = await supabase
    .from("job_files")
    .delete({ count: "exact" })
    .eq("id", fileId);
  if (error || !count) throw new Error("refused");

  await supabase.storage.from(BUCKET).remove([row.storage_path]);
  revalidatePath("/portal/jobs/" + jobId);
}
