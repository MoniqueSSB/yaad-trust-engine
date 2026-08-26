import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SiteNav } from "@/components/SiteNav";

export const dynamic = "force-dynamic";

/**
 * All 18 trades, MARKETPLACE-BUILD-SPEC section 7. The names come from the
 * taxonomy and are never renamed independently of data/job-taxonomy.js.
 * Counts are live off the open_jobs view; the trade classifier stores
 * lowercase, so matching is case-insensitive.
 */
const TRADES = [
  "Plumbing","Roofing","Electrical","Tiling","Masonry & Concrete",
  "Painting & Decorating","Grille & Gate Welding","Air Conditioning",
  "Landscaping","General Handyman","Solar Install","Water Tank & Pump",
  "Locks & Security Doors","Windows & Glazing","Carpentry & Joinery",
  "Drainage & Septic","Fencing","CCTV & Alarms",
];

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
          18 trades, Kingston &amp; Portmore
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
