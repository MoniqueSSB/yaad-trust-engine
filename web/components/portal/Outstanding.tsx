import Link from "next/link";

/**
 * Everything this job is waiting on, in one list, with the name of whoever
 * it is waiting on against each line.
 *
 * The room already said all of this, but scattered: a gate checklist near
 * the top, an evidence count in a tile, a quote decision inside a tab, an
 * unpaid fee inside another. A client asking the only question they ever
 * really ask, "is anything waiting on me", had to read four panels and work
 * it out. Founder's instruction, 2 Sep 2026: make what is outstanding
 * clear.
 *
 * Every row is derived from state the page already holds. Nothing here
 * invents a task, and a job with nothing open says so rather than showing
 * an empty box.
 */

export type OutItem = {
  /** who has to move: the reader, the other side, or Yaadly */
  who: "you" | "them" | "yaadly";
  title: string;
  detail: string;
  href?: string;
  cta?: string;
};

export function Outstanding({
  items,
  otherSideLabel,
}: {
  items: OutItem[];
  /** "The worker" to a client, "The client" to a worker. */
  otherSideLabel: string;
}) {
  const label = (who: OutItem["who"]) =>
    who === "you" ? "You" : who === "them" ? otherSideLabel : "Yaadly";

  return (
    <section className="mt-4 overflow-hidden rounded-[18px] border border-line2 bg-[rgba(13,13,40,0.5)]">
      <div className="flex items-center gap-3 border-b border-line bg-bg/40 px-5 py-4">
        <h2 className="text-[14px] font-bold">Everything outstanding</h2>
        <span
          className={
            "ml-auto rounded-full border px-3 py-0.5 font-mono-app text-[11px] font-semibold " +
            (items.length === 0
              ? "border-green/30 bg-green/10 text-green"
              : "border-gold/30 bg-gold/[0.14] text-goldb")
          }
        >
          {items.length === 0 ? "all clear" : items.length + " open"}
        </span>
      </div>

      {items.length === 0 ? (
        <div className="flex items-center gap-3 p-5">
          <svg viewBox="0 0 24 24" className="size-5 shrink-0 fill-none stroke-green stroke-[2.2]" strokeLinecap="round" strokeLinejoin="round">
            <path d="m5 13 4 4L19 7" />
          </svg>
          <span className="text-[13.5px] text-mute">
            <b className="font-semibold text-ink">Nothing is waiting on anybody.</b> This job is up to date.
          </span>
        </div>
      ) : (
        items.map((o, i) => (
          <div key={i} className="flex items-start gap-3.5 border-b border-line px-5 py-3.5 last:border-b-0">
            <span
              className={
                "mt-0.5 min-w-[74px] shrink-0 rounded-md border px-2 py-1 text-center font-mono-app text-[9px] font-semibold uppercase tracking-[0.1em] " +
                (o.who === "you"
                  ? "border-gold/30 bg-gold/[0.14] text-goldb"
                  : o.who === "them"
                    ? "border-purple/30 bg-purple/[0.12] text-purpleb"
                    : "border-line bg-panel2 text-mute")
              }
            >
              {label(o.who)}
            </span>
            <span className="min-w-0 flex-1">
              <b className="block text-[13.5px] font-semibold leading-snug text-ink">{o.title}</b>
              <span className="mt-0.5 block text-[12px] leading-relaxed text-dim">{o.detail}</span>
            </span>
            {o.href && o.cta && (
              <Link href={o.href} className="mt-0.5 shrink-0 whitespace-nowrap text-[12.5px] font-bold text-goldb transition hover:opacity-80">
                {o.cta} &rarr;
              </Link>
            )}
          </div>
        ))
      )}
    </section>
  );
}
