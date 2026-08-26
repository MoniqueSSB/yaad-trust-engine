import Link from "next/link";

/**
 * The same header the landing page wears, so app.yaadly.co.uk reads as a
 * tab of one Yaadly site rather than a separate place. Marketplace is the
 * lit tab here; everything else links back across.
 */
const SITE = "https://yaadly.co.uk";

export function SiteNav({ active }: { active: "market" | "portal" }) {
  const tab = (on: boolean) =>
    "rounded-[9px] border px-3 py-1.5 text-[13px] transition " +
    (on
      ? "border-softline bg-soft font-bold text-tealb"
      : "border-transparent font-medium text-mute hover:bg-panel2 hover:text-ink");
  return (
    <nav className="sticky top-0 z-50 border-b border-line bg-bg/95 backdrop-blur">
      <div className="mx-auto flex max-w-[1080px] flex-wrap items-center gap-3 px-5 py-3">
        <a href={SITE} className="flex items-center gap-2.5">
          <span className="grid size-8 place-items-center rounded-[9px] bg-teal font-display text-[17px] text-[#04211D]">
            Y
          </span>
          <b className="text-[17px]">
            Yaadly<span className="text-mango">Hub</span>
          </b>
        </a>
        <div className="ml-auto flex flex-wrap items-center gap-1">
          <a href={SITE} className={tab(false)}>Website</a>
          <Link href="/jobs" className={tab(active === "market")}>Marketplace</Link>
          <a href={`${SITE}/#services`} className={tab(false)}>Services</a>
          <Link href="/portal" className={tab(active === "portal")}>Portal</Link>
        </div>
        <a
          href={`${SITE}/#startform`}
          className="rounded-full bg-linear-to-r from-teal to-mango px-4 py-2 text-[13px] font-bold text-[#04211D] transition hover:brightness-110"
        >
          Post a job
        </a>
      </div>
    </nav>
  );
}
