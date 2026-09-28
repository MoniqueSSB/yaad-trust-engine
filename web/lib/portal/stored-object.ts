import { createClient } from "@/lib/supabase/server";
import { jpegHasApp1 } from "@/lib/exif";

/**
 * Large files go straight from the phone to Storage (founder, 28 Sep 2026:
 * "25mb is not enough"). Until then every photo and document rode inside a
 * Server Action body, capped at 25MB by next.config.ts, and on a Worker a
 * bigger body is not something to raise lightly.
 *
 * So a file now arrives in two steps. startDirectUpload() picks the path on
 * the server (a client-chosen path is how one job's file lands in another
 * job's folder) and mints a one-path signed upload URL AS the signed-in
 * user, so Storage's own row level security decides who may write there. The
 * browser then PUTs the file to that URL. Then the ordinary action for that
 * kind of file (evidence, add-on photo, job file) calls verifyStored(), which
 * fetches what actually arrived and fingerprints it here, on the server,
 * streaming, from the exact bytes stored. The fingerprint is never taken from
 * anything the browser says.
 *
 * The location promise stands. A JPEG's APP1 segment (Exif, where a phone
 * writes GPS) is taken off in the browser before upload, and verifyStored()
 * reads the stored file's header and refuses, and deletes, any JPEG that
 * still carries one.
 */

export type UploadPurpose = "evidence_photo" | "addon_photo" | "job_file";

export const LIMITS: Record<UploadPurpose, number> = {
  evidence_photo: 50_000_000,
  addon_photo: 50_000_000,
  job_file: 100_000_000,
};

const URL_BASE = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";

async function accessToken(): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

function objectUrl(bucket: string, path: string): string {
  return `${URL_BASE}/storage/v1/object/authenticated/${bucket}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

function hex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** SHA-256 of a stream without holding it in memory where the runtime allows
 *  (Cloudflare's crypto.DigestStream). Elsewhere, the local dev server,
 *  it buffers, which is fine for a developer's test file. */
async function sha256OfStream(body: ReadableStream<Uint8Array>, max: number): Promise<{ sha256: string; bytes: number }> {
  let bytes = 0;
  const counted = body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, ctl) {
        bytes += chunk.byteLength;
        if (bytes > max) throw new Error("too_large");
        ctl.enqueue(chunk);
      },
    }),
  );
  const DS = (crypto as unknown as { DigestStream?: new (alg: string) => WritableStream<Uint8Array> & { digest: Promise<ArrayBuffer> } }).DigestStream;
  if (DS) {
    const ds = new DS("SHA-256");
    await counted.pipeTo(ds);
    return { sha256: hex(await ds.digest), bytes };
  }
  const buf = await new Response(counted).arrayBuffer();
  return { sha256: hex(await crypto.subtle.digest("SHA-256", buf)), bytes };
}

export type Stored = { ok: true; sha256: string; bytes: number; mime: string } | { ok: false; message: string };

/**
 * Fingerprint what actually arrived at bucket/path, as the signed-in user.
 * Refuses (and removes) an empty file, one over the limit, or a JPEG still
 * carrying its location segment.
 */
export async function verifyStored(bucket: string, path: string, max: number): Promise<Stored> {
  const token = await accessToken();
  if (!token) return { ok: false, message: "You have been signed out. Sign in again and send it once more." };
  const headers = { Authorization: `Bearer ${token}`, apikey: KEY };
  const supabase = await createClient();
  const remove = () => supabase.storage.from(bucket).remove([path]);

  const res = await fetch(objectUrl(bucket, path), { headers });
  if (!res.ok || !res.body) return { ok: false, message: "That file did not arrive. Try again." };
  const mime = (res.headers.get("content-type") ?? "application/octet-stream").split(";")[0].toLowerCase();

  let out: { sha256: string; bytes: number };
  try {
    out = await sha256OfStream(res.body, max);
  } catch {
    await remove();
    return { ok: false, message: `That file is too large. Keep it under ${Math.round(max / 1_000_000)}MB.` };
  }
  if (out.bytes === 0) {
    await remove();
    return { ok: false, message: "That file was empty. Nothing was filed." };
  }

  if (mime === "image/jpeg") {
    const head = await fetch(objectUrl(bucket, path), { headers: { ...headers, Range: "bytes=0-262143" } });
    const bytes = new Uint8Array(await head.arrayBuffer());
    if (jpegHasApp1(bytes)) {
      await remove();
      return { ok: false, message: "That photo still carried its location data, so it was not kept. Reload the page and send it again." };
    }
  }
  return { ok: true, ...out, mime };
}

/** Where the browser is told to put the file, and the one-time token for it. */
export type Started = { ok: true; bucket: string; path: string; token: string } | { ok: false; message: string };

export async function signUpload(bucket: string, path: string): Promise<Started> {
  const supabase = await createClient();
  const { data, error } = await supabase.storage.from(bucket).createSignedUploadUrl(path);
  if (error || !data) {
    return { ok: false, message: "The upload could not start. Check you are signed in as the client or the booked worker on this job." };
  }
  return { ok: true, bucket, path, token: data.token };
}

/** A path this server picked: the expected prefix, then a uuid and an extension. */
export function isOurPath(path: string, prefix: string): boolean {
  return path.startsWith(prefix) && /^[0-9a-f-]{36}\.[a-z0-9]{2,5}$/i.test(path.slice(prefix.length));
}

/** Parse a capture time the browser read from the photo before stripping it.
 *  The same sanity rules as readCapturedAt: not in the future, not before 2020. */
export function capturedAtFrom(raw: unknown): string | null {
  const s = String(raw ?? "");
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  if (d.getTime() > Date.now() + 25 * 3600_000 || d.getUTCFullYear() < 2020) return null;
  return d.toISOString();
}
