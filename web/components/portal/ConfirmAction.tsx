"use client";

import { useState } from "react";

/**
 * A hold point in front of an action that cannot be undone.
 *
 * The button that runs first is ordinary. Tapping it does nothing to the
 * job; it only opens a second, distinctly coloured step that says in plain
 * English what is about to happen and cannot say "nothing changed yet"
 * without also saying "and here is what changes if you go on". Nothing
 * submits until that second, differently styled button is tapped.
 *
 * This wraps the same server action the plain button used to call directly.
 * It does not change what that action does, what it is allowed to do, or who
 * is allowed to call it: it only puts a stop between the tap and the call.
 */
export function ConfirmAction({
  action,
  hidden,
  label,
  confirmLabel,
  explain,
  idleClassName,
}: {
  action: (formData: FormData) => Promise<void>;
  /** hidden form fields the server action needs, e.g. { jobId, quoteId } */
  hidden: Record<string, string>;
  /** the first, ordinary button */
  label: string;
  /** the second button, inside the warning box, that actually submits */
  confirmLabel: string;
  /** what this is about to do, in the reader's terms, said before they can confirm it */
  explain: string;
  /** classes for the first button; defaults to the room's usual pill */
  idleClassName?: string;
}) {
  const [state, setState] = useState<"idle" | "confirming" | "busy" | "error">("idle");
  const [msg, setMsg] = useState("");

  if (state === "idle" || state === "error") {
    return (
      <div>
        <button
          type="button"
          onClick={() => setState("confirming")}
          className={
            idleClassName ??
            "rounded-full bg-linear-to-r from-teal to-mango px-4 py-2 text-[13px] font-bold text-onbrand transition hover:brightness-110"
          }
        >
          {label}
        </button>
        {state === "error" && (
          <p role="alert" className="mt-2 max-w-[46ch] text-[12.5px] leading-relaxed text-coral">
            {msg}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="mt-1 max-w-[52ch] rounded-xl border border-coral/40 bg-coral/[.07] p-3.5">
      <p className="text-[12.5px] font-bold uppercase tracking-[.14em] text-coral">
        This cannot be undone
      </p>
      <p className="mt-1.5 text-[13px] leading-relaxed text-ink">{explain}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2.5">
        <form
          action={async (fd) => {
            setState("busy");
            try {
              await action(fd);
              setState("idle");
            } catch (e) {
              setState("error");
              setMsg(e instanceof Error ? e.message : "That did not go through.");
            }
          }}
        >
          {Object.entries(hidden).map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
          <button
            disabled={state === "busy"}
            className="rounded-full border border-coral bg-coral/15 px-4.5 py-2.5 text-[13px] font-bold text-coral transition hover:bg-coral/25 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {state === "busy" ? "Working…" : confirmLabel}
          </button>
        </form>
        <button
          type="button"
          disabled={state === "busy"}
          onClick={() => setState("idle")}
          className="rounded-full border border-line2 px-3.5 py-2 text-[12.5px] text-mute transition hover:border-line disabled:opacity-40"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
