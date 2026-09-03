import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { TRADES, PARISHES } from "@/lib/taxonomy";
import { WorkerDirectory, WORKER_VIEW, SELECT_WORKER, type Worker } from "@/components/WorkerDirectory";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "The worker network · Yaadly",
  description:
    "Every verified tradesperson on Yaadly, by trade and by parish. Government photo ID on a video call, references called.",
};

/**
 * The worker directory. Founder decision, 3 Sep 2026.
 *
 * /workers was a 404: only /workers/[slug] existed, so a profile could be
 * reached from a card on the board's second tab and by no other route. A
 * tradesperson had nothing to send anybody, and a client who had been given a
 * name had no way to look it up. Both of those matter for a business whose
 * supply side is its product.
 *
 * The cards are the board's own component, imported, not a second copy of it.
 * What this page adds is the two filters the board's tab does not have, and
 * they are trade and parish on purpose, because those are the two questions a
 * client actually arrives with. There is deliberately no name search: it would
 * be the one part of this page that rewards knowing a worker's name in
 * advance, and discovery here is meant to run by what somebody needs doing and
 * where, not by who they already know.
 *
 * FILTERING IS DONE IN POSTGRES, not on an array in this file. The parish
 * filter has to match inside `areas` as well as the headline `parish`, because
 * a worker in St Andrew who travels to Kingston should appear under Kingston,
 * and a client filtering to Kingston is asking who will come, not who sleeps
 * there.
 *
 * Nothing here reads an email. The type has no email in it and SELECT_WORKER
 * does not ask for one.
 */
/**
 * The part of a parish name worth matching on.
 *
 * `worker_profiles.areas` is free text a person typed, not a constrained list,
 * and the live rows already disagree with the taxonomy about punctuation: the
 * app says "St Catherine" and there is a row saying "St. Catherine". An exact
 * match, or even an ilike on the full string, silently misses that worker, and
 * a directory that hides somebody is worse than one that has not been built.
 *
 * Dropping the "St" prefix and matching the distinctive word is what survives
 * both spellings. Single-word parishes are returned whole. It is a heuristic
 * and it is written down as one: the real fix is constraining `areas` to the
 * taxonomy at write time, which is a schema change and a migration for the
 * profiles already stored, not something to bury in a filter.
 */
function parishKey(parish: string): string {
  const clean = parish.trim().replace(/^st\.?\s+/i, "");
  return clean || parish.trim();
}

export default async function Workers({
  searchParams,
}: {
  searchParams: Promise<{ trade?: string; parish?: string }>;
}) {
  const { trade, parish } = await searchParams;
  const supabase = await createClient();

  /* The VIEW, never worker_profiles. The base table carries phone and
     worker_email on the same row as name and trade, and the public read policy
     is row level, which means every column. A directory reading the base table
     would hand every visitor a list of tradespeople's phone numbers. The view
     cannot carry those columns and already filters to active, which is why
     there is no .eq("active", true) here. Found and fixed in parallel by
     another session, 8578312; this page must not undo it. */
  let q = supabase
    .from(WORKER_VIEW)
    .select(SELECT_WORKER)
    .order("jobs_completed", { ascending: false });

  if (trade) q = q.ilike("trade", trade);
  if (parish) q = q.or(`parish.ilike.%${parishKey(parish)}%,areas.ilike.%${parishKey(parish)}%`);

  const { data } = await q;
  const workers = (data ?? []) as Worker[];

  const { data: allRows } = await supabase
    .from(WORKER_VIEW)
    .select("trade,parish,areas");
  const total = (allRows ?? []).length;

  /* Only offer a filter that would find somebody. A directory that lets you
     pick Trelawny and then says nobody is there has wasted the tap and told
     you nothing you could act on.

     Parishes are read from BOTH columns for the same reason the query matches
     both: live rows exist with parish null and areas set, and offering only
     the headline column would hide a worker who does cover the parish. */
  const liveTrades = new Set((allRows ?? []).map((r) => (r.trade ?? "").toLowerCase()));
  const liveParishText = (allRows ?? [])
    .map((r) => `${r.parish ?? ""} ${r.areas ?? ""}`.toLowerCase())
    .join(" | ");

  const chip = (on: boolean) =>
    "rounded-full border px-3.5 py-1.5 text-[12.5px] transition " +
    (on
      ? "border-purple/45 bg-purple/10 font-semibold text-purpleb"
      : "border-line text-mute hover:border-line2 hover:text-ink");

  const withParam = (k: "trade" | "parish", v: string | undefined) => {
    const next = new URLSearchParams();
    const cur = { trade, parish };
    cur[k] = v;
    if (cur.trade) next.set("trade", cur.trade);
    if (cur.parish) next.set("parish", cur.parish);
    const qs = next.toString();
    return "/workers" + (qs ? "?" + qs : "");
  };

  return (
    <div className="mx-auto max-w-[1080px] px-5 py-10">
      <p className="text-[10.5px] font-bold uppercase tracking-[.2em] text-tealb">The worker network</p>
      <h1 className="mt-2 font-display text-[clamp(28px,4.5vw,42px)] uppercase leading-none">
        Who does the work
      </h1>
      <p className="mt-3 max-w-[62ch] text-[15px] leading-relaxed text-mute">
        Every profile here has passed the same check: government photo ID on a
        video call, and references called. Nobody is listed before that is done.
      </p>

      <section className="mt-7" aria-labelledby="filter-trade">
        <p id="filter-trade" className="mb-2 font-mono-app text-[10px] font-semibold uppercase tracking-[0.14em] text-dim">
          By trade
        </p>
        <div className="flex flex-wrap gap-2">
          <Link href={withParam("trade", undefined)} aria-current={!trade ? "page" : undefined} className={chip(!trade)}>
            All trades
          </Link>
          {TRADES.filter((t) => liveTrades.has(t.toLowerCase())).map((t) => (
            <Link
              key={t}
              href={withParam("trade", t.toLowerCase())}
              aria-current={trade?.toLowerCase() === t.toLowerCase() ? "page" : undefined}
              className={chip(trade?.toLowerCase() === t.toLowerCase())}
            >
              {t}
            </Link>
          ))}
        </div>
      </section>

      <section className="mt-5" aria-labelledby="filter-parish">
        <p id="filter-parish" className="mb-2 font-mono-app text-[10px] font-semibold uppercase tracking-[0.14em] text-dim">
          By parish
        </p>
        <div className="flex flex-wrap gap-2">
          <Link href={withParam("parish", undefined)} aria-current={!parish ? "page" : undefined} className={chip(!parish)}>
            Anywhere
          </Link>
          {PARISHES.filter((p) => liveParishText.includes(parishKey(p).toLowerCase())).map((p) => (
            <Link
              key={p}
              href={withParam("parish", p.toLowerCase())}
              aria-current={parish?.toLowerCase() === p.toLowerCase() ? "page" : undefined}
              className={chip(parish?.toLowerCase() === p.toLowerCase())}
            >
              {p}
            </Link>
          ))}
        </div>
      </section>

      <p className="mt-6 font-mono-app text-[11px] font-medium uppercase tracking-[0.06em] text-dim">
        {workers.length} of {total} shown
        {trade ? ` · ${trade}` : ""}
        {parish ? ` · ${parish}` : ""}
        {(trade || parish) && (
          <>
            {" · "}
            <Link href="/workers" className="font-semibold text-purpleb">Clear</Link>
          </>
        )}
      </p>

      {workers.length === 0 && (trade || parish) ? (
        /* A filter that finds nobody is not an error, and the page should not
           read like one. It says what to widen and offers the job route, which
           is the thing that still works when the network is thin. */
        <div className="mt-4 rounded-2xl border border-line bg-panel p-6">
          <b className="text-[15px]">Nobody listed under that yet</b>
          <p className="mt-2 max-w-[62ch] text-[13.5px] leading-relaxed text-mute">
            The network is being built parish by parish. Widening the parish
            usually helps, because most workers travel further than the one they
            are listed under.
          </p>
          <p className="mt-3.5 text-[13.5px] text-mute">
            You can post the job anyway:{" "}
            <Link href="/jobs/new" className="font-semibold text-purpleb">
              tell us what needs doing
            </Link>{" "}
            and a person reads it and comes back within one working day.
          </p>
        </div>
      ) : (
        <WorkerDirectory workers={workers} />
      )}
    </div>
  );
}
