import Link from "next/link";

/**
 * The stage rail from PORTAL-SPEC.md: one button per stage, done / now /
 * todo. `current` is where the job actually is (derived from the row).
 * `viewing` lets the user browse other stages read-only via ?s=; browsing
 * never changes the job.
 */
export function StageRail({
  stages,
  current,
  viewing,
  base,
}: {
  stages: readonly string[];
  current: number;
  viewing: number;
  base: string;
}) {
  return (
    <>
      <nav
        aria-label="Job stages"
        className="mt-5 flex gap-1.5 overflow-x-auto pb-2"
      >
        {stages.map((t, i) => {
          const state = i < current ? "done" : i === current ? "now" : "todo";
          return (
            <Link
              key={t}
              href={`${base}?s=${i}`}
              aria-current={i === viewing ? "step" : undefined}
              className={
                "min-w-[104px] flex-1 rounded-[10px] border px-3 py-2 text-left transition " +
                (state === "done"
                  ? "border-softline bg-soft"
                  : state === "now"
                    ? "border-mango bg-mango/10"
                    : "border-line bg-panel hover:border-line2") +
                (i === viewing ? " ring-2 ring-tealb/40" : "")
              }
            >
              <span
                className={
                  "block font-mono text-[10px] font-bold tracking-wider " +
                  (state === "now"
                    ? "text-mango"
                    : state === "done"
                      ? "text-tealb"
                      : "text-dim")
                }
              >
                {String(i + 1).padStart(2, "0")}
              </span>
              <span
                className={
                  "mt-0.5 block text-[11.5px] font-bold leading-tight " +
                  (state === "todo" ? "text-mute" : "text-ink")
                }
              >
                {t}
              </span>
            </Link>
          );
        })}
      </nav>
      <div className="flex flex-wrap items-center gap-2.5">
        {viewing > 0 && (
          <Link
            href={`${base}?s=${viewing - 1}`}
            className="rounded-full border border-line2 px-4 py-2 text-[13px] font-bold text-ink transition hover:border-teal hover:text-tealb"
          >
            &larr; Back
          </Link>
        )}
        {viewing < stages.length - 1 && (
          <Link
            href={`${base}?s=${viewing + 1}`}
            className="rounded-full bg-linear-to-r from-teal to-mango px-4 py-2 text-[13px] font-bold text-[#04211D] transition hover:brightness-110"
          >
            Next step &rarr;
          </Link>
        )}
        <span className="ml-auto text-[12px] text-dim">
          Step {viewing + 1} of {stages.length}
          {viewing !== current && " · browsing, the job is at step " + (current + 1)}
        </span>
      </div>
    </>
  );
}
