"use client";

import { useState } from "react";
import { markMaterialSupplied } from "@/app/portal/materials-actions";

/**
 * Route B, the client's side. The worker's list of what the job needs, and a
 * tick against each line as it lands on site.
 *
 * WHY THIS SCREEN EXISTS. Telling a client they are supplying the materials
 * and giving them no list is how a tradesperson ends up travelling to Portmore
 * to a site with no blocks on it. The list is the order; this is where it gets
 * filled. An outstanding line is the reason a start date moves, and it is
 * visible to both sides so it is never an argument about who was late.
 *
 * The worker sees the same rows and cannot edit them once the quote is
 * accepted, so what the client is shopping from is exactly what was quoted.
 */

export type MaterialLine = {
  id: string;
  item: string;
  qty: number | null;
  unit: string | null;
  supplied_at: string | null;
};

export function MaterialsOrder({
  jobId,
  lines,
  canTick,
}: {
  jobId: string;
  lines: MaterialLine[];
  /** Only the client fills the order. The worker reads it. */
  canTick: boolean;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!lines.length) return null;

  const done = lines.filter((l) => l.supplied_at).length;
  const outstanding = lines.length - done;

  return (
    <div className="rounded-2xl border border-line bg-panel p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[10.5px] font-bold uppercase tracking-[.18em] text-tealb">
          What this job needs
        </p>
        <p className="font-mono text-[11.5px] tabular-nums text-dim">
          {done} of {lines.length} on site
        </p>
      </div>

      <p className="mt-1.5 text-[12.5px] leading-relaxed text-dim">
        {canTick
          ? "You are buying these. Tick each one as it arrives so the tradesperson knows the site is ready for him."
          : "The client is buying these. A line without a tick is not on site yet."}
      </p>

      <ul className="mt-3 grid gap-2">
        {lines.map((l) => {
          const on = !!l.supplied_at;
          return (
            <li
              key={l.id}
              className={
                "flex items-center gap-3 rounded-xl border px-3.5 py-3 transition " +
                (on ? "border-teal/40 bg-soft" : "border-line bg-bg")
              }
            >
              <form
                action={async (fd) => {
                  setBusy(l.id);
                  setError(null);
                  try {
                    await markMaterialSupplied(fd);
                  } catch (e) {
                    setError(e instanceof Error ? e.message : "That did not save.");
                  }
                  setBusy(null);
                }}
              >
                <input type="hidden" name="lineId" value={l.id} />
                <input type="hidden" name="jobId" value={jobId} />
                <input type="hidden" name="on" value={on ? "false" : "true"} />
                <button
                  type="submit"
                  disabled={!canTick || busy === l.id}
                  aria-pressed={on}
                  aria-label={on ? `Mark ${l.item} as not yet on site` : `Mark ${l.item} as on site`}
                  className={
                    "grid size-7 place-items-center rounded-full border text-[13px] transition disabled:opacity-40 " +
                    (on
                      ? "border-teal bg-teal/20 text-tealb"
                      : "border-line2 text-dim hover:border-teal")
                  }
                >
                  {busy === l.id ? "..." : on ? "✓" : ""}
                </button>
              </form>

              <span className="min-w-0 flex-1">
                <b
                  className={
                    "block text-[13.5px] font-semibold " +
                    (on ? "text-tealb line-through decoration-teal/40" : "text-ink")
                  }
                >
                  {l.item}
                </b>
                {(l.qty != null || l.unit) && (
                  <span className="mt-0.5 block font-mono text-[11.5px] tabular-nums text-dim">
                    {l.qty != null ? l.qty : ""} {l.unit ?? ""}
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ul>

      {outstanding > 0 && (
        <p className="mt-3 text-[12.5px] leading-relaxed text-mango">
          {outstanding} {outstanding === 1 ? "line is" : "lines are"} not on site yet.
          The tradesperson is not held to a start date while the materials he
          needs are outstanding.
        </p>
      )}

      {error && (
        <p role="alert" className="mt-3 rounded-xl border border-coral/30 bg-coral/10 px-3.5 py-2.5 text-[12.5px] text-mute">
          {error}
        </p>
      )}
    </div>
  );
}
