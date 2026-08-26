import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * The public marketplace: the open board, readable by anyone, no account.
 * This page reads ONLY the open_jobs view. The view is the privacy line:
 * addresses and phone numbers are stripped inside Postgres before a byte
 * leaves the database, and a job appears at all only once its client has
 * signed and no worker is attached. Acting on a job (quoting) is behind
 * the sign-in door in /portal.
 */

type OpenJob = {
  id: string;
  title: string | null;
  trade: string | null;
  parish: string | null;
  descr: string | null;
  updated_at: string | null;
  client_signed: boolean | null;
  client_jobs_completed: number | null;
};

export const metadata = {
  title: "Open jobs · Yaadly",
  description:
    "Open property jobs across Jamaica. Vetted tradespeople quote free; money is held until the work is proven.",
};

export default async function Board({
  searchParams,
}: {
  searchParams: Promise<{ trade?: string }>;
}) {
  const { trade } = await searchParams;
  const supabase = await createClient();

  let q = supabase
    .from("open_jobs")
    .select("id,title,trade,parish,descr,updated_at,client_signed,client_jobs_completed")
    .order("updated_at", { ascending: false });
  if (trade) q = q.eq("trade", trade);
  const { data } = await q;
  const jobs = (data ?? []) as OpenJob[];

  const { data: allTrades } = await supabase.from("open_jobs").select("trade");
  const trades = [...new Set((allTrades ?? []).map((t) => t.trade).filter(Boolean))] as string[];

  return (
    <div className="mx-auto max-w-[1080px] px-5 py-10">
      <p className="text-[10.5px] font-bold uppercase tracking-[.2em] text-tealb">
        Marketplace
      </p>
      <h1 className="mt-2 font-display text-[clamp(28px,4.5vw,42px)] uppercase leading-none">
        Open jobs, Kingston &amp; Portmore
      </h1>
      <p className="mt-3 max-w-[62ch] text-[15px] leading-relaxed text-mute">
        The public board. Safe columns only, anyone can read it, and a job
        only appears here once its client has signed the Client Guidelines.
        No addresses, no phone numbers, ever.
      </p>

      {trades.length > 0 && (
        <div className="mt-6 flex flex-wrap gap-2">
          <Link
            href="/jobs"
            className={
              "rounded-full border px-3.5 py-1.5 text-[12.5px] font-bold transition " +
              (!trade
                ? "border-teal bg-soft text-tealb"
                : "border-line text-mute hover:border-teal hover:text-tealb")
            }
          >
            All trades
          </Link>
          {trades.map((t) => (
            <Link
              key={t}
              href={`/jobs?trade=${encodeURIComponent(t)}`}
              className={
                "rounded-full border px-3.5 py-1.5 text-[12.5px] font-bold transition " +
                (trade === t
                  ? "border-teal bg-soft text-tealb"
                  : "border-line text-mute hover:border-teal hover:text-tealb")
              }
            >
              {t}
            </Link>
          ))}
        </div>
      )}

      {jobs.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-line bg-panel p-6">
          <b className="text-[15px]">The board is quiet right now</b>
          <p className="mt-2 max-w-[56ch] text-[13.5px] leading-relaxed text-mute">
            Jobs appear here the moment a client signs theirs live. Post one
            at{" "}
            <a href="https://yaadly.co.uk" className="text-tealb underline">
              yaadly.co.uk
            </a>{" "}
            and it lands on this board.
          </p>
        </div>
      ) : (
        <ul className="mt-8 grid gap-3.5">
          {jobs.map((j) => (
            <li key={j.id} className="rounded-2xl border border-line bg-panel p-5">
              <div className="flex flex-wrap items-start gap-3">
                <h2 className="min-w-[220px] flex-1 text-[16.5px] font-bold leading-snug">
                  {j.title ?? "Untitled job"}
                </h2>
                {j.trade && (
                  <span className="rounded-full border border-softline bg-soft px-2.5 py-1 text-[11px] font-bold text-tealb">
                    {j.trade}
                  </span>
                )}
              </div>
              {j.descr && (
                <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-[13.5px] leading-relaxed text-mute">
                  {j.descr}
                </p>
              )}
              <div className="mt-3 flex flex-wrap gap-3.5 border-t border-line pt-3 text-[12.5px] text-dim">
                <span>{j.id}</span>
                {j.parish && <b className="font-medium text-mute">{j.parish}</b>}
                <span>
                  {j.client_signed ? "✓ Client guidelines signed" : "Awaiting client signature"}
                </span>
                <span>
                  {j.client_jobs_completed
                    ? `Client · ${j.client_jobs_completed} job${j.client_jobs_completed === 1 ? "" : "s"} completed`
                    : "First job on Yaadly"}
                </span>
              </div>
              <div className="mt-3.5 flex flex-wrap items-center gap-2.5">
                <Link
                  href="/portal/sign-in"
                  className="rounded-full bg-linear-to-r from-teal to-mango px-4 py-2 text-[13px] font-bold text-[#04211D] transition hover:brightness-110"
                >
                  Quote this job
                </Link>
                <span className="text-[11.5px] text-dim">
                  Quoting needs a published profile and signed Worker
                  Guidelines. Browsing is free for everyone.
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-8 text-[12.5px] leading-relaxed text-dim">
        Every job here is read from the redacted public view: the description
        has addresses and phone numbers stripped inside the database before it
        reaches this page.
      </p>
    </div>
  );
}
