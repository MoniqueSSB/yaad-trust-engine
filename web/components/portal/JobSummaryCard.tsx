import Link from "next/link";
import { WhereText } from "./JobList";

/**
 * The one card a client reads first: what the job is, where it stands, and
 * whose move it is. Founder's brief, 3 Sep 2026: one clear place to
 * understand the project, before any of the seven areas below it.
 *
 * Everything here is a fact the room already loaded elsewhere on the page;
 * this states it once, together, rather than making the reader assemble it
 * from a title, a status pill three lines down, and a checklist further
 * still.
 *
 * Location, 13 Sep 2026: this card used to show the parish only, because the
 * page never queried the street address. Founder's instruction: it has to be
 * clear exactly where the job is. The page now fetches the address for the
 * job's client and its booked worker, and for nobody else; anyone else
 * reaching this card is passed addrHidden and sees the parish.
 */
export function JobSummaryCard({
  title,
  jobId,
  parish,
  addr,
  addrHidden = false,
  statusLabel,
  stageDetail,
  nextAction,
  lastUpdated,
}: {
  title: string;
  jobId: string;
  parish: string | null;
  /** Street address, only for the client or the booked worker. */
  addr: string | null;
  addrHidden?: boolean;
  statusLabel: string;
  /** "Stage 2 of 3" while work is under way, otherwise null. */
  stageDetail?: string | null;
  /** null when nothing is outstanding: the job is caught up */
  nextAction: {
    title: string;
    /** "You", the other side's name, or "Yaadly" */
    responsible: string;
    href?: string;
    cta?: string;
  } | null;
  /** already formatted, e.g. "2026-09-02 14:30" */
  lastUpdated: string | null;
}) {
  return (
    <section className="mt-4 rounded-2xl border border-line2 bg-panel p-5">
      <h1 className="font-display text-[clamp(22px,3.4vw,32px)] uppercase leading-none">
        {title}
      </h1>
      <p className="mt-2 font-mono-app text-[12px] text-dim">{jobId}</p>

      {/* Stage and place first, as full sentences in the body size, rather
          than a small pill and a grey parish beside the reference. The stage
          is in bold on the founder's instruction, 13 Sep 2026. */}
      <dl className="mt-4 grid grid-cols-[auto_1fr] items-baseline gap-x-4 gap-y-2 text-[15px]">
        <dt className="text-[10px] font-bold uppercase tracking-[.14em] text-dim">Stage</dt>
        <dd className="leading-snug text-ink">
          <b className="font-extrabold">{statusLabel}</b>
          {stageDetail && <b className="font-extrabold">, {stageDetail.toLowerCase()}</b>}
        </dd>
        <dt className="text-[10px] font-bold uppercase tracking-[.14em] text-dim">Where</dt>
        <dd className="leading-snug text-ink">
          <WhereText addr={addr} parish={parish} hidden={addrHidden} />
        </dd>
      </dl>

      <dl className="mt-4 grid gap-3.5 border-t border-line pt-4 sm:grid-cols-3">
        <div>
          <dt className="text-[10px] font-bold uppercase tracking-[.14em] text-dim">
            Next action
          </dt>
          <dd className="mt-1 text-[13.5px] leading-snug text-ink">
            {nextAction ? (
              nextAction.href && nextAction.cta ? (
                <Link href={nextAction.href} className="underline-offset-2 hover:underline hover:text-tealb">
                  {nextAction.title}
                </Link>
              ) : (
                nextAction.title
              )
            ) : (
              "Nothing outstanding, this job is up to date"
            )}
          </dd>
        </div>
        <div>
          <dt className="text-[10px] font-bold uppercase tracking-[.14em] text-dim">
            Responsible
          </dt>
          <dd className="mt-1 text-[13.5px] leading-snug text-ink">
            {nextAction ? nextAction.responsible : "Nobody, nothing waiting"}
          </dd>
        </div>
        <div>
          <dt className="text-[10px] font-bold uppercase tracking-[.14em] text-dim">
            Last update
          </dt>
          <dd className="mt-1 text-[13.5px] leading-snug text-ink">
            {lastUpdated ?? "Not recorded"}
          </dd>
        </div>
      </dl>
    </section>
  );
}
