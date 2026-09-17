import type { StatusTone } from "./statusTone";

/**
 * What is left of the dashboard tops of 13 Sep 2026: the StatCard shape and
 * the held and released bar. The figure cards and the pill strip that lived
 * here were replaced on 17 Sep 2026 by the stage board (StageBoard.tsx) and
 * the right-hand panels (PortalRail.tsx), which draw the same figures.
 *
 * Every number here is derived from rows the page already renders; nothing
 * is fetched or computed that the old page did not have.
 *
 * Nothing here says money has moved. The held and released figures are the
 * same estimate WorkerMoneyPanel has always shown, and the wording around
 * them is unchanged (CLAUDE.md section 9).
 */

export type StatCard = {
  label: string;
  value: string;
  note?: string;
  tone: StatusTone;
  icon: "held" | "released" | "live" | "done" | "todo" | "service";
};

/**
 * Held against released, as one bar. Two figures side by side ask the reader
 * to do the sum; a bar shows the share. The share is the only thing added,
 * and it is arithmetic on two numbers already on the screen.
 */
export function MoneySplit({
  held,
  released,
  heldLabel,
  releasedLabel,
}: {
  held: number;
  released: number;
  heldLabel: string;
  releasedLabel: string;
}) {
  const total = held + released;
  if (total <= 0) return null;
  const heldPct = Math.round((held / total) * 100);
  const releasedPct = 100 - heldPct;
  return (
    <div className="mt-3 rounded-2xl border border-line bg-panel px-4 py-3.5">
      <div className="flex items-center justify-between gap-3 text-[11px] font-bold">
        <span className="flex items-center gap-1.5 text-goldb">
          <span className="size-2 rounded-full bg-gold" aria-hidden />
          {heldLabel} · {heldPct}%
        </span>
        <span className="flex items-center gap-1.5 text-green">
          {releasedLabel} · {releasedPct}%
          <span className="size-2 rounded-full bg-green" aria-hidden />
        </span>
      </div>
      <div
        className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-panel2"
        role="img"
        aria-label={`${heldPct}% of your money is due on sign-off, ${releasedPct}% signed off`}
      >
        <span className="bg-gold" style={{ width: heldPct + "%" }} />
        <span className="bg-green" style={{ width: releasedPct + "%" }} />
      </div>
    </div>
  );
}
