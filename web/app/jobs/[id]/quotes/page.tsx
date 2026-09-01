import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AcceptPanel } from "./AcceptPanel";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Your quotes · Yaadly",
  description: "The quotes on your job, with labour split from materials.",
};

const money = (n: number | null) =>
  n == null ? "" : "J$" + Number(n).toLocaleString("en-JM");

/* ── Your quotes, with no account ──────────────────────────────────────────
 *
 * "No account to get quotes, an account once a job is booked." Quotes lived
 * only inside the portal, which is behind auth, so the first half of that was
 * not true: a client had to make an account before seeing a single price.
 *
 * The job code is the bearer token, the same secret the WhatsApp link already
 * rides on. Holding it is enough to LOOK. It is never enough to move a quote
 * forward: request_kickoff_as_me refuses anybody who is not the job's
 * signed-in client, so even asking for a Kickoff Pack needs the account and
 * the account still needs the code. A client can do this for more than one
 * quote; nothing here books a worker, only choosing one later does.
 */
export default async function Quotes({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ code?: string }>;
}) {
  const { id } = await params;
  const { code } = await searchParams;
  if (!code) notFound();

  const supabase = await createClient();
  const [{ data: jobRows }, { data: quoteRows }] = await Promise.all([
    supabase.rpc("job_for_code", { p_job: id, p_code: code }),
    supabase.rpc("quotes_for_code", { p_job: id, p_code: code }),
  ]);

  const job = (jobRows ?? [])[0];
  if (!job) notFound();

  const quotes = (quoteRows ?? []) as {
    id: string; worker_name: string; labour_jmd: number; materials_jmd: number;
    materials_at_cost: boolean; earliest_start: string; days_estimate: string;
    note: string; status: string;
  }[];

  const booked = String(job.worker_email ?? "") !== "";

  return (
    <div className="mx-auto max-w-[1080px] px-5 py-10">
      <p className="text-[10.5px] font-bold uppercase tracking-[.2em] text-mango">Your quotes</p>
      <h1 className="mt-2 font-display text-[clamp(28px,5vw,52px)] uppercase leading-[.95]">
        {job.title}
      </h1>
      <p className="mt-3 max-w-[62ch] text-[14px] text-mute">
        {job.parish} · <span className="font-mono text-[12.5px]">{job.id}</span>
      </p>

      {quotes.length === 0 && (
        <div className="mt-6 max-w-[62ch] rounded-2xl border border-line bg-panel p-6 text-[14.5px] leading-relaxed text-mute">
          <b className="text-ink">No quotes on this job yet.</b>
          <p className="mt-2">
            Monique reads every job herself and comes back within one working
            day. When a price lands it appears on this page, and the link keeps
            working, so keep it.
          </p>
        </div>
      )}

      {quotes.length > 0 && (
        <>
          <p className="mt-6 max-w-[62ch] text-[14.5px] leading-relaxed text-mute">
            <b className="text-ink">Labour is split from materials</b>, and
            materials are passed through at cost with the receipt filed against
            your job. Nothing here is charged. Ask for a Kickoff Pack from
            more than one worker if you want to compare, and{" "}
            <b className="text-ink">nothing is booked until you choose one.</b>
          </p>

          <div className="mt-5 grid max-w-[62ch] gap-3">
            {quotes.map((q) => {
              const total = (q.labour_jmd ?? 0) + (q.materials_jmd ?? 0);
              const isAccepted = q.status === "accepted";
              const kickoffRequested = q.status === "kickoff_requested";
              return (
                <div key={q.id}
                  className={"rounded-2xl border p-5 " + (isAccepted ? "border-teal bg-soft" : "border-line bg-panel")}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <b className="text-[16px]">{q.worker_name}</b>
                      <p className="mt-1 text-[12.5px] text-dim">
                        {q.earliest_start ? `Can start ${q.earliest_start}` : "Start date to confirm"}
                        {q.days_estimate ? ` · about ${q.days_estimate}` : ""}
                      </p>
                    </div>
                    {isAccepted && (
                      <span className="rounded-full border border-softline bg-soft px-3 py-1 text-[11px] font-bold text-tealb">
                        Booked
                      </span>
                    )}
                    {kickoffRequested && (
                      <span className="rounded-full border border-line bg-panel2 px-3 py-1 text-[11px] font-bold text-mute">
                        Kickoff Pack requested
                      </span>
                    )}
                  </div>

                  <div className="mt-4 grid gap-1.5 text-[13.5px]">
                    <div className="flex justify-between gap-4">
                      <span className="text-mute">Labour</span>
                      <span className="font-mono">{money(q.labour_jmd)}</span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-mute">
                        Materials{q.materials_at_cost ? ", at cost" : ""}
                      </span>
                      <span className="font-mono">{money(q.materials_jmd)}</span>
                    </div>
                    <div className="mt-1 flex justify-between gap-4 border-t border-line pt-2 font-bold">
                      <span>Total</span>
                      <span className="font-mono">{money(total)}</span>
                    </div>
                  </div>

                  {q.note && (
                    <p className="mt-3 text-[13px] leading-relaxed text-mute">{q.note}</p>
                  )}

                  {!booked && q.status === "submitted" && (
                    <AcceptPanel jobId={job.id} code={code} quoteId={q.id} workerName={q.worker_name} />
                  )}
                  {!booked && kickoffRequested && (
                    <p className="mt-4 border-t border-line pt-4 text-[13px] leading-relaxed text-mute">
                      {q.worker_name} is writing their Kickoff Pack. Sign in to
                      your portal to read it, confirm it, and choose between
                      quotes once more than one is ready.{" "}
                      <Link href="/portal" className="font-bold text-tealb">
                        Open your portal &rarr;
                      </Link>
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {booked && (
        <div className="mt-6 max-w-[62ch] rounded-2xl border border-softline bg-soft p-6 text-[14.5px] leading-relaxed text-mute">
          <b className="text-ink">This job is booked.</b>
          <p className="mt-2">
            Everything from here runs in your portal: the written scope, the
            evidence at each stage, and your approval before anybody is paid
            for one.
          </p>
          <Link href="/portal" className="mt-3 inline-block font-bold text-tealb">
            Open your portal &rarr;
          </Link>
        </div>
      )}
    </div>
  );
}
