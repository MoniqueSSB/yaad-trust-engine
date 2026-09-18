import { LandingLink, LandOnLoad } from "./LandingLink";

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
      <LandOnLoad />
      <div className="flex items-center gap-3 border-b border-line bg-bg/40 px-4 py-2.5">
        <h2 className="text-[13px] font-bold">Everything outstanding</h2>
        <span
          className={
            "ml-auto rounded-full border px-2.5 py-0.5 font-mono-app text-[10.5px] font-semibold " +
            (items.length === 0
              ? "border-green/30 bg-green/10 text-green"
              : "border-gold/30 bg-gold/[0.14] text-goldb")
          }
        >
          {items.length === 0 ? "all clear" : items.length + " open"}
        </span>
      </div>

      {items.length === 0 ? (
        <div className="flex items-center gap-3 px-4 py-3">
          <svg viewBox="0 0 24 24" className="size-5 shrink-0 fill-none stroke-green stroke-[2.2]" strokeLinecap="round" strokeLinejoin="round">
            <path d="m5 13 4 4L19 7" />
          </svg>
          <span className="text-[13.5px] text-mute">
            <b className="font-semibold text-ink">Nothing is waiting on anybody.</b> This job is up to date.
          </span>
        </div>
      ) : (
        items.map((o, i) => {
          /* The whole row is the link, not just the words at the end of it.
             A client reads the title and taps the title; a small "See it"
             on the far right was the only live part, and on a phone it was
             easy to miss entirely. Each href carries a #section, so the
             tab opens on the thing to do rather than at the top of it. */
          const row = (
            <>
            <span
              className={
                "min-w-[64px] shrink-0 rounded border px-1.5 py-0.5 text-center font-mono-app text-[8.5px] font-semibold uppercase tracking-[0.08em] " +
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
              <b className="block text-[13px] font-semibold leading-snug text-ink">{o.title}</b>
              <span className="block text-[11.5px] leading-snug text-dim">{o.detail}</span>
            </span>
            {o.href && (
              <span className="shrink-0 whitespace-nowrap text-[12px] font-bold text-goldb transition group-hover:opacity-80">
                {o.cta ?? "Open"} &rarr;
              </span>
            )}
            </>
          );
          const rowClass = "flex items-center gap-3 border-b border-line px-4 py-2.5 last:border-b-0";
          return o.href ? (
            <LandingLink
              key={i}
              href={o.href}
              className={rowClass + " group transition hover:bg-bg/40 focus-visible:bg-bg/40 focus-visible:outline-none"}
            >
              {row}
            </LandingLink>
          ) : (
            <div key={i} className={rowClass}>
              {row}
            </div>
          );
        })
      )}
    </section>
  );
}
