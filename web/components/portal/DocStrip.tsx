import Link from "next/link";

/**
 * The document strip, from the preview's `docsX()`.
 *
 * Every document attached to a job in one place, each one saying whether it
 * exists yet. A row that is not ready still shows, greyed, because "the
 * Completion Report is written when the job closes" is more useful than an
 * absence somebody has to infer.
 */
export type Doc = {
  icon: string;
  title: string;
  note: string;
  /** absent means the document does not exist yet */
  href?: string;
};

export function DocStrip({ docs }: { docs: Doc[] }) {
  if (docs.length === 0) return null;
  return (
    <section className="mt-4 rounded-2xl border border-line bg-panel p-5">
      <h2 className="mb-3 text-[10.5px] font-bold uppercase tracking-[.2em] text-tealb">
        Your documents
      </h2>
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
              <span className="min-w-0">
                <b className="block text-[13.5px] leading-snug">{d.title}</b>
                <span className="mt-0.5 block text-[12px] leading-snug text-dim">
                  {d.note}
                  {d.href ? " · open" : ""}
                </span>
              </span>
            </>
          );
          const base =
            "flex items-center gap-3 rounded-xl border px-3.5 py-3 transition ";
          return d.href ? (
            <Link
              key={d.title}
              href={d.href}
              className={base + "border-line bg-bg hover:border-teal"}
            >
              {inner}
            </Link>
          ) : (
            <div
              key={d.title}
              className={base + "border-line bg-bg opacity-55"}
            >
              {inner}
            </div>
          );
        })}
      </div>
    </section>
  );
}
