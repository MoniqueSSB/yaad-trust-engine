/**
 * Where this job is, in four phases, each opened up to show its own steps.
 *
 * This replaces nothing: StageRail still exists and still drives the stage
 * viewer. What it adds is the answer to "where am I and what is done",
 * which a thirteen-item rail of equal-weight labels never gave, because
 * every item looked the same whether it had happened or not.
 *
 * Founder's instruction, 2 Sep 2026: the sub section should show each stage,
 * where you are, and what is completed. So each phase carries its own ticked
 * list, and a payment stage carries the money it releases, because on this
 * product a stage IS a payment.
 */

export type Step = {
  title: string;
  state: "done" | "now" | "todo";
  /** shown right-aligned, for stages that release money */
  amount?: string;
};

export type Phase = {
  title: string;
  /** one line under the title, e.g. "2 of 3 done" */
  summary: string;
  state: "done" | "now" | "todo";
  steps: Step[];
};

const Tick = () => (
  <svg viewBox="0 0 24 24" className="size-[7px] fill-none stroke-green stroke-[3.5]" strokeLinecap="round" strokeLinejoin="round">
    <path d="m5 13 4 4L19 7" />
  </svg>
);

export function JobProgress({ phases }: { phases: Phase[] }) {
  return (
    <>
      <h2 className="mb-3.5 mt-8 font-mono-app text-[10px] font-semibold uppercase tracking-[0.18em] text-dim">
        Where this job is
      </h2>
      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        {phases.map((p, i) => (
          <div
            key={i}
            className={
              "rounded-2xl border px-4 pb-3.5 pt-4 " +
              (p.state === "done"
                ? "border-green/25 bg-green/[0.04]"
                : p.state === "now"
                  ? "border-gold/45 bg-gold/[0.06] shadow-[0_0_22px_rgba(245,158,11,0.07)]"
                  : "border-line bg-bg/40")
            }
          >
            <div className="mb-2 flex items-center gap-2">
              <span
                className={
                  "grid size-[19px] place-items-center rounded-full border-[1.5px] font-mono-app text-[9.5px] font-semibold " +
                  (p.state === "done"
                    ? "border-green/45 bg-green/[0.16] text-green"
                    : p.state === "now"
                      ? "border-gold bg-gold/[0.16] text-goldb"
                      : "border-line2 text-dim")
                }
              >
                {p.state === "done" ? <Tick /> : i + 1}
              </span>
              <span className={"text-[13px] font-bold " + (p.state === "now" ? "text-ink" : "text-mute")}>
                {p.title}
              </span>
            </div>
            <div className={"text-[11.5px] leading-snug " + (p.state === "now" ? "text-goldb" : "text-dim")}>
              {p.summary}
            </div>

            <div className="mt-2.5 h-0.5 overflow-hidden rounded-sm bg-line">
              <span
                className={
                  "block h-full rounded-sm " +
                  (p.state === "done"
                    ? "w-full bg-green"
                    : p.state === "now"
                      ? "w-[45%] bg-linear-to-r from-gold to-transparent"
                      : "w-0")
                }
              />
            </div>

            {p.steps.length > 0 && (
              <div className="mt-2.5 flex flex-col gap-1.5 border-t border-line pt-2.5">
                {p.steps.map((s, k) => (
                  <span
                    key={k}
                    className={
                      "flex items-start gap-2 text-[11.5px] leading-snug " +
                      (s.state === "done" ? "text-mute" : s.state === "now" ? "font-semibold text-goldb" : "text-dim")
                    }
                  >
                    <span
                      className={
                        "mt-px grid size-[13px] shrink-0 place-items-center rounded-full border-[1.5px] " +
                        (s.state === "done"
                          ? "border-green/45 bg-green/[0.16]"
                          : s.state === "now"
                            ? "border-gold bg-gold/[0.16]"
                            : "border-line2")
                      }
                    >
                      {s.state === "done" ? <Tick /> : s.state === "now" ? <i className="size-[5px] animate-pulse rounded-full bg-gold" /> : null}
                    </span>
                    <span className="min-w-0 flex-1">{s.title}</span>
                    {s.amount && (
                      <span
                        className={
                          "shrink-0 whitespace-nowrap pl-1.5 font-mono-app text-[10px] font-medium " +
                          (s.state === "done" ? "text-green" : s.state === "now" ? "text-goldb" : "text-dim")
                        }
                      >
                        {s.amount}
                      </span>
                    )}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
