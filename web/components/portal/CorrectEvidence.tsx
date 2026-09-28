"use client";

import { useState, useTransition } from "react";
import { correctEvidence } from "@/app/portal/evidence-correct-actions";
import { EVIDENCE_PHASES, PHASE_OPTION } from "@/lib/portal/evidence-sections";

/**
 * "Correct this", on the worker's own evidence, while its stage is still being
 * worked (28 Sep 2026). The words and the part of the job can change; the
 * photograph and its fingerprint cannot. The card says "Corrected" afterwards
 * and the stage record keeps the original wording, so a client never reads an
 * edit as if it were what was first sent.
 */
export function CorrectEvidence({
  id,
  jobId,
  label,
  phase,
  kind,
}: {
  id: string;
  jobId: string;
  label: string | null;
  phase: string | null | undefined;
  kind: string | null | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(label ?? "");
  const [part, setPart] = useState(phase ?? "");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const materials = kind === "materials";

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => { setOpen(true); setMsg(null); }}
        className="mt-2 text-[11.5px] font-bold text-tealb underline-offset-2 hover:underline"
      >
        Correct this
      </button>
    );
  }

  return (
    <form
      className="mt-2 grid gap-2 rounded-lg border border-line bg-bg p-2.5"
      onSubmit={(ev) => {
        ev.preventDefault();
        const fd = new FormData();
        fd.set("id", id);
        fd.set("jobId", jobId);
        fd.set("label", text);
        fd.set("phase", materials ? "" : part);
        start(async () => {
          const r = await correctEvidence(fd);
          if (!r.ok) setMsg(r.message);
          else if (!r.changed) setMsg("Nothing changed.");
          else { setMsg(null); setOpen(false); }
        });
      }}
    >
      <label className="text-[10.5px] font-bold uppercase tracking-[.12em] text-dim" htmlFor={"ce-" + id}>
        What this shows
      </label>
      <input
        id={"ce-" + id}
        value={text}
        maxLength={300}
        onChange={(e) => setText(e.target.value)}
        className="w-full rounded-lg border border-line bg-panel px-2.5 py-2 text-[12.5px] text-ink outline-none focus:border-teal"
      />
      {!materials && (
        <select
          value={part}
          onChange={(e) => setPart(e.target.value)}
          aria-label="Which part of the job"
          className="w-full rounded-lg border border-line bg-panel px-2.5 py-2 text-[12.5px] text-ink outline-none focus:border-teal"
        >
          <option value="">Not marked</option>
          {EVIDENCE_PHASES.map((p) => (
            <option key={p} value={p}>{PHASE_OPTION[p]}</option>
          ))}
        </select>
      )}
      <p className="text-[11px] leading-snug text-dim">
        The photo and its fingerprint stay as filed. The client sees that you
        corrected it, and the original wording stays on the record.
      </p>
      {msg && <p role="alert" className="text-[11.5px] text-coral">{msg}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-full bg-linear-to-r from-teal to-mango px-3.5 py-1.5 text-[12px] font-bold text-onbrand disabled:opacity-50"
        >
          {pending ? "Saving..." : "Save the correction"}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => { setOpen(false); setText(label ?? ""); setPart(phase ?? ""); setMsg(null); }}
          className="rounded-full border border-line2 px-3.5 py-1.5 text-[12px] font-bold text-mute"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
