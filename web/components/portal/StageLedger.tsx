import Link from "next/link";

/**
 * Every payment stage on this job, one card each: what it covers, what
 * evidence stands against it, what invoice it has produced, and what it
 * releases.
 *
 * The phase view above says which stage is live. This says what each one
 * actually is, which matters because on this product a stage is the unit
 * money moves in: the client accepts a stage, and that acceptance is what
 * raises Yaadly's payable to its subcontractor for it (20260902j,
 * 20260902l). The client accepts the work; Yaadly pays its own
 * subcontractor. Two acts, and the copy must not merge them back into one.
 * See docs/COPY-GUIDELINES.md section 3.
 *
 * Stage names, proportions and release conditions are read from whichever
 * agreement the job actually went through, a Kickoff Pack or the lighter
 * Quote Pack (20260902d), and never invented here. A job with neither
 * renders nothing rather than a plausible-looking default, because a
 * made-up stage list on a page about money would be worse than no list at
 * all.
 */

export type LedgerStage = {
  n: number;
  name: string;
  /** share of the labour price this stage releases, if the pack says */
  percent: number | null;
  amount: string | null;
  /** the pack's own words for when this stage may be released */
  releaseCondition: string | null;
  evidenceRequired: string[];
  evidenceFiled: number;
  approved: boolean;
  /** true for the stage the job is sitting on right now */
  current: boolean;
  /** the pay invoice raised for this stage, if one has been */
  invoiceId: string | null;
  invoicePaid: boolean;
};

const Ico = {
  ok: (
    <svg viewBox="0 0 24 24" className="mt-0.5 size-3.5 shrink-0 fill-none stroke-green stroke-2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m5 13 4 4L19 7" />
    </svg>
  ),
  wait: (
    <svg viewBox="0 0 24 24" className="mt-0.5 size-3.5 shrink-0 fill-none stroke-goldb stroke-2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
    </svg>
  ),
  soon: (
    <svg viewBox="0 0 24 24" className="mt-0.5 size-3.5 shrink-0 fill-none stroke-dim stroke-2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
    </svg>
  ),
};

export function StageLedger({
  stages,
  side,
  jobBase,
  source,
}: {
  stages: LedgerStage[];
  side: "client" | "worker";
  jobBase: string;
  /** which of the two agreements these stages were read from */
  source: "kickoff" | "quote" | null;
}) {
  /* No pack yet means no stage list to show, but silence here reads as a
     missing feature. Say what will appear and when, so a job early in its
     life explains itself rather than looking broken. */
  if (stages.length === 0) {
    return (
      <section className="mb-3.5 rounded-2xl border border-line bg-linear-to-b from-[rgba(19,19,50,0.75)] to-[rgba(12,12,38,0.6)] px-5.5 py-5">
        <h3 className="font-display text-[17px] font-normal tracking-[-0.01em]">The payment stages</h3>
        <div className="mt-3.5 rounded-2xl border border-dashed border-line2 bg-bg/30 px-5 py-7 text-center">
          <b className="mb-1 block text-[14px] font-semibold text-ink">No stages on this job yet</b>
          <p className="mx-auto max-w-[52ch] text-[12.5px] leading-relaxed text-dim">
            A job has payment stages once a Quote Pack or a Kickoff Pack has been
            accepted and is on the job, and not before. Whichever of the two you
            go through sets them, and each stage then names the evidence it needs
            and the share of the price it releases.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="mb-3.5 rounded-2xl border border-line bg-linear-to-b from-[rgba(19,19,50,0.75)] to-[rgba(12,12,38,0.6)] px-5.5 py-5">
      <h3 className="font-display text-[17px] font-normal tracking-[-0.01em]">The payment stages</h3>
      <p className="mb-4 mt-1 text-[12.5px] text-dim">
        From the{" "}
        {source === "quote" ? "Quote Pack you both agreed" : "approved Kickoff Pack"}. Each stage
        names its own evidence and releases its own share of the price.
      </p>

      {stages.map((s) => {
        const state = s.approved ? "done" : s.current ? "now" : "todo";
        return (
          <div
            key={s.n}
            className={
              "mb-2.5 overflow-hidden rounded-2xl border last:mb-0 " +
              (state === "done"
                ? "border-green/25"
                : state === "now"
                  ? "border-gold/45 shadow-[0_0_24px_rgba(245,158,11,0.06)]"
                  : "border-line")
            }
          >
            <div
              className={
                "flex items-center gap-3.5 px-4.5 py-3.5 " +
                (state === "done" ? "bg-green/[0.05]" : state === "now" ? "bg-gold/[0.06]" : "bg-bg/40")
              }
            >
              <span
                className={
                  "grid size-[26px] shrink-0 place-items-center rounded-[9px] border-[1.5px] font-mono-app text-[11px] font-semibold " +
                  (state === "done"
                    ? "border-green/45 bg-green/[0.15] text-green"
                    : state === "now"
                      ? "border-gold bg-gold/[0.16] text-goldb"
                      : "border-line2 text-dim")
                }
              >
                {state === "done" ? (
                  <svg viewBox="0 0 24 24" className="size-3 fill-none stroke-green stroke-[3.2]" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m5 13 4 4L19 7" />
                  </svg>
                ) : (
                  s.n
                )}
              </span>

              <span className="min-w-0 flex-1">
                <b className={"block text-[14.5px] font-semibold leading-tight " + (state === "todo" ? "text-mute" : "text-ink")}>
                  Stage {s.n} · {s.name}
                </b>
                <span className="mt-0.5 block text-[11.5px] text-dim">
                  {s.approved
                    ? "Approved" +
                      (s.invoicePaid ? " and paid" : s.invoiceId ? ", invoice raised" : "")
                    : s.current
                      ? side === "client"
                        ? s.evidenceFiled > 0
                          ? "Waiting on your approval"
                          : "Under way, no evidence filed yet"
                        : s.evidenceFiled > 0
                          ? "Waiting on the client's approval"
                          : "Under way, file your evidence"
                      : "Not started yet"}
                </span>
              </span>

              {s.amount && (
                <span className="shrink-0 text-right">
                  <span className={"block font-mono-app text-[14px] font-semibold " + (state === "todo" ? "text-mute" : "text-ink")}>
                    {s.amount}
                  </span>
                  {s.percent != null && (
                    <span className="block font-mono-app text-[10px] font-medium text-dim">{s.percent}% of labour</span>
                  )}
                </span>
              )}
            </div>

            <div className="flex flex-col gap-2.5 border-t border-line px-4.5 py-3.5">
              {s.releaseCondition && (
                <span className="flex items-start gap-2.5 text-[12.5px] leading-relaxed text-mute">
                  {Ico.soon}
                  <span>
                    <b className="font-semibold text-ink">Acceptance criteria:</b>{" "}
                    {s.releaseCondition}
                  </span>
                </span>
              )}

              {/* The itemised list the pack asks for, which is the criteria in
                  checkable form. It was being collapsed into a comma string
                  behind the prose above, and only when there was no prose, so
                  in practice it never appeared at all. */}
              {s.evidenceRequired.length > 0 && (
                <div className="rounded-xl border border-line bg-bg/35 px-4 py-3">
                  <b className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.1em] text-dim">
                    {side === "client"
                      ? "What must be produced for this stage"
                      : "What you must produce for this stage"}
                  </b>
                  <ul className="flex flex-col gap-1.5">
                    {s.evidenceRequired.map((r, k) => (
                      <li key={k} className="flex items-start gap-2.5 text-[12.5px] leading-relaxed text-mute">
                        <span
                          className={
                            "mt-1 grid size-[14px] shrink-0 place-items-center rounded-[5px] border-[1.5px] " +
                            (s.approved ? "border-green/45 bg-green/[0.15]" : "border-line2")
                          }
                        >
                          {s.approved && (
                            <svg viewBox="0 0 24 24" className="size-2 fill-none stroke-green stroke-[3.5]" strokeLinecap="round" strokeLinejoin="round">
                              <path d="m5 13 4 4L19 7" />
                            </svg>
                          )}
                        </span>
                        <span>{r}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <span className="flex items-start gap-2.5 text-[12.5px] leading-relaxed text-mute">
                {s.approved ? Ico.ok : s.evidenceFiled > 0 ? Ico.wait : Ico.soon}
                <span>
                  <b className="font-semibold text-ink">Evidence:</b>{" "}
                  {s.evidenceFiled === 0
                    ? "nothing filed yet"
                    : s.evidenceFiled +
                      " item" +
                      (s.evidenceFiled === 1 ? "" : "s") +
                      " filed" +
                      (s.approved ? " and approved" : ", not yet approved")}
                </span>
              </span>

              <span className="flex items-start gap-2.5 text-[12.5px] leading-relaxed text-mute">
                {s.invoicePaid ? Ico.ok : s.invoiceId ? Ico.wait : Ico.soon}
                <span>
                  <b className="font-semibold text-ink">{side === "client" ? "Invoice:" : "Your pay invoice:"}</b>{" "}
                  {s.invoiceId ? (
                    <>
                      <span className="font-mono-app text-[11.5px]">{s.invoiceId}</span>
                      {s.invoicePaid ? " · paid" : " · raised, not yet paid"}
                    </>
                  ) : s.approved ? (
                    /* Approved but no invoice row against this stage. Older
                       jobs were approved before pay invoices were raised per
                       stage (20260902j), so say that rather than promise an
                       invoice that is never coming. */
                    "none recorded against this stage"
                  ) : side === "client" ? (
                    "not raised until you accept this stage"
                  ) : (
                    "raised as soon as this stage is accepted and checked"
                  )}
                </span>
              </span>

              {s.current && s.evidenceFiled > 0 && !s.approved && side === "client" && (
                <div className="mt-0.5 flex flex-wrap items-center gap-3">
                  <Link
                    href={jobBase + "?tab=evidence"}
                    className="rounded-full bg-linear-to-br from-goldb to-gold px-4.5 py-2.5 text-[12.5px] font-bold text-[#1A0F00] transition hover:brightness-105"
                  >
                    Review the evidence for stage {s.n} &rarr;
                  </Link>
                  {/* The other way to sign a stage off. It existed at the
                      bottom of the evidence tab and nowhere else, so nobody
                      found it; it belongs next to the decision it is an
                      alternative to. */}
                  <Link
                    href={jobBase + "?tab=evidence#walkthrough"}
                    className="text-[12.5px] font-semibold text-purpleb underline underline-offset-2 transition hover:opacity-80"
                  >
                    or book a live video walkthrough
                  </Link>
                </div>
              )}
              {s.current && s.evidenceFiled === 0 && side === "worker" && (
                <Link
                  href={jobBase + "?tab=evidence"}
                  className="mt-0.5 self-start rounded-full bg-linear-to-br from-goldb to-gold px-4.5 py-2.5 text-[12.5px] font-bold text-[#1A0F00] transition hover:brightness-105"
                >
                  File stage {s.n} evidence &rarr;
                </Link>
              )}
            </div>
          </div>
        );
      })}
    </section>
  );
}
