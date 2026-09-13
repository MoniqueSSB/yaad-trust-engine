"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/* ── Photographs, attached on the form ─────────────────────────────────────
 *
 * FOUNDER INSTRUCTION, 6 September 2026: "it should be in the form to attach a
 * photo and it be included on the job card". Before this, stage four of
 * /jobs/new explained what to photograph and then sent people somewhere else
 * to send it. Somebody standing in front of the problem, with the picture
 * already on their phone, had to leave a half-finished form to use it.
 *
 * The file never travels through this page's own form submission. It goes:
 *
 *   yaad-job-photo {action:"start"}   the server picks the path and hands back
 *                                     a signed upload URL. A browser-chosen
 *                                     path is how one job's photograph gets
 *                                     written into another job's folder.
 *   uploadToSignedUrl                 straight into the private intake bucket.
 *   yaad-job-photo {action:"finish"}  the server downloads what arrived,
 *                                     strips every APP1 segment, and only then
 *                                     writes the job_photos row.
 *
 * WHY NOT THE OLD ROUTE. yaad-post-job still accepts a base64 photos array
 * left over from the deleted funnel: no size limit, written into the immutable
 * evidence table, with the GPS coordinate the phone wrote left on it. That is
 * the route this replaces, and nothing here should ever be moved onto it.
 * These photographs are capped, stored privately, stripped of location, and
 * can be taken back by the person who sent them.
 *
 * PRIVATE, always. board_ok is false on every row this writes and there is no
 * control here that can change it. A photograph reaches the public board only
 * when a person at the desk publishes it.
 *
 * The thumbnails are local object URLs, not signed links back out of the
 * bucket. Nothing on this screen needs the server's copy, and a page that
 * never asks for one cannot leak one.
 */

const FN = "yaad-job-photo";
const MAX = 8;
const MAX_BYTES = 12_000_000;
const OK_TYPES = ["image/jpeg", "image/png", "image/webp"];

type Shot = {
  key: string;
  name: string;
  url: string;
  state: "busy" | "done" | "error";
  photoId?: string;
  error?: string;
};

export function PhotoAttach({
  jobId,
  code,
  onCountChange,
}: {
  jobId: string;
  code: string;
  /** So the form can tell Monique how many arrived with the job. */
  onCountChange?: (n: number) => void;
}) {
  const [shots, setShots] = useState<Shot[]>([]);
  const [note, setNote] = useState("");
  const input = useRef<HTMLInputElement>(null);
  /* Object URLs are revoked by hand. A phone that picks eight photographs and
     then leaves the tab open holds eight decoded images otherwise. */
  const urls = useRef<string[]>([]);
  useEffect(() => () => { for (const u of urls.current) URL.revokeObjectURL(u); }, []);

  const done = shots.filter((s) => s.state === "done").length;
  useEffect(() => { onCountChange?.(done); }, [done, onCountChange]);

  const call = useCallback(async (body: Record<string, unknown>) => {
    const sb = createClient();
    const { data, error } = await sb.functions.invoke(FN, { body: { ...body, jobId, code } });
    if (error) {
      let msg = "That did not send.";
      try {
        const ctx = (error as { context?: Response }).context;
        const j = ctx ? await ctx.json() : null;
        if (j?.error) msg = String(j.error);
      } catch { /* keep the generic message */ }
      throw new Error(msg);
    }
    const d = (data ?? {}) as Record<string, unknown>;
    if (d.error) throw new Error(String(d.error));
    return d;
  }, [jobId, code]);

  async function send(file: File, key: string) {
    const started = await call({
      action: "start", mime: file.type.toLowerCase(), bytes: file.size,
    });
    const sb = createClient();
    const { error: upErr } = await sb.storage
      .from("intake")
      .uploadToSignedUrl(String(started.path), String(started.token), file, {
        contentType: file.type.toLowerCase(),
      });
    if (upErr) throw new Error(upErr.message);
    /* Only the finish call attaches it. A file that reached the bucket and no
       further is litter the server clears, and it must never show on this
       screen as though it had landed. */
    const fin = await call({ action: "finish", path: String(started.path), caption: file.name.slice(0, 140) });
    setShots((s) => s.map((x) => (x.key === key ? { ...x, state: "done", photoId: String(fin.photoId ?? "") } : x)));
  }

  async function choose(files: FileList | null) {
    if (!files?.length) return;
    setNote("");
    const room = MAX - shots.filter((s) => s.state !== "error").length;
    if (room <= 0) { setNote(`That is ${MAX} photographs, which is plenty. Send any more when we reply.`); return; }
    const picked = Array.from(files).slice(0, room);
    if (picked.length < files.length) setNote(`Taking the first ${picked.length}. ${MAX} is the limit on this form.`);

    for (const file of picked) {
      const key = crypto.randomUUID();
      /* Checked here as well as on the server, because the point of checking
         in the browser is the sentence, not the safety: a person holding the
         phone gets told what is wrong with the file instead of watching an
         upload fail. */
      if (!OK_TYPES.includes(file.type.toLowerCase())) {
        setShots((s) => [...s, { key, name: file.name, url: "", state: "error",
          error: file.type.startsWith("image/")
            ? `${file.type.replace("image/", "").toUpperCase()} images do not show in most browsers. Send it as a JPEG.`
            : "That is not a photograph." }]);
        continue;
      }
      if (file.size > MAX_BYTES) {
        setShots((s) => [...s, { key, name: file.name, url: "", state: "error",
          error: `Too large at ${(file.size / 1_000_000).toFixed(1)}MB. Keep them under about ${MAX_BYTES / 1_000_000}MB.` }]);
        continue;
      }
      const url = URL.createObjectURL(file);
      urls.current.push(url);
      setShots((s) => [...s, { key, name: file.name, url, state: "busy" }]);
      try {
        await send(file, key);
      } catch (e) {
        setShots((s) => s.map((x) => (x.key === key
          ? { ...x, state: "error", error: e instanceof Error ? e.message : "That did not send." }
          : x)));
      }
    }
    if (input.current) input.current.value = "";
  }

  async function take(shot: Shot) {
    if (shot.state === "done" && shot.photoId) {
      try {
        await call({ action: "remove", photoId: shot.photoId });
      } catch (e) {
        setShots((s) => s.map((x) => (x.key === shot.key
          ? { ...x, error: e instanceof Error ? e.message : "That did not come off." }
          : x)));
        return;
      }
    }
    if (shot.url) URL.revokeObjectURL(shot.url);
    urls.current = urls.current.filter((u) => u !== shot.url);
    setShots((s) => s.filter((x) => x.key !== shot.key));
  }

  const busy = shots.some((s) => s.state === "busy");

  return (
    <div className="mt-3">
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        className="sr-only"
        id="job-photos"
        onChange={(e) => void choose(e.target.files)}
      />
      <label
        htmlFor="job-photos"
        className="inline-block cursor-pointer rounded-full bg-linear-to-r from-teal to-mango px-5 py-2.5 text-[13px] font-bold text-onbrand transition hover:brightness-110"
      >
        {shots.length ? "Attach another photo" : "Attach a photo"}
      </label>
      <span className="ml-3 text-[12.5px] text-dim">
        {done ? `${done} attached to ${jobId}.` : `Up to ${MAX}. From the camera roll or straight from the camera.`}
      </span>

      {note && <p className="mt-2 text-[12.5px] text-mango">{note}</p>}

      {shots.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2.5">
          {shots.map((s) => (
            <li
              key={s.key}
              className={
                "relative h-[92px] w-[136px] shrink-0 overflow-hidden rounded-xl border bg-soft " +
                (s.state === "error" ? "border-coral/60" : "border-softline")
              }
            >
              {s.url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={s.url} alt={s.name} className="size-full object-cover" />
              )}
              <span className="absolute inset-x-0 bottom-0 bg-bg/85 px-2 py-1 text-[9px] leading-tight text-mute">
                {s.state === "busy" && "Sending…"}
                {s.state === "done" && "Private · on the job"}
                {s.state === "error" && (s.error ?? "Did not send")}
              </span>
              {s.state !== "busy" && (
                <button
                  type="button"
                  onClick={() => void take(s)}
                  aria-label={`Take ${s.name} off the job`}
                  className="absolute right-1 top-1 rounded-full border border-line bg-bg/85 px-2 py-0.5 text-[11px] font-bold text-mute hover:text-ink"
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <p className="mt-3 text-[12.5px] leading-relaxed">
        They go straight onto job <span className="font-mono text-ink">{jobId}</span> and
        nowhere else. Stored privately, the location your phone writes into the
        file is removed before anything is kept, and{" "}
        <b className="text-ink">nothing is published unless you say so.</b> The
        × takes one back off the job.
        {busy && " One is still sending, so give it a moment before you carry on."}
      </p>
    </div>
  );
}
