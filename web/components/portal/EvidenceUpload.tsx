"use client";

import { useState } from "react";
import { uploadEvidence } from "@/app/portal/evidence-actions";

export function EvidenceUpload({ jobId, maxStage }: { jobId: string; maxStage: number }) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [msg, setMsg] = useState("");
  return (
    <form
      action={async (fd) => {
        setState("busy");
        try {
          await uploadEvidence(fd);
          setState("done");
          setMsg("Filed, timestamped and fingerprinted. It cannot be edited now.");
        } catch (e) {
          setState("error");
          setMsg(e instanceof Error && /large|image/.test(e.message) ? e.message : "The database refused this upload.");
        }
      }}
      className="mt-4 rounded-2xl border border-line bg-panel p-4"
    >
      <p className="text-[10.5px] font-bold uppercase tracking-[.2em] text-tealb">File evidence</p>
      <p className="mt-1 text-[12px] leading-relaxed text-dim">
        Photograph it before it is covered over. Uploads are timestamped and
        fingerprinted on arrival, and nothing here can be edited after.
      </p>
      <input type="hidden" name="jobId" value={jobId} />
      <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_120px_auto]">
        <input name="label" required maxLength={140} placeholder='What this shows, e.g. "The joint before work"'
          className="rounded-xl border border-line bg-bg px-3.5 py-2.5 text-[13.5px] text-ink outline-none focus:border-teal" />
        <select name="stage" className="rounded-xl border border-line bg-bg px-3 py-2.5 text-[13px] text-ink outline-none focus:border-teal">
          {Array.from({ length: Math.max(1, maxStage) }, (_, i) => (
            <option key={i} value={i + 1}>Stage {i + 1}</option>
          ))}
        </select>
        <input type="file" name="photo" accept="image/*"
          className="text-[12.5px] text-mute file:mr-3 file:rounded-full file:border file:border-line2 file:bg-transparent file:px-3.5 file:py-2 file:text-[12.5px] file:font-bold file:text-ink" />
      </div>
      {state !== "idle" && state !== "busy" && (
        <p role="status" className={"mt-2.5 rounded-xl px-3.5 py-2.5 text-[13px] " + (state === "done" ? "border border-softline bg-soft text-mute" : "border border-coral/30 bg-coral/10 text-mute")}>
          {msg}
        </p>
      )}
      <button disabled={state === "busy"} className="mt-3 rounded-full bg-linear-to-r from-teal to-mango px-4.5 py-2.5 text-[13.5px] font-bold text-[#04211D] transition hover:brightness-110 disabled:opacity-40">
        {state === "busy" ? "Filing..." : "File this evidence"}
      </button>
    </form>
  );
}
