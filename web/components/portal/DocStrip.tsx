import Link from "next/link";

/**
 * The document strip.
 *
 * Every document a job will ever have, listed from the first day, each one
 * saying where it actually is. The previous version greyed an unwritten
 * document to 55% opacity and left the note to imply the rest, which reads as
 * broken rather than pending: a client seeing a dim row with no status word
 * cannot tell whether the document failed, is missing, or has simply not been
 * written yet.
 *
 * So the state is a word, on every row, always. "Not completed" is a fact
 * about a document that is going to exist. Blank is not.
 */
export type DocState =
  /** exists, signed or issued, openable now */
  | "ready"
  /** will exist, and something specific has to happen first */
  | "not_completed"
  /** exists but is not final, so it can be read and will still change */
  | "in_progress";

export type Doc = {
  icon: string;
  title: string;
  /** what the document is, or what it is waiting on */
  note: string;
  state: DocState;
  /** only meaningful when there is something to open */
  href?: string;
};

const LABEL: Record<DocState, string> = {
  ready: "Completed",
  not_completed: "Not completed",
  in_progress: "In progress",
};

const CHIP: Record<DocState, string> = {
  ready: "bg-tealb/15 text-tealb",
  not_completed: "bg-panel2 text-dim",
  in_progress: "bg-mango/15 text-mango",
};

export function DocStrip({ docs }: { docs: Doc[] }) {
  if (docs.length === 0) return null;
  return (
    <section className="mt-4 rounded-2xl border border-line bg-panel p-5">
      <h2 className="mb-1 text-[10.5px] font-bold uppercase tracking-[.2em] text-tealb">
        Your documents
      </h2>
      <p className="mb-3.5 max-w-[62ch] text-[12.5px] leading-relaxed text-dim">
        Every document this job will have, from the first day. The ones not
        written yet say so, and say what they are waiting on.
      </p>
      <div className="grid gap-2">
        {docs.map((d) => {
          const inner = (
            <>
              <span
                aria-hidden
                className="grid size-8 flex-none place-items-center rounded-lg border border-line2 bg-bg text-[14px]"
              >
                {d.icon}
              </span>
              <span className="min-w-0 flex-1">
                <b className="block text-[13.5px] leading-snug">{d.title}</b>
                <span className="mt-0.5 block text-[12px] leading-snug text-dim">
                  {d.note}
                </span>
              </span>
              <span
                className={
                  "flex-none self-center rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide " +
                  CHIP[d.state]
                }
              >
                {LABEL[d.state]}
              </span>
            </>
          );
          const base =
            "flex items-center gap-3 rounded-xl border px-3.5 py-3 transition ";
          /* An openable document is a link. One that is not is not a dimmed
             link, it is a row: nothing to click, and nothing pretending to
             be clickable. */
          return d.href ? (
            <Link
              key={d.title}
              href={d.href}
              className={base + "border-line bg-bg hover:border-teal"}
            >
              {inner}
            </Link>
          ) : (
            <div key={d.title} className={base + "border-line bg-bg"}>
              {inner}
            </div>
          );
        })}
      </div>
    </section>
  );
}
