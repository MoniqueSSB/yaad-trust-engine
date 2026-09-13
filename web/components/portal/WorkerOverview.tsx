import { STATUS_DOT, type StatusLabel, type StatusTone } from "./statusTone";
import type { Job } from "./JobList";

/**
 * The top of the worker dashboard, 13 Sep 2026.
 *
 * Three small pieces that turn the page from a stack of lists into something
 * a tradesperson can read at a glance on a phone between jobs: a row of
 * figures, a bar showing how much of their money is still waiting on
 * sign-off, and a strip showing where their live jobs sit. Every number here
 * is derived from the same rows the lists below already render; nothing is
 * fetched or computed that the old page did not have. That is the point:
 * same information, laid out so the shape of it is visible.
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
  icon: "held" | "released" | "live" | "done";
};

const CARD_ACCENT: Record<StatusTone, string> = {
  waiting: "border-gold/40 bg-gold/[0.06] text-goldb",
  moving: "border-softline bg-soft text-purpleb",
  done: "border-green/30 bg-green/[0.05] text-green",
  idle: "border-line bg-panel text-mute",
};

const ICON_BG: Record<StatusTone, string> = {
  waiting: "bg-gold/15 text-goldb",
  moving: "bg-purple/15 text-purpleb",
  done: "bg-green/15 text-green",
  idle: "bg-panel2 text-mute",
};

function Icon({ kind }: { kind: StatCard["icon"] }) {
  const common = "size-[18px] fill-none stroke-current stroke-[1.8]";
  switch (kind) {
    case "held":
      // a padlock: the figure is waiting on a sign-off
      return (
        <svg viewBox="0 0 24 24" className={common} strokeLinecap="round" strokeLinejoin="round">
          <rect x="5" y="11" width="14" height="10" rx="2" />
          <path d="M8 11V7a4 4 0 0 1 8 0v4" />
        </svg>
      );
    case "released":
      // a tick in a circle: cleared to be paid
      return (
        <svg viewBox="0 0 24 24" className={common} strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9" />
          <path d="m8.5 12.5 2.5 2.5 5-5" />
        </svg>
      );
    case "live":
      // a hammer: work on the go
      return (
        <svg viewBox="0 0 24 24" className={common} strokeLinecap="round" strokeLinejoin="round">
          <path d="m14 6 4 4-9 9-4-4z" />
          <path d="m12 8 4-4 4 4-4 4" />
        </svg>
      );
    case "done":
      // a flag: over the line
      return (
        <svg viewBox="0 0 24 24" className={common} strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 21V4" />
          <path d="M5 4h12l-2 4 2 4H5" />
        </svg>
      );
  }
}

export function WorkerStatCards({ cards }: { cards: StatCard[] }) {
  if (cards.length === 0) return null;
  return (
    <div className="mt-6 grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
      {cards.map((c) => (
        <div
          key={c.label}
          className={"rounded-2xl border px-3.5 py-3.5 sm:px-4 sm:py-4 " + CARD_ACCENT[c.tone]}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="text-[10px] font-bold uppercase tracking-[.16em] text-dim">
              {c.label}
            </div>
            <span
              className={
                "grid size-8 shrink-0 place-items-center rounded-full " + ICON_BG[c.tone]
              }
              aria-hidden
            >
              <Icon kind={c.icon} />
            </span>
          </div>
          <div className="mt-2 font-display text-[21px] leading-none sm:text-[28px]">{c.value}</div>
          {c.note && (
            <div className="mt-2 text-[11.5px] leading-snug text-dim">{c.note}</div>
          )}
        </div>
      ))}
    </div>
  );
}

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
        aria-label={`${heldPct}% of your money is held, ${releasedPct}% released`}
      >
        <span className="bg-gold" style={{ width: heldPct + "%" }} />
        <span className="bg-green" style={{ width: releasedPct + "%" }} />
      </div>
    </div>
  );
}

/**
 * Where the live jobs sit, as a strip of counts in the order a job moves.
 *
 * Built from the same status map the list uses, so a status the map has not
 * heard of still shows, with its raw value, rather than vanishing. Two raw
 * statuses that share one wording ("open" and "open_for_quotes") share one
 * count, because the worker is reading the words, not the enum. Coloured steps
 * with no jobs stay visible and dimmed so the ladder itself is readable.
 */
export function WorkerPipeline({
  jobs,
  labels,
}: {
  jobs: Job[];
  labels: Record<string, StatusLabel>;
}) {
  const steps: { key: string; label: string; tone: StatusTone; count: number }[] = [];
  const byLabel = new Map<string, number>();
  for (const [status, s] of Object.entries(labels)) {
    if (status === "complete") continue;
    if (byLabel.has(s.label)) continue;
    byLabel.set(s.label, steps.length);
    steps.push({ key: status, label: s.label, tone: s.tone, count: 0 });
  }
  for (const j of jobs) {
    const s = labels[j.status];
    const label = s?.label ?? j.status;
    let idx = byLabel.get(label);
    if (idx == null) {
      idx = steps.length;
      byLabel.set(label, idx);
      steps.push({ key: j.status, label, tone: s?.tone ?? "idle", count: 0 });
    }
    steps[idx].count += 1;
  }
  if (jobs.length === 0) return null;
  /* Grey steps (not live yet, client still setting up) only show when a job
     is actually sitting in one. Empty, they are before the ladder starts and
     only add noise; the coloured steps stay visible even at zero so the order
     a job moves in can still be read. */
  const shown = steps.filter((s) => s.count > 0 || s.tone !== "idle");
  return (
    <div className="mt-8">
      <h2 className="mb-3 text-[10.5px] font-bold uppercase tracking-[.2em] text-tealb">
        Where your live jobs are
      </h2>
      <ol className="flex flex-wrap gap-2">
        {shown.map((s) => (
          <li
            key={s.key}
            className={
              "flex items-center gap-2 rounded-full border px-3 py-1.5 text-[12px] " +
              (s.count > 0
                ? "border-line2 bg-panel text-ink"
                : "border-line bg-transparent text-dim opacity-60")
            }
          >
            <span className={"size-2 rounded-full " + STATUS_DOT[s.tone]} aria-hidden />
            <span>{s.label}</span>
            <b
              className={
                "min-w-[22px] rounded-full px-1.5 py-0.5 text-center text-[11px] " +
                (s.count > 0 ? "bg-panel2 text-ink" : "text-dim")
              }
            >
              {s.count}
            </b>
          </li>
        ))}
      </ol>
    </div>
  );
}
