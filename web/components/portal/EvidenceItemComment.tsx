"use client";

import { useState } from "react";
import { commentOnEvidence } from "@/app/portal/job-actions";

/**
 * A client's comment on one specific photo, not the whole stage
 * (DECISIONS.md, "The client-worker feedback loop, both directions").
 * The schema, the RLS policy and the notify-worker trigger have all been
 * live since that entry; this is the missing button.
 *
 * Write-only on purpose, matching the WhatsApp side of the same loop: a
 * client's WhatsApp comment isn't shown back to them in the portal either,
 * today. Adding a persisted thread view here would be a bigger, separate
 * piece of work than "let a client comment on one photo," and nothing
 * asked for it yet.
 */
export function EvidenceItemComment({ jobId, evidenceId }: { jobId: string; evidenceId: string }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "sent" | "error">("idle");
  const [msg, setMsg] = useState("");

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-1.5 text-[11.5px] font-bold text-tealb underline-offset-2 hover:underline"
      >
        Comment on this photo
      </button>
    );
  }

  if (state === "sent") {
    return <p className="mt-1.5 text-[11.5px] text-dim">Sent to the worker.</p>;
  }

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!text.trim() || state === "busy") return;
        setState("busy");
        setMsg("");
        try {
          const { hits } = await commentOnEvidence(jobId, evidenceId, text);
          if (hits.length) {
            setMsg(`Held back: ${hits.join(", ")}. Say it without that and it will send.`);
            setState("error");
          } else {
            setState("sent");
          }
        } catch (err) {
          setState("error");
          setMsg(err instanceof Error ? err.message : "That did not go through.");
        }
      }}
      className="mt-1.5 flex flex-col gap-1.5"
    >
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={1000}
        rows={2}
        autoFocus
        placeholder="What should the worker know about this one?"
        className="w-full rounded-lg border border-line2 bg-bg px-2.5 py-1.5 text-[12.5px] text-ink outline-none focus:border-teal"
      />
      <div className="flex items-center gap-2.5">
        <button
          disabled={state === "busy"}
          className="rounded-full bg-panel2 px-3 py-1 text-[11.5px] font-bold text-ink disabled:opacity-40"
        >
          {state === "busy" ? "Sending…" : "Send to worker"}
        </button>
        <button
          type="button"
          onClick={() => { setOpen(false); setText(""); setState("idle"); setMsg(""); }}
          className="text-[11.5px] text-dim hover:text-ink"
        >
          Cancel
        </button>
      </div>
      {state === "error" && (
        <p role="alert" className="text-[11.5px] leading-relaxed text-coral">{msg}</p>
      )}
    </form>
  );
}
