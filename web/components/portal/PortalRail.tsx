import Link from "next/link";
import { type Job, type StatusLabel } from "./JobList";
import { STATUS_DOT, type StatusTone } from "./statusTone";
import { MoneySplit, type StatCard } from "./WorkerOverview";
import { LinkWorkerPhone } from "./LinkWorkerPhone";
import type { PayoutReadiness } from "@/lib/portal/payout-status";
import { JOB_STEPS, stepOf } from "@/lib/portal/board";
import { amount } from "@/lib/money";
import type { ToPay } from "@/lib/portal/to-pay";

/**
 * The portals' right-hand panels, 17 Sep 2026, from the Portal Overview
 * design. Beside the stage board on a wide screen, above it on a phone.
 * ClientRail first; WorkerRail, which shares the ring and the tiles, is at
 * the bottom of this file.
 *
 * The client's panel:
 *
 * Three cards, each built only from rows the page already reads:
 *
 *   the ring    one job, chosen by pickFocusJob(): the one waiting on the
 *               client if there is one. The ring is its step on the job
 *               ladder, not a guess at how much of the work is done.
 *   the tiles   the same four counts the page has shown since 13 Sep 2026,
 *               in a 2 by 2 grid that fits the panel.
 *   to pay now  invoices sent to the client and not yet paid (to-pay.ts).
 *
 * What the design had and this does not. "Held for you" and "moves only when
 * you approve": banned wording since 3 Sep 2026, and untrue, because Yaadly
 * holds nobody's money. The next site visit and unread messages card: the
 * visit diary belongs to the worker and there is no unread count anywhere in
 * the schema, so the card would have been invented figures.
 */

const TILE: Record<StatusTone, { box: string; bar: string }> = {
  waiting: { box: "border-gold/30 bg-gold/[0.06]", bar: "bg-gold" },
  moving: { box: "border-line bg-bg/40", bar: "bg-purple" },
  done: { box: "border-green/25 bg-green/[0.05]", bar: "bg-green" },
  idle: { box: "border-line bg-bg/40", bar: "bg-dim" },
};

const RING = 2 * Math.PI * 56;

function FocusRing({ job, labels }: { job: Job; labels: Record<string, StatusLabel> }) {
  const s = labels[job.status] ?? { label: job.status, tone: "idle" as StatusTone };
  const step = stepOf(job.status);
  const waiting = s.tone === "waiting";
  const stroke = waiting ? "stroke-gold" : "stroke-purple";

  return (
    <Link
      href={job.next?.href ?? "/portal/jobs/" + encodeURIComponent(job.id)}
      className={
        "block rounded-2xl border p-4.5 transition " +
        (waiting ? "border-gold/40 bg-gold/[0.05] hover:border-gold/70" : "border-line bg-[rgba(13,13,40,0.5)] hover:border-line2")
      }
    >
      <span className={"block font-mono-app text-[9.5px] font-semibold uppercase tracking-[.16em] " + (waiting ? "text-goldb" : "text-dim")}>
        {waiting ? "Needs you first" : "Your job right now"}
      </span>
      <b className="mt-1 block text-[14px] font-semibold leading-snug">{job.title ?? "Untitled job"}</b>

      {step != null && (
        <div className="relative mx-auto mt-3 mb-1 grid size-[150px] place-items-center">
          <svg viewBox="0 0 140 140" className="absolute inset-0 size-full -rotate-90" aria-hidden>
            <circle cx="70" cy="70" r="56" className="fill-none stroke-[rgba(155,115,245,.12)] stroke-[13]" />
            <circle
              cx="70"
              cy="70"
              r="56"
              className={"fill-none stroke-[13] " + stroke}
              strokeLinecap="round"
              strokeDasharray={RING}
              strokeDashoffset={RING * (1 - step / JOB_STEPS)}
            />
          </svg>
          <span className="text-center" role="img" aria-label={`Step ${step} of ${JOB_STEPS}`}>
            <b className="block font-mono-app text-[24px] font-semibold leading-none">Step {step}</b>
            <span className="text-[11px] text-dim">of {JOB_STEPS}</span>
          </span>
        </div>
      )}

      <p className="mt-2 flex items-center gap-2 text-[12.5px]">
        <span className={"size-2 shrink-0 rounded-full " + STATUS_DOT[s.tone]} aria-hidden />
        <b className={waiting ? "text-goldb" : "text-ink"}>{s.label}</b>
      </p>
      {job.next && (
        <p className={"mt-1.5 text-[12.5px] font-bold " + (waiting ? "text-goldb" : "text-tealb")}>
          {job.next.label} &rarr;
        </p>
      )}
    </Link>
  );
}

function Tiles({ cards, title = "Jobs" }: { cards: StatCard[]; title?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-[rgba(13,13,40,0.5)] px-4.5 py-4">
      <div className="mb-3 font-mono-app text-[9.5px] font-semibold uppercase tracking-[.16em] text-dim">{title}</div>
      <div className="grid grid-cols-2 gap-2">
        {cards.map((c) => (
          <div key={c.label} className={"rounded-xl border px-3 py-2.5 " + TILE[c.tone].box} title={c.note}>
            <div className="font-mono-app text-[9px] font-semibold uppercase tracking-[.12em] text-dim">{c.label}</div>
            <div className="mt-1 flex items-center gap-1.5">
              <i className={"h-[15px] w-[2px] shrink-0 " + TILE[c.tone].bar} aria-hidden />
              {/* A J$ figure is wider than a count, and the tile is a quarter
                  of a 290px panel, so a long value steps down a size rather
                  than breaking onto two lines. */}
              <b className={"min-w-0 font-mono-app font-semibold leading-none " + (c.value.length > 7 ? "text-[13px]" : "text-[18px]")}>
                {c.value}
              </b>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ToPayCard({ pay, href }: { pay: ToPay; href: string | null }) {
  const count = pay.unpaid.length;
  const none = count === 0;
  return (
    <div
      className={
        "rounded-2xl border p-4.5 " +
        (none ? "border-line bg-[rgba(13,13,40,0.5)]" : "border-gold/30 bg-linear-to-br from-gold/[0.09] to-purple/[0.05]")
      }
    >
      <div className={"mb-2.5 font-mono-app text-[9.5px] font-semibold uppercase tracking-[.16em] " + (none ? "text-dim" : "text-goldb")}>
        To pay now
      </div>

      {none ? (
        <p className="font-display text-[20px] leading-tight">Nothing to pay</p>
      ) : (
        <div className="grid gap-1">
          {pay.totals.map((t) => (
            <b key={t.currency} className="font-mono-app text-[24px] font-semibold leading-none tracking-[-0.01em]">
              {amount(t.minor, t.currency)}
            </b>
          ))}
        </div>
      )}

      <p className="mt-2.5 text-[12px] leading-relaxed text-mute">
        {none
          ? "When Yaadly sends you an invoice, it shows here until it is paid."
          : `${count} invoice${count === 1 ? "" : "s"} sent to you and not paid yet. You pay Yaadly, by card or bank transfer, from the invoice itself.`}
      </p>

      {pay.receivedCount > 0 && (
        <p className="mt-2 text-[12px] leading-relaxed text-tealb">
          {pay.receivedCount === 1 ? "1 card payment" : `${pay.receivedCount} card payments`} received. A person at Yaadly
          signs {pay.receivedCount === 1 ? "it" : "them"} off, then {pay.receivedCount === 1 ? "it shows" : "they show"} as paid.
        </p>
      )}

      {href && (
        <Link
          href={href}
          className="mt-3 block border-t border-gold/20 pt-3 text-[12.5px] font-semibold text-goldb transition hover:text-ink"
        >
          {count === 1 ? "Open the invoice" : "Open the oldest invoice"} &rarr;
        </Link>
      )}
    </div>
  );
}

export function ClientRail({
  focus,
  labels,
  cards,
  pay,
  payHref,
  properties,
}: {
  focus: Job | null;
  labels: Record<string, StatusLabel>;
  cards: StatCard[];
  pay: ToPay;
  payHref: string | null;
  /** How many properties the client has, when more than one. */
  properties: number | null;
}) {
  return (
    <aside className="flex min-w-0 flex-col gap-3">
      {focus && <FocusRing job={focus} labels={labels} />}
      <Tiles cards={cards} />
      <ToPayCard pay={pay} href={payHref} />
      {properties != null && (
        <Link
          href="/portal/properties"
          className="flex flex-wrap items-baseline gap-x-2 rounded-2xl border border-line bg-panel px-4.5 py-3.5 transition hover:border-line2"
        >
          <b className="text-[13.5px] text-ink">See all {properties} of your properties</b>
          <span className="text-[12px] text-dim">every job on each one</span>
          <span className="ml-auto text-[13px] text-tealb">&rarr;</span>
        </Link>
      )}
    </aside>
  );
}

/**
 * The worker's panel. The ring and the tiles are the client's, fed the
 * worker's own status wording and figures. Below them, the held and released
 * bar the page already had, then where the worker stands on being paid.
 *
 * What the design had and this does not: a bank details form with account
 * number and branch fields. Yaadly stores no bank details (14 Sep 2026). The
 * card links to /portal/worker/payouts, where the worker gives them to Stripe
 * or Wise, and says which step is next (payout-status.ts). The design's
 * "Payout in 1 working day" is also not carried over: workers are paid within
 * 7 days, and that sentence already sits on the Released tile.
 */
export function WorkerRail({
  focus,
  labels,
  cards,
  held,
  released,
  payout,
  phone,
}: {
  focus: Job | null;
  labels: Record<string, StatusLabel>;
  cards: StatCard[];
  held: number;
  released: number;
  payout: PayoutReadiness;
  phone: string | null;
}) {
  const ready = payout.state === "ready";
  return (
    <aside className="flex min-w-0 flex-col gap-3">
      {focus && <FocusRing job={focus} labels={labels} />}
      <div>
        <Tiles cards={cards} title="Work and money" />
        <MoneySplit held={held} released={released} heldLabel="Held" releasedLabel="Released" />
      </div>
      <Link
        href="/portal/worker/payouts"
        className={
          "block rounded-2xl border p-4.5 transition " +
          (ready ? "border-green/25 bg-green/[0.04] hover:border-green/45" : "border-gold/30 bg-gold/[0.06] hover:border-gold/60")
        }
      >
        <div className="flex items-center gap-2">
          <span className={"font-mono-app text-[9.5px] font-semibold uppercase tracking-[.16em] " + (ready ? "text-green" : "text-goldb")}>
            How Yaadly pays you
          </span>
        </div>
        <b className="mt-1.5 block font-display text-[17px] font-normal leading-tight">{payout.title}</b>
        <p className="mt-1.5 text-[12px] leading-relaxed text-mute">{payout.detail}</p>
        <p className="mt-1.5 text-[12px] leading-relaxed text-dim">By bank transfer into your own account, within 7 days. Never cash.</p>
        <span className={"mt-3 block border-t pt-3 text-[12.5px] font-semibold " + (ready ? "border-green/20 text-green" : "border-gold/20 text-goldb")}>
          {payout.cta} &rarr;
        </span>
      </Link>
      {/* LinkWorkerPhone brings its own mt-4; the panel's gap already spaces it. */}
      <div className="-mt-4">
        <LinkWorkerPhone phone={phone} />
      </div>
    </aside>
  );
}
