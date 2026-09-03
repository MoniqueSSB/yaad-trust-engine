"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { stripApp1 } from "@/lib/exif";

/**
 * Photographs of the job, sent by the client.
 *
 * Until 2 Sep 2026 the only way a picture could reach Yaadly was a WhatsApp
 * message, and the job wizard said so: "the quickest way to send them is on
 * WhatsApp once we reply". A client who posted on the web and never wrote to
 * the number had no way at all, and photographs are the one thing that turns
 * a guess into a quote.
 *
 * This is deliberately the same shape as evidence-actions.ts, which is the
 * same shape as the worker's own document upload: the browser posts to a
 * Server Action, the Server Action writes into a PRIVATE bucket through the
 * client's own session, and a Postgres policy decides whether that is
 * allowed. Nothing here is trusted to the page.
 *
 * Two things are different from evidence, and both on purpose.
 *
 * The path prefix is 'client/', where yaad-inbound writes 'whatsapp/'. A
 * client cannot write outside their own prefix, so they can never place a
 * file into, or shadow a file in, the folder the assistant fills.
 *
 * And these can be deleted. Evidence is immutable because a fingerprint has
 * to mean something. A photograph of the job is the client's own account of
 * it, and somebody who has just sent a picture of the inside of their house
 * to the wrong place must be able to take it back.
 *
 * board_ok is the client's to set on a photograph they send themselves
 * (20260903b): they tick it at upload, or flip it later with
 * setJobPhotoBoard() below. A WhatsApp photograph stays the desk's call, and
 * Postgres is what enforces that, not this file.
 */

const BUCKET = "intake";

// The bucket's own file_size_limit is 26214400. Refusing above 20MB here
// means the person holding the phone gets a sentence rather than a failed
// request they have to interpret.
const MAX_IMAGE_BYTES = 20_000_000;

// Only what a browser will actually paint. HEIC is the one worth naming: an
// iPhone shooting in High Efficiency usually transcodes to JPEG on its way
// through a file input, but when it does not, the file stores fine and then
// renders as a blank tile for the worker who needed to see it.
const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export async function uploadJobPhoto(formData: FormData): Promise<void> {
  await requireUser();
  const jobId = String(formData.get("jobId") ?? "");
  const caption = String(formData.get("caption") ?? "").trim();
  const file = formData.get("photo");
  // The checkbox on the form. Absent means unticked, which means private.
  const onBoard = formData.get("board") === "on";

  // The job id becomes the second folder of the object path and is written
  // into a LIKE pattern in the insert policy, so it is checked here rather
  // than trusted. A slash, a dot-dot or a percent in this value is how one
  // job's photograph gets written into another job's folder.
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(jobId)) throw new Error("refused");
  if (!(file instanceof File) || file.size === 0) throw new Error("no photo chosen");

  if (!/^image\//.test(file.type)) throw new Error("that is not an image");
  const ext = EXT[file.type.toLowerCase()];
  if (!ext)
    throw new Error(
      `this is a ${file.type.replace("image/", "").toUpperCase()} image, which most browsers cannot display. Send it as a JPEG.`,
    );
  if (file.size > MAX_IMAGE_BYTES)
    throw new Error(
      `too large at ${(file.size / 1_000_000).toFixed(1)}MB: keep photos under about ${MAX_IMAGE_BYTES / 1_000_000}MB`,
    );

  const supabase = await createClient();

  // The APP1 segment carries the GPS coordinate the phone wrote when the
  // shutter fired. A photograph of the inside of a house, often an empty one,
  // does not also need to carry its latitude, and this photograph may later
  // be published to a public board. Dropped before anything is stored, the
  // same way evidence does it. captured_at is deliberately NOT read here:
  // job_photos has no column for it, and inventing one to hold a value
  // nothing reads is how a table grows fields nobody can account for.
  const stored = stripApp1(Buffer.from(await file.arrayBuffer()));
  const mime = file.type.toLowerCase();
  const storagePath = `client/${jobId}/${randomUUID()}.${ext}`;

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, stored, { contentType: mime, upsert: false });
  // The bucket answers to the same predicate as the table, so a refusal here
  // means this person is not the client on this job.
  if (upErr) throw new Error("refused");

  // Positions follow the WhatsApp convention of tens, so a photograph sent
  // here and a photograph sent on WhatsApp interleave in the order they
  // arrived rather than one set always sorting before the other.
  const { data: last } = await supabase
    .from("job_photos")
    .select("position")
    .eq("job_id", jobId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await supabase.from("job_photos").insert({
    job_id: jobId,
    caption: caption ? caption.slice(0, 140) : "Sent by the client",
    img: null,
    storage_path: storagePath,
    mime,
    bytes: stored.length,
    kind: "photo",
    source: "client",
    board_ok: onBoard,
    position: (last?.position ?? -10) + 10,
  });
  if (error) {
    // A file with no row is litter. The storage policy lets the uploader clear
    // exactly that, and stops the moment a row points at the path.
    await supabase.storage.from(BUCKET).remove([storagePath]);
    throw new Error("refused");
  }
  revalidatePath("/portal/jobs/" + jobId);
}

/**
 * Take one back. Row first, then the file: the storage policy only permits
 * removing an object nothing points at, so this order is the only one that
 * works, and a failure halfway leaves a file with no row rather than a row
 * with no file, which is the harmless way round.
 *
 * Since 20260903b this works whether or not the photograph is on the board:
 * the client put it there, so the client takes it down. A WhatsApp photograph
 * is still refused by the policy, because the assistant saved it out of a
 * conversation and a person at the desk decides what happens to it.
 */
export async function removeJobPhoto(formData: FormData): Promise<void> {
  await requireUser();
  const jobId = String(formData.get("jobId") ?? "");
  const photoId = String(formData.get("photoId") ?? "");
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(jobId)) throw new Error("refused");
  if (!photoId) throw new Error("refused");

  const supabase = await createClient();

  const { data: row } = await supabase
    .from("job_photos")
    .select("id,storage_path,board_ok,source")
    .eq("id", photoId)
    .eq("job_id", jobId)
    .maybeSingle();
  if (!row) throw new Error("refused");
  if (row.source !== "client")
    throw new Error(
      "this one came in on WhatsApp, so a person at Yaadly removes it. Ask, and it is done the same day.",
    );

  const { error } = await supabase.from("job_photos").delete().eq("id", photoId);
  if (error) throw new Error("refused");
  if (row.storage_path) await supabase.storage.from(BUCKET).remove([row.storage_path]);
  revalidatePath("/portal/jobs/" + jobId);
}

/**
 * On or off the public board, for a photograph this client sent themselves.
 * set_job_photo_board_as_me() in Postgres (20260903b) is the whole rule: the
 * job's own client, a row they uploaded, nothing else on the row reachable.
 * The refusal comes back in the words the database used.
 */
export async function setJobPhotoBoard(formData: FormData): Promise<void> {
  await requireUser();
  const jobId = String(formData.get("jobId") ?? "");
  const photoId = String(formData.get("photoId") ?? "");
  const on = formData.get("on") === "true";
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(jobId)) throw new Error("refused");
  if (!photoId) throw new Error("refused");

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_job_photo_board_as_me", {
    p_photo: photoId,
    p_on: on,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/portal/jobs/" + jobId);
}
