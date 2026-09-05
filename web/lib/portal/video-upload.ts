"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { QueueItem } from "./video-queue";

/**
 * Pushes one queued video through yaad-evidence-video: start, PUT to the
 * signed URL, finish. Whole-file retry, not byte-range resume; nothing in
 * this codebase does chunked resume, and re-sending a video after a dropped
 * connection is the same trade the vetting upload flow already makes for
 * documents. See yaad-evidence-video/index.ts for why the server, not this
 * function, is what actually decides the row gets written.
 *
 * Mirrors the limits inside yaad-evidence-video/index.ts. Kept in sync by
 * hand rather than imported, the same way MAX_IMAGE_BYTES in
 * evidence-actions.ts stands apart from the bucket's own ceiling: this pair
 * fails fast in the browser with a sentence a worker can act on, the
 * function's own copy is what actually decides.
 */
export const MAX_VIDEO_BYTES = 80_000_000;
export const VIDEO_MIME_OK = ["video/mp4", "video/webm", "video/quicktime"];

/**
 * A non-2xx from functions.invoke arrives as an error with the real body
 * hidden on .context, not on data. Same fix, same reason, as JoinFlow.tsx's
 * call() for yaad-vetting-upload: the server writes refusal messages meant
 * to be read ("You may not be on this job", "no materials store nominated"),
 * and without this they never reach the worker.
 */
async function call(
  supabase: SupabaseClient,
  body: Record<string, unknown>,
): Promise<{ ok: true; [k: string]: unknown } | { ok: false; error: string }> {
  const { data, error } = await supabase.functions.invoke("yaad-evidence-video", { body });
  if (error) {
    let msg = "Something went wrong. Nothing was stored.";
    try {
      const ctx = (error as { context?: Response }).context;
      const j = ctx ? await ctx.json() : null;
      if (j?.error) msg = String(j.error);
    } catch { /* keep the generic message */ }
    return { ok: false, error: msg };
  }
  const d = (data ?? {}) as Record<string, unknown>;
  if (d.error) return { ok: false, error: String(d.error) };
  return { ok: true, ...d };
}

export async function uploadQueuedVideo(
  supabase: SupabaseClient,
  item: QueueItem,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return { ok: false, error: "Not signed in." };

  const start = await call(supabase, { action: "start", jobId: item.jobId, mime: item.mime, bytes: item.bytes });
  if (!start.ok) return start;

  const { error: putErr } = await supabase.storage
    .from("evidence")
    .uploadToSignedUrl(start.path as string, start.token as string, item.file, { contentType: item.mime });
  if (putErr) {
    return { ok: false, error: "The video did not arrive. It will try again." };
  }

  const finish = await call(supabase, {
    action: "finish",
    jobId: item.jobId,
    path: start.path,
    label: item.label,
    stage: item.stage,
    kind: item.kind,
    phase: item.phase ?? null,
  });
  if (!finish.ok) return finish;

  return { ok: true };
}
