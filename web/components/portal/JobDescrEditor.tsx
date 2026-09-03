"use client";

import { useState } from "react";
import { editJobDescr } from "@/app/portal/job-descr-actions";

/**
 * The job description, and the way to change it.
 *
 * This exists because a client's own board preview showed "Fix the rood" and
 * there was nowhere on the page to fix it. The description is the one thing a
 * tradesperson reads before deciding whether to quote, so the person who
 * wrote it should be able to correct it without messaging the desk.
 *
 * Only the client sees this, and only until a worker is booked: after that
 * the description is the scope both sides agreed, and a change is a variation
 * for the desk to record. Postgres refuses it after that point too; this
 * component is not what stops anybody.
 *
 * It sits above the board preview on purpose. Edit here, see below exactly
 * what a worker will read.
 */
export function JobDescrEditor({
  jobId,
  descr,
  quotesIn,
  embedded = false,
  onClose,
}: {
  jobId: string;
  descr: string;
  quotesIn: number;
  /** Inside the board preview (JobEditTools): no heading, no read-only view,
   *  the form is open from the start and Cancel or Save hands back to the
   *  caller. The full section is kept for anywhere that still wants it. */
  embedded?: boolean;
  onClose?: () => void;
}) {
  const [open, setOpen] = useState(embedded);
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [msg, setMsg] = useState("");

  return (
    <section
      id="description"
      className={embedded ? "mt-3 rounded-xl border border-line bg-bg/40 p-3" : "mt-4 rounded-2xl border border-line bg-panel p-4"}
    >
      {!embedded && (
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[10.5px] font-bold uppercase tracking-[.2em] text-tealb">
            The description
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-dim">
            What a tradesperson reads before deciding whether to quote, in your
            words. Spotted a mistake, or left something out? Change it here.
          </p>
        </div>
        {!open && (
          <button
            type="button"
            onClick={() => {
              setOpen(true);
              setState("idle");
            }}
            className="rounded-full border border-line2 px-4 py-2 text-[12.5px] font-bold text-ink transition hover:border-teal"
          >
            Edit the description
          </button>
        )}
      </div>
      )}

      {!open && !embedded && (
        <p className="mt-3 whitespace-pre-wrap text-[13.5px] leading-relaxed text-mute">
          {descr || "No description yet."}
        </p>
      )}

      {!open && !embedded && state === "done" && (
        <p role="status" className="mt-2.5 rounded-xl border border-softline bg-soft px-3.5 py-2.5 text-[13px] text-mute">
          {msg}
        </p>
      )}

      {open && (
        <form
          action={async (fd) => {
            setState("busy");
            try {
              await editJobDescr(fd);
              setState("done");
              setMsg("Saved. The preview below shows it exactly as a worker will read it.");
              setOpen(false);
              onClose?.();
            } catch (e) {
              setState("error");
              setMsg(e instanceof Error ? e.message : "That did not go through.");
            }
          }}
        >
          <input type="hidden" name="jobId" value={jobId} />
          <textarea
            name="descr"
            defaultValue={descr}
            rows={7}
            maxLength={4000}
            required
            className="mt-1 w-full resize-y rounded-xl border border-line bg-bg px-3.5 py-2.5 text-[13.5px] leading-relaxed text-ink outline-none focus:border-teal"
          />
          <p className="mt-2 text-[12px] leading-relaxed text-dim">
            Your address and your phone number stay off the public board however
            you write this: the board strips them before a worker reads it.
            {quotesIn > 0 &&
              ` The ${quotesIn === 1 ? "quote already in was" : quotesIn + " quotes already in were"} priced against the old wording, so if this is a big change, tell Yaadly.`}
          </p>
          {state === "error" && (
            <p role="status" className="mt-2.5 rounded-xl border border-coral/30 bg-coral/10 px-3.5 py-2.5 text-[13px] text-mute">
              {msg}
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2.5">
            <button
              disabled={state === "busy"}
              className="rounded-full bg-linear-to-r from-teal to-mango px-4.5 py-2.5 text-[13.5px] font-bold text-onbrand transition hover:brightness-110 disabled:opacity-40"
            >
              {state === "busy" ? "Saving..." : "Save the description"}
            </button>
            <button
              type="button"
              disabled={state === "busy"}
              onClick={() => {
                setOpen(false);
                setState("idle");
                onClose?.();
              }}
              className="rounded-full border border-line2 px-4 py-2.5 text-[13px] font-bold text-mute transition hover:text-ink disabled:opacity-40"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
