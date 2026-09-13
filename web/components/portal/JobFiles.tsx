"use client";

import { useState } from "react";
import { addJobFile, removeJobFile } from "@/app/portal/job-file-actions";
import {
  FILE_KINDS,
  acceptAttr,
  canAddFile,
  canRemoveFile,
  fileKindLabel,
  humanBytes,
} from "@/lib/portal/job-files";

/**
 * Files on the job, both sides. Receipts, quotes on letterhead, permits,
 * plans, certificates, a picture that is not evidence of a stage. Either
 * party adds, both read, the uploader can take their own back until the job
 * is complete. 20260910120000.
 *
 * Deliberately not the evidence upload, which sits on the Progress evidence
 * tab and changes the job's status. A permit is not proof of work, and this
 * card never touches approval, money or the independent check.
 *
 * Links are short-lived signed URLs minted by the page as it renders; a file
 * here is private to the two people on the job and the desk.
 */

export type JobFile = {
  id: string;
  side: string;
  uploaded_by: string;
  kind: string;
  label: string;
  mime: string;
  bytes: number;
  created_at: string;
  url: string | null;
};

export function JobFiles({
  jobId,
  role,
  viewerEmail,
  jobStatus,
  files,
}: {
  jobId: string;
  role: "client" | "worker";
  viewerEmail: string;
  jobStatus: string | null;
  files: JobFile[];
}) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [msg, setMsg] = useState("");
  const open = canAddFile(jobStatus);

  return (
    <section id="files" className="mt-8">
      <h2 className="mb-2 text-[10.5px] font-bold uppercase tracking-[.2em] text-tealb">Files on this job</h2>
      <p className="mb-3 max-w-[64ch] text-[12.5px] leading-relaxed text-dim">
        {role === "client"
          ? "Anything on paper that belongs with this job: a quote you were given, a permit, a plan, a warranty, a receipt. The worker on the job and Yaadly can see what you add here, and you can see what they add. Photos of the work itself go on the Progress evidence tab."
          : "Anything on paper that belongs with this job: a supplier receipt, a quote, a permit, a certificate, a plan. The client and Yaadly can see what you add here, and you can see what they add. Photos of the work itself go on the Progress evidence tab, because those are what you get paid on."}
      </p>

      {files.length > 0 && (
        <ul className="grid gap-2">
          {files.map((f) => {
            const mine = canRemoveFile({ uploadedBy: f.uploaded_by, viewerEmail, jobStatus });
            const who = f.side === role ? "you" : f.side === "client" ? "the client" : "the worker";
            const when = new Date(f.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
            return (
              <li key={f.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-line bg-panel px-4 py-3">
                <span className="rounded-full border border-softline bg-soft px-2.5 py-1 text-[10.5px] font-bold text-tealb">
                  {fileKindLabel(f.kind)}
                </span>
                {f.url ? (
                  <a href={f.url} target="_blank" rel="noopener noreferrer" className="text-[13.5px] font-bold text-ink underline-offset-2 hover:underline">
                    {f.label || fileKindLabel(f.kind)} &rarr;
                  </a>
                ) : (
                  <b className="text-[13.5px] text-ink">{f.label || fileKindLabel(f.kind)}</b>
                )}
                <span className="text-[12px] text-dim">
                  {humanBytes(f.bytes)} · sent by {who}, {when}
                </span>
                {mine && (
                  <form
                    className="ml-auto"
                    action={async (fd) => {
                      setState("busy");
                      try {
                        await removeJobFile(fd);
                        setState("done");
                        setMsg("Removed.");
                      } catch (e) {
                        setState("error");
                        setMsg(e instanceof Error ? e.message : "That did not go through.");
                      }
                    }}
                  >
                    <input type="hidden" name="jobId" value={jobId} />
                    <input type="hidden" name="fileId" value={f.id} />
                    <button className="text-[11.5px] text-dim underline-offset-2 hover:underline hover:text-coral">Remove</button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {files.length === 0 && (
        <p className="rounded-2xl border border-dashed border-line2 bg-bg/30 px-5 py-5 text-center text-[12.5px] text-dim">
          Nothing attached yet.
        </p>
      )}

      {open ? (
        <form
          className="mt-3 rounded-2xl border border-line bg-panel p-4"
          action={async (fd) => {
            setState("busy");
            try {
              await addJobFile(fd);
              setState("done");
              setMsg("Sent. Only you, the other side of this job and Yaadly can see it.");
            } catch (e) {
              setState("error");
              setMsg(e instanceof Error ? e.message : "That did not go through.");
            }
          }}
        >
          <input type="hidden" name="jobId" value={jobId} />
          <div className="grid gap-3 sm:grid-cols-[170px_1fr]">
            <select name="kind" defaultValue="other" className="rounded-xl border border-line bg-bg px-3 py-2.5 text-[13px] text-ink outline-none focus:border-teal">
              {FILE_KINDS.map(([k, label]) => (
                <option key={k} value={k}>{label}</option>
              ))}
            </select>
            <input
              name="label"
              maxLength={140}
              placeholder='What it is, e.g. "Hardware & Lumber receipt, cement and steel"'
              className="rounded-xl border border-line bg-bg px-3.5 py-2.5 text-[13.5px] text-ink outline-none focus:border-teal"
            />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <input
              type="file"
              name="file"
              required
              accept={acceptAttr()}
              className="text-[12.5px] text-mute file:mr-3 file:rounded-full file:border file:border-line2 file:bg-transparent file:px-3.5 file:py-2 file:text-[12.5px] file:font-bold file:text-ink"
            />
            <button
              disabled={state === "busy"}
              className="rounded-full bg-linear-to-r from-teal to-mango px-4 py-2.5 text-[13px] font-bold text-onbrand disabled:opacity-60"
            >
              {state === "busy" ? "Sending" : "Add to the job"}
            </button>
          </div>
          <p className="mt-2 text-[11.5px] text-dim">PDF, JPEG, PNG, WebP or Word, up to 25MB. You can take your own file back until the job is complete.</p>
          {state !== "idle" && state !== "busy" && (
            <p
              role="status"
              className={
                "mt-2.5 rounded-xl px-3.5 py-2.5 text-[13px] " +
                (state === "done" ? "border border-softline bg-soft text-mute" : "border border-coral/30 bg-coral/10 text-mute")
              }
            >
              {msg}
            </p>
          )}
        </form>
      ) : (
        <p className="mt-3 text-[12px] text-dim">This job is closed, so its files are fixed as they are.</p>
      )}
    </section>
  );
}
