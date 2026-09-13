import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { WhereText } from "@/components/portal/JobList";
import { PriceContextNote, observationsFromSpread } from "@/components/portal/PriceContextNote";
import { jmdOrNull as jmd } from "@/lib/money";

/** One row of my_quoted_jobs(): the tender pack. These are all the columns
 *  there are. There is no address, no client detail and no job code to add,
 *  because the function does not return them (20260913225614). */
export type Tender = {
  id: string;
  title: string | null;
  parish: string | null;
  trade: string | null;
  job_type: string | null;
  stage: number | null;
  status: string;
  updated_at: string | null;
  descr: string | null;
  quote_id: string | null;
  quote_status: string | null;
};

/** Quote statuses that still mean "this worker is in the running". */
export const LIVE_QUOTE = new Set(["submitted", "quote_confirmed", "kickoff_requested", "accepted"]);

type Photo = { id: string; caption: string | null; img: string | null; storage_path: string | null };

/**
 * The job room for a worker who has quoted on a job and is not booked on it.
 *
 * Founder's decision, 13 Sep 2026: a quoting worker sees what the public board
 * shows and nothing more, the tender pack and not the site file. Title,
 * parish, trade, the description with names and contact details taken out by
 * the same board_descr() the board uses, and the photographs the client put
 * on the board. Plus their own price and their own Kickoff Pack. It stays that
 * way after the client picks somebody else: the job remains theirs to look at
 * as a closed quote.
 *
 * This is not a page rule sitting on top of a wider read. Row level security
 * no longer returns the jobs row to this worker at all, so everything here
 * comes through my_quoted_jobs(), which only has the safe columns to give.
 */
export async function QuotedJobRoom({ id, userId }: { id: string; userId: string }) {
  const supabase = await createClient();

  const { data: tenderRows } = await supabase.rpc("my_quoted_jobs").eq("id", id);
  const tender = ((tenderRows ?? []) as Tender[])[0];
  if (!tender) notFound();

  const [{ data: quoteRows }, { data: packRows }, { data: photoRows }, { data: spreadRows }] = await Promise.all([
    // Their own quotes only. RLS already scopes job_quotes to the worker's own
    // rows; the filter says so here as well, so this page never picks up
    // somebody else's price by falling back to the first row.
    supabase
      .from("job_quotes")
      .select("id,status,labour_jmd,created_at")
      .eq("job_id", id)
      .eq("worker_user", userId)
      .order("created_at", { ascending: false }),
    supabase.from("kickoff_packs").select("id,quote_id,status,both_confirmed_at").eq("job_id", id),
    // board_ok named here as well as enforced in Postgres, the same as the
    // public board, so this worker sees exactly the photographs it shows.
    supabase
      .from("job_photos")
      .select("id,caption,img,storage_path")
      .eq("job_id", id)
      .eq("board_ok", true)
      .order("position"),
    supabase.rpc("price_spread_for_trade", { p_trade: tender.trade ?? "" }),
  ]);

  const quotes = (quoteRows ?? []) as { id: string; status: string | null; labour_jmd: number | null }[];
  const myQuote = quotes.find((q) => q.id === tender.quote_id) ?? quotes[0];
  const packs = (packRows ?? []) as { id: string; quote_id: string | null; status: string | null; both_confirmed_at: string | null }[];
  const myPack = myQuote ? packs.find((p) => p.quote_id === myQuote.id) : undefined;
  const observations = observationsFromSpread(Array.isArray(spreadRows) ? spreadRows[0] : spreadRows);

  /* The photographs live in the private 'intake' bucket. A short-lived signed
     URL per object, minted as the page renders, the same as the board. Postgres
     decides who may mint one ("quoting worker reads board photo files of a job
     they quoted"), so a photograph the board would not show cannot be signed. */
  const photos = (photoRows ?? []) as Photo[];
  const toSign = photos.filter((p) => p.storage_path && !p.img);
  if (toSign.length) {
    const { data: signed } = await supabase.storage
      .from("intake")
      .createSignedUrls(toSign.map((p) => p.storage_path as string), 300);
    const byPath = new Map((signed ?? []).map((r) => [r.path, r.signedUrl]));
    for (const p of toSign) p.img = byPath.get(p.storage_path as string) ?? null;
  }
  const shown = photos.filter((p) => p.img);

  return (
    <div className="mx-auto max-w-[720px] px-5 py-10">
      <p className="text-[10.5px] font-bold uppercase tracking-[.2em] text-mango">Your quote</p>
      <h1 className="mt-2 font-display text-[clamp(24px,4vw,36px)] uppercase leading-[.95]">
        {tender.title}
      </h1>
      <p className="mt-2 text-[13px] text-mute">
        <WhereText parish={tender.parish} hidden /> · <span className="font-mono text-[12px]">{tender.id}</span>
      </p>

      {(tender.descr || shown.length > 0) && (
        <section className="mt-6 rounded-2xl border border-line bg-panel p-5">
          <h2 className="text-[10.5px] font-bold uppercase tracking-[.2em] text-tealb">The job, as the board shows it</h2>
          {tender.descr && (
            <p className="mt-2 whitespace-pre-wrap text-[13.5px] leading-relaxed text-mute">{tender.descr}</p>
          )}
          {shown.length > 0 && (
            <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {shown.map((p) => (
                <li key={p.id}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={p.img as string}
                    alt={p.caption || "Photograph of the job"}
                    className="aspect-square w-full rounded-xl border border-line object-cover"
                  />
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-[11.5px] leading-relaxed text-dim">
            Names and contact details are taken out, the same as on the public board. The street
            address and the client&apos;s details are shared once you are booked.
          </p>
        </section>
      )}

      {!myQuote && (
        <p className="mt-6 max-w-[58ch] text-[14px] leading-relaxed text-mute">
          No quote of yours found on this job.
        </p>
      )}

      {myQuote && (
        <div className="mt-6 rounded-2xl border border-line bg-panel p-5">
          <div className="flex flex-wrap items-center gap-3">
            <b className="text-[15px]">Your price</b>
            <span className="rounded-full border border-line bg-panel2 px-2.5 py-1 text-[10.5px] font-bold text-mute">
              {myQuote.status}
            </span>
            <span className="ml-auto text-[15px] font-bold text-tealb">
              {jmd(myQuote.labour_jmd) ?? "No labour figure"}
            </span>
          </div>
          {/* The Mirror Rule. The client is shown where this price sits, so
              the worker is shown the same words. He is also the one who
              knows the access is bad, which is what the caveat names. */}
          <PriceContextNote trade={tender.trade} labour={myQuote.labour_jmd} observations={observations} />

          {myQuote.status === "submitted" && (
            <p className="mt-3 text-[13px] leading-relaxed text-mute">
              Waiting on the client. Nothing to do here yet: if they want to
              move forward with your price, they will ask you to write a
              Kickoff Pack against it.
            </p>
          )}

          {myQuote.status === "declined" && (
            <p className="mt-3 text-[13px] leading-relaxed text-mute">
              The client went with a different price for this job.
            </p>
          )}

          {myQuote.status === "withdrawn" && (
            <p className="mt-3 text-[13px] leading-relaxed text-mute">
              You withdrew this price.
            </p>
          )}

          {myQuote.status === "kickoff_requested" && !myPack && (
            <p className="mt-3 text-[13px] leading-relaxed text-mute">
              The client wants a Kickoff Pack against your price. It is
              being written now; check back shortly.
            </p>
          )}

          {myQuote.status === "kickoff_requested" && myPack && myPack.status !== "approved" && (
            <p className="mt-3 text-[13px] leading-relaxed text-mute">
              Your Kickoff Pack is drafted and waiting on review before it
              is issued.
            </p>
          )}

          {myQuote.status === "kickoff_requested" && myPack && myPack.status === "approved" && (
            <div className="mt-4 border-t border-line pt-4">
              <p className="text-[13px] leading-relaxed text-mute">
                Your Kickoff Pack is ready: scope, timeline, payment stages
                and the evidence checklist. Read it, then confirm your side.
                {myPack.both_confirmed_at
                  ? " Both sides have confirmed it."
                  : " Once both you and the client confirm it, they can choose you for the job."}
              </p>
              <Link
                href={"/portal/jobs/" + encodeURIComponent(tender.id) + "/pack"}
                className="mt-3 inline-block rounded-full bg-linear-to-r from-teal to-mango px-4 py-2 text-[13px] font-bold text-onbrand"
              >
                Read the Kickoff Pack &rarr;
              </Link>
              {/* A button here is exactly the surface CLAUDE.md §9 rules
                  out for a worker. Confirming is a WhatsApp reply, same
                  message that told them the pack was ready. */}
              {!myPack.both_confirmed_at && (
                <p className="mt-3 text-[13px] leading-relaxed text-mute">
                  Reply to Yaadly&apos;s WhatsApp message with{" "}
                  <b className="font-mono text-ink">{tender.id}</b> to confirm your side.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
