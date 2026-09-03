import Link from "next/link";

/**
 * The side rail: the two or three things a person keeps glancing back at
 * while they read everything else. Money, who is doing the work, and a way
 * to reach a human.
 *
 * The room had none of this. Every one of these facts existed, but each
 * was a full-width band in the same scroll as the brief, the evidence and
 * the chat, so "how much is held" and "who is my tradesperson" were things
 * you scrolled to find rather than things that stayed with you. Sticky on
 * a wide screen, stacked underneath on a narrow one.
 */

export function JobRail({
  side,
  money,
  labour,
  allIn,
  takeHome,
  fee,
  heldNote,
  workerName,
  jobBase,
  moneyHref,
}: {
  side: "client" | "worker";
  money: (n: number | null | undefined) => string | null;
  labour: number | null;
  allIn: number | null;
  takeHome: number | null;
  fee: number | null;
  heldNote: string;
  workerName: string | null;
  jobBase: string;
  moneyHref: string;
}) {
  const headline = side === "client" ? allIn : takeHome;
  const initials = (workerName ?? "")
    .split(" ")
    .map((x) => x[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <aside className="flex flex-col gap-3 lg:sticky lg:top-6">
      <div className="rounded-2xl border border-gold/30 bg-linear-to-br from-gold/[0.09] to-purple/[0.05] p-5">
        <div className="mb-2 font-mono-app text-[9.5px] font-semibold uppercase tracking-[0.16em] text-goldb">
          {side === "client" ? "What this job costs" : "What you are paid"}
        </div>
        {labour == null ? (
          <div className="text-[19px] font-medium text-mute">
            {side === "client" ? "Set when you choose a quote" : "Set when a client accepts"}
          </div>
        ) : (
          <div className="font-mono-app text-[29px] font-semibold leading-none tracking-[-0.01em] text-ink">
            {money(headline)}
          </div>
        )}
        <div className="mt-2.5 flex items-start gap-2 text-[12px] leading-relaxed text-mute">
          <svg viewBox="0 0 24 24" className="mt-0.5 size-3.5 shrink-0 fill-none stroke-goldb stroke-2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" />
          </svg>
          <span>{heldNote}</span>
        </div>

        {labour != null && (
          <div className="mt-3.5 flex flex-col gap-1.5 border-t border-gold/20 pt-3.5">
            <div className="flex justify-between text-[12px]">
              <span className="text-mute">{side === "client" ? "Worker labour" : "Your labour price"}</span>
              <span className="font-mono-app text-[11.5px] text-ink">{money(labour)}</span>
            </div>
            <div className="flex justify-between text-[12px]">
              <span className="text-mute">Yaadly fee, 15%</span>
              <span className="font-mono-app text-[11.5px] text-ink">{money(fee)}</span>
            </div>
          </div>
        )}

        <Link
          href={moneyHref}
          className="mt-3.5 block border-t border-gold/20 pt-3.5 text-[12.5px] font-semibold text-goldb transition hover:opacity-80"
        >
          See the breakdown &amp; invoices &rarr;
        </Link>
      </div>

      {workerName && (
        <div className="rounded-2xl border border-line bg-[rgba(13,13,40,0.5)] px-4.5 py-4">
          <div className="mb-2.5 font-mono-app text-[9.5px] font-semibold uppercase tracking-[0.16em] text-dim">
            {side === "client" ? "Your tradesperson" : "You are the tradesperson"}
          </div>
          <div className="flex items-center gap-3">
            <span className="grid size-9.5 shrink-0 place-items-center rounded-xl bg-linear-to-br from-purple to-gold font-display text-[15px] text-white">
              {initials || "W"}
            </span>
            <span className="min-w-0">
              <b className="block text-[13.5px] font-bold leading-tight">{workerName}</b>
              <span className="block text-[11.5px] text-mute">Chosen for this job</span>
            </span>
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-line bg-[rgba(13,13,40,0.5)] px-4.5 py-4">
        <div className="mb-1 font-mono-app text-[9.5px] font-semibold uppercase tracking-[0.16em] text-dim">This job</div>
        <Link href={jobBase + "?tab=evidence"} className="flex items-center justify-between border-b border-line py-2.5 text-[13px] text-mute transition hover:text-purpleb">
          Progress evidence <span className="text-dim">&rarr;</span>
        </Link>
        <Link href={jobBase + "?tab=approvals"} className="flex items-center justify-between border-b border-line py-2.5 text-[13px] text-mute transition hover:text-purpleb">
          Approvals <span className="text-dim">&rarr;</span>
        </Link>
        <Link href={jobBase} className="flex items-center justify-between py-2.5 text-[13px] text-mute transition hover:text-purpleb">
          Overview &amp; documents <span className="text-dim">&rarr;</span>
        </Link>
      </div>

      <div className="rounded-2xl border border-line bg-green/[0.05] px-4.5 py-4">
        <div className="mb-1.5 font-mono-app text-[9.5px] font-semibold uppercase tracking-[0.16em] text-dim">Stuck?</div>
        <p className="mb-3 text-[12.5px] leading-relaxed text-mute">
          A person answers, not a bot. Patois or English.
        </p>
        <a
          href="https://wa.me/447878877567"
          target="_blank"
          rel="noopener"
          className="flex items-center justify-center gap-2 rounded-full bg-[#25D366] py-2.5 text-[12.5px] font-bold text-onbrand transition hover:brightness-105"
        >
          <svg viewBox="0 0 32 32" className="size-4 fill-onbrand">
            <path d="M16 3C9.4 3 4 8.4 4 15c0 2.1.6 4.2 1.6 6L4 29l8.2-1.6c1.7.9 3.6 1.4 5.8 1.4 6.6 0 12-5.4 12-12S22.6 3 16 3zm0 21.8c-1.8 0-3.5-.5-5-1.3l-.4-.2-4.9 1 1-4.7-.3-.4c-1-1.5-1.5-3.3-1.5-5.2 0-5.4 4.4-9.8 9.8-9.8s9.8 4.4 9.8 9.8-4.1 10.8-8.5 10.8z" />
          </svg>
          Message Yaadly
        </a>
      </div>
    </aside>
  );
}
