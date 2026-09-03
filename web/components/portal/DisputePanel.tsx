"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { raiseDispute, moveDispute } from "@/app/portal/job-actions";

/**
 * The dispute machine, PORTAL-SPEC 5.6: none, form, direct, resolved or
 * escalated. The worker is the first point of contact and sees it the
 * moment it is raised. Nothing releases while one is open.
 */
const KINDS = [
  "Not what we agreed in the Works Agreement",
  "Incomplete, something in the stage is missing",
  "Quality is not acceptable",
  "The evidence does not match the work",
  "Something was damaged",
];

type Dispute = { id: string; state: string; body: string; reply: string | null; kinds: string[] };

export function DisputePanel({
  jobId, role, dispute, workerName,
}: {
  jobId: string;
  role: "client" | "worker";
  dispute: Dispute | null;
  workerName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [body, setBody] = useState("");
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);

  const box = "mt-6 rounded-2xl border border-coral/30 bg-coral/5 p-4";

  if (!dispute) {
    if (role === "worker")
      return (
        <div className="mt-6 rounded-2xl border border-line bg-panel p-4 text-[13px] leading-relaxed text-mute">
          <b className="text-mute">If they raise something, you hear it first.</b>{" "}
          Not Yaadly, and not a review: them, straight to you, with 48 hours
          to answer or put it right. Your money is not taken away and not
          handed over either; it sits still until it is sorted.
        </div>
      );
    if (!open)
      return (
        <div className={box}>
          <b className="text-[14px] text-coral">Not right? Raise it with {workerName} first.</b>
          <p className="mt-1.5 text-[13px] leading-relaxed text-mute">
            Approving is a signature, so do not approve something you are not
            happy with. Most things are a missing photo or a misunderstanding
            and get sorted the same day. Your money stays held either way.
          </p>
          <button onClick={() => setOpen(true)} className="mt-3 rounded-full border border-coral/50 px-4 py-2 text-[13px] font-bold text-coral hover:bg-coral/10">
            Something is not right
          </button>
        </div>
      );
    return (
      <div className={box}>
        <b className="text-[14px] text-coral">Tell {workerName} what is wrong</b>
        <div className="mt-2.5 grid gap-1.5">
          {KINDS.map((k) => {
            const on = picked.includes(k);
            return (
              <button key={k} onClick={() => setPicked(on ? picked.filter((x) => x !== k) : [...picked, k])}
                className={"rounded-xl border px-3 py-2 text-left text-[12.5px] " + (on ? "border-coral/50 bg-coral/10 text-ink" : "border-line text-mute hover:border-coral/40")}>
                {on ? "✓ " : ""}{k}
              </button>
            );
          })}
        </div>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} maxLength={2000}
          placeholder="What did you expect, and what did you get instead?"
          className="mt-2.5 w-full rounded-xl border border-line bg-bg px-3.5 py-3 text-[13.5px] text-ink outline-none focus:border-teal" />
        <div className="mt-2.5 flex flex-wrap items-center gap-3">
          <button disabled={busy || body.trim().length < 5}
            onClick={async () => { setBusy(true); try { await raiseDispute(jobId, picked, body); router.refresh(); } catch {} setBusy(false); }}
            className="rounded-full border border-coral/50 px-4 py-2 text-[13px] font-bold text-coral hover:bg-coral/10 disabled:opacity-40">
            Send it to {workerName}
          </button>
          <button onClick={() => setOpen(false)} className="rounded-full border border-line2 px-4 py-2 text-[13px] text-ink">Cancel</button>
          <span className="text-[11.5px] text-dim">Goes to them now. Yaadly is not involved yet.</span>
        </div>
      </div>
    );
  }

  if (dispute.state === "resolved")
    return (
      <div className="mt-6 rounded-2xl border border-tealb/30 bg-tealb/5 p-4 text-[13px] leading-relaxed text-mute">
        <b className="text-tealb">Sorted between you, and nothing on the record as a dispute.</b>{" "}
        It is logged on the job because everything is, but it does not go
        near anybody&apos;s Yaad Score.
      </div>
    );

  if (dispute.state === "escalated")
    return (
      <div className={box}>
        <b className="text-[14px] text-coral">With Yaadly now. Nothing moves.</b>
        <p className="mt-1.5 text-[13px] leading-relaxed text-mute">
          Reviewed against the written scope and the evidence, not against
          who complained loudest. The whole thread, what was raised, what was
          said, and when, goes to the reviewer as it stands. Neither of you
          rewrites it.
        </p>
      </div>
    );

  // direct
  return (
    <div className={box}>
      <b className="text-[14px] text-coral">
        {role === "worker" ? "The client has raised something. You hear it first." : `Raised with ${workerName}. Give them a chance to fix it.`}
      </b>
      <p className="mt-1.5 whitespace-pre-wrap text-[13px] leading-relaxed text-ink">&quot;{dispute.body}&quot;</p>
      {dispute.reply && (
        <p className="mt-2 border-l-2 border-softline pl-3 text-[13px] leading-relaxed text-mute">
          <b className="text-tealb">Reply:</b> {dispute.reply}
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2.5">
        {role === "worker" && !dispute.reply && (
          <>
            <input value={reply} onChange={(e) => setReply(e.target.value)} maxLength={2000}
              placeholder="Answer it, or say how you will put it right"
              className="min-w-[240px] flex-1 rounded-xl border border-line bg-bg px-3 py-2 text-[13px] text-ink outline-none focus:border-teal" />
            <button disabled={busy || reply.trim().length < 2}
              onClick={async () => { setBusy(true); try { await moveDispute(dispute.id, jobId, "reply", reply); router.refresh(); } catch {} setBusy(false); }}
              className="rounded-full bg-linear-to-r from-teal to-mango px-4 py-2 text-[13px] font-bold text-onbrand disabled:opacity-40">
              Reply
            </button>
          </>
        )}
        {role === "client" && (
          <>
            <button disabled={busy}
              onClick={async () => { setBusy(true); try { await moveDispute(dispute.id, jobId, "resolved"); router.refresh(); } catch {} setBusy(false); }}
              className="rounded-full bg-linear-to-r from-teal to-mango px-4 py-2 text-[13px] font-bold text-onbrand disabled:opacity-40">
              That sorts it
            </button>
            <button disabled={busy}
              onClick={async () => { setBusy(true); try { await moveDispute(dispute.id, jobId, "escalated"); router.refresh(); } catch {} setBusy(false); }}
              className="rounded-full border border-coral/50 px-4 py-2 text-[13px] font-bold text-coral hover:bg-coral/10 disabled:opacity-40">
              Escalate to Yaadly
            </button>
          </>
        )}
        <span className="text-[11.5px] text-dim">Nothing releases while this is open.</span>
      </div>
    </div>
  );
}
