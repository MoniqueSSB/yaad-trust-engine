"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  addQueueItem,
  listQueueItems,
  removeQueueItem,
  updateQueueItem,
  type QueueItem,
} from "@/lib/portal/video-queue";
import { uploadQueuedVideo, MAX_VIDEO_BYTES, VIDEO_MIME_OK } from "@/lib/portal/video-upload";

// After this many failures an item stops retrying itself on reconnect and
// waits for a worker to tap Try again. Otherwise a video that fails for a
// real reason (the materials store question, say) would silently hammer the
// network every time the phone comes back into signal.
const MAX_AUTO_ATTEMPTS = 5;

// Some mobile browsers, iOS Safari in particular, leave File.type empty for
// a video recorded in-page. Falling back to the extension is the same trick
// JoinFlow.tsx already uses for the same reason on the same three formats.
function mimeOf(f: File): string {
  if (f.type) return f.type;
  const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "mp4") return "video/mp4";
  if (ext === "webm") return "video/webm";
  if (ext === "mov") return "video/quicktime";
  return "";
}

const mb = (n: number) => (n / 1_000_000).toFixed(1) + "MB";

const STATUS_LABEL: Record<QueueItem["status"], string> = {
  queued: "Waiting to upload",
  uploading: "Uploading...",
  failed: "Could not send",
  done: "Sent",
};

export function VideoEvidenceUpload({
  jobId,
  maxStage,
  storeType,
  store,
}: {
  jobId: string;
  maxStage: number;
  storeType: string | null;
  store: string | null;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [items, setItems] = useState<QueueItem[]>([]);
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<"work" | "materials">("work");
  const [phase, setPhase] = useState<"" | "before" | "after">("");
  const [stage, setStage] = useState(1);
  const [pickError, setPickError] = useState("");
  const processingRef = useRef(false);

  const refresh = useCallback(async () => {
    setItems(await listQueueItems(jobId));
  }, [jobId]);

  const runQueue = useCallback(async () => {
    if (processingRef.current || !navigator.onLine) return;
    processingRef.current = true;
    try {
      // Sequential, not parallel: a worker on a weak connection filing two
      // stage videos should not have them fighting each other for the same
      // thin pipe.
      for (;;) {
        const current = await listQueueItems(jobId);
        const next = current.find(
          (it) => it.status === "queued" || (it.status === "failed" && it.attempts < MAX_AUTO_ATTEMPTS),
        );
        if (!next) break;

        await updateQueueItem(next.id, { status: "uploading" });
        await refresh();

        const result = await uploadQueuedVideo(supabase, next);
        if (result.ok) {
          await removeQueueItem(next.id);
          router.refresh();
        } else {
          await updateQueueItem(next.id, {
            status: "failed",
            error: result.error,
            attempts: next.attempts + 1,
          });
        }
        await refresh();
      }
    } finally {
      processingRef.current = false;
    }
  }, [jobId, supabase, refresh, router]);

  useEffect(() => {
    let alive = true;
    listQueueItems(jobId).then((list) => {
      if (alive) setItems(list);
    });
    runQueue();
    window.addEventListener("online", runQueue);
    return () => {
      alive = false;
      window.removeEventListener("online", runQueue);
    };
  }, [jobId, runQueue]);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    setPickError("");
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!label.trim()) {
      setPickError("Give it a label first, then choose the video.");
      return;
    }
    const mime = mimeOf(file);
    if (!VIDEO_MIME_OK.includes(mime)) {
      setPickError("That file type is not accepted. Send an MP4, WebM or MOV video.");
      return;
    }
    if (file.size > MAX_VIDEO_BYTES) {
      setPickError(`Too large at ${mb(file.size)}: keep videos under ${mb(MAX_VIDEO_BYTES)}.`);
      return;
    }

    const item: QueueItem = {
      id: crypto.randomUUID(),
      jobId,
      stage,
      kind,
      phase: kind === "materials" || phase === "" ? null : phase,
      label: label.trim().slice(0, 140),
      mime,
      bytes: file.size,
      file,
      status: "queued",
      attempts: 0,
      error: null,
      createdAt: Date.now(),
    };
    await addQueueItem(item);
    setLabel("");
    await refresh();
    runQueue();
  }

  return (
    <div className="mt-4 rounded-2xl border border-line bg-panel p-4">
      <p className="text-[10.5px] font-bold uppercase tracking-[.2em] text-tealb">File video evidence</p>
      <p className="mt-1 text-[12px] leading-relaxed text-dim">
        A walkthrough proves what a still cannot. Choosing a video adds it to
        this list and it uploads from here, even if the connection drops:
        close the tab before it says Sent, and it picks up again next time
        this page is open with a signal.
      </p>
      <p className="mt-1.5 text-[12px] leading-relaxed text-dim">
        {storeType === "none_available"
          ? "There is no secure store on this property, so materials go off site each night and nothing passes to the client. File the receipt as part of the work."
          : store
            ? "Materials go here: " + store + ". Film them in that exact place and file it as materials on site."
            : "The client has not said where materials are to be kept, so materials evidence cannot be filed yet and the database will refuse it."}
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_150px_140px_120px_auto]">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          maxLength={140}
          placeholder='What this shows, e.g. "Stage 1 walkthrough"'
          className="rounded-xl border border-line bg-bg px-3.5 py-2.5 text-[13.5px] text-ink outline-none focus:border-teal"
        />
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value === "materials" ? "materials" : "work")}
          className="rounded-xl border border-line bg-bg px-3 py-2.5 text-[13px] text-ink outline-none focus:border-teal"
        >
          <option value="work">The work</option>
          <option value="materials" disabled={!storeType}>
            {storeType ? "Materials on site" : "Materials (no store named)"}
          </option>
        </select>
        {/* Declared, never read out of the label. A walk-round at the end of a
            stage is the ordinary "after"; the video taken before anything was
            touched is the ordinary "before". Neither is a real answer. */}
        <select
          value={kind === "materials" ? "" : phase}
          disabled={kind === "materials"}
          onChange={(e) => setPhase(e.target.value as "" | "before" | "after")}
          className="rounded-xl border border-line bg-bg px-3 py-2.5 text-[13px] text-ink outline-none focus:border-teal disabled:opacity-40"
        >
          {kind === "materials" ? (
            <option value="">Not a before or after</option>
          ) : (
            <>
              <option value="">Neither</option>
              <option value="before">Before</option>
              <option value="after">After</option>
            </>
          )}
        </select>
        <select
          value={stage}
          onChange={(e) => setStage(parseInt(e.target.value, 10))}
          className="rounded-xl border border-line bg-bg px-3 py-2.5 text-[13px] text-ink outline-none focus:border-teal"
        >
          {Array.from({ length: Math.max(1, maxStage) }, (_, i) => (
            <option key={i} value={i + 1}>Stage {i + 1}</option>
          ))}
        </select>
        {/* capture="environment" opens the phone's own camera on mobile
            rather than the file picker; it is ignored, harmlessly, on desktop
            browsers, which fall back to an ordinary file chooser. */}
        <input
          type="file"
          accept="video/mp4,video/webm,video/quicktime"
          capture="environment"
          onChange={onPick}
          className="text-[12.5px] text-mute file:mr-3 file:rounded-full file:border file:border-line2 file:bg-transparent file:px-3.5 file:py-2 file:text-[12.5px] file:font-bold file:text-ink"
        />
      </div>

      {pickError && (
        <p role="status" className="mt-2.5 rounded-xl border border-coral/30 bg-coral/10 px-3.5 py-2.5 text-[13px] text-mute">
          {pickError}
        </p>
      )}

      {items.length > 0 && (
        <ul className="mt-3.5 grid gap-2">
          {items.map((it) => (
            <li
              key={it.id}
              className="flex flex-wrap items-center gap-2.5 rounded-xl border border-line2 bg-panel2 px-3.5 py-2.5 text-[12.5px]"
            >
              <span className="font-bold text-ink">{it.label}</span>
              <span className="text-dim">Stage {it.stage} · {mb(it.bytes)}</span>
              <span
                className={
                  "ml-auto rounded-full border px-2.5 py-1 text-[10.5px] font-bold " +
                  (it.status === "failed"
                    ? "border-coral/40 text-coral"
                    : it.status === "uploading"
                      ? "border-teal/40 text-tealb"
                      : "border-line text-dim")
                }
              >
                {STATUS_LABEL[it.status]}
              </span>
              {it.status === "failed" && (
                <>
                  <span className="w-full text-[12px] leading-relaxed text-dim">{it.error}</span>
                  <button
                    onClick={async () => {
                      await updateQueueItem(it.id, { attempts: 0, error: null });
                      await refresh();
                      runQueue();
                    }}
                    className="rounded-full border border-line2 px-3 py-1.5 text-[11.5px] font-bold text-ink"
                  >
                    Try again
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
