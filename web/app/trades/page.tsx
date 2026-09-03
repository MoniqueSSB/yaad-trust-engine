import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { TRADES } from "@/lib/taxonomy";
import { SiteNav } from "@/components/SiteNav";

export const dynamic = "force-dynamic";

/**
 * Every trade, MARKETPLACE-BUILD-SPEC section 7.
 *
 * The list is imported from lib/taxonomy, not restated here. It used to be a
 * second copy of the same eighteen names, which matched on the day it was
 * written and had no way of noticing when it stopped matching. The whole
 * reason a client's roofing job and a worker's roofing profile find each other
 * is that both came from one list, so a page whose job is to send people into
 * that list must read it rather than remember it.
 *
 * The count in the heading is derived for the same reason: "18 trades" written
 * out by hand is a claim that goes stale the moment a nineteenth is added.
 *
 * Counts are live off the open_jobs view; the trade classifier stores
 * lowercase, so matching is case-insensitive.
 */

export const metadata = { title: "Find a trade · Yaadly" };

export default async function Trades() {
  const supabase = await createClient();
  const { data } = await supabase.from("open_jobs").select("trade");
  const counts = new Map<string, number>();
  for (const r of data ?? []) {
    const k = (r.trade ?? "").toLowerCase();
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return (
    <>
      <SiteNav active="market" />
      <div className="mx-auto max-w-[1080px] px-5 py-10">
        <p className="text-[10.5px] font-bold uppercase tracking-[.2em] text-tealb">Find a trade</p>
        <h1 className="mt-2 font-display text-[clamp(28px,4.5vw,42px)] uppercase leading-none">
          {TRADES.length} trades, Kingston &amp; Portmore
        </h1>
        <p className="mt-3 max-w-[62ch] text-[15px] leading-relaxed text-mute">
          Tap a trade and the board filters to it. Never start from a blank page.
        </p>
        <div className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {TRADES.map((t) => {
            const n = counts.get(t.toLowerCase()) ?? 0;
            return (
              <Link key={t} href={`/jobs?trade=${encodeURIComponent(t.toLowerCase())}`}
                className="rounded-xl border border-line bg-panel px-4 py-3.5 transition hover:-translate-y-0.5 hover:border-teal hover:bg-panel2">
                <b className="block text-[14px]">{t}</b>
                <span className="text-[11.5px] text-dim">{n} open job{n === 1 ? "" : "s"}</span>
              </Link>
            );
          })}
        </div>
      </div>
    </>
  );
}
