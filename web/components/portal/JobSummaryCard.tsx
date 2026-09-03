import Link from "next/link";

/**
 * The one card a client reads first: what the job is, where it stands, and
 * whose move it is. Founder's brief, 3 Sep 2026: one clear place to
 * understand the project, before any of the seven areas below it.
 *
 * Everything here is a fact the room already loaded elsewhere on the page;
 * this states it once, together, rather than making the reader assemble it
 * from a title, a status pill three lines down, and a checklist further
 * still. Location is the parish only, the same field the rest of the room
 * has always shown: the page never queries the street address, so there is
 * nothing more private for this card to have leaked.
 */
export function JobSummaryCard({
  title,
  jobId,
  parish,
  statusLabel,
  nextAction,
  lastUpdated,
}: {
  title: string;
  jobId: string;
  parish: string | null;
  statusLabel: string;
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
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-[240px] flex-1">
          <h1 className="font-display text-[clamp(22px,3.4vw,32px)] uppercase leading-none">
            {title}
          </h1>
          <p className="mt-2 flex flex-wrap gap-x-3.5 gap-y-1 text-[12.5px] text-dim">
            <span>{jobId}</span>
            {parish && <span>{parish}</span>}
          </p>
        </div>
        <span className="rounded-full border border-softline bg-soft px-3 py-1.5 text-[11.5px] font-bold text-tealb">
          {statusLabel}
        </span>
      </div>

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
