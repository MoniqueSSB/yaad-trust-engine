import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AcceptPanel } from "./AcceptPanel";
import { jmdOrBlank as money } from "@/lib/money";
import { clientBill } from "@/lib/jobs/client-bill";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Your quotes · Yaadly",
  description: "The quotes on your job, with the full price you would pay Yaadly.",
};



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
 *
 * ── Two things changed on 9 September 2026 ──
 *
 * THE PRICE IS THE PRICE ON THE INVOICE. Until now this page showed the
 * worker's own labour figure and a total with no fee on it, and the invoice
 * then charged labour plus Yaadly's 15%. The client agreement promises the
 * fee is itemised before anybody agrees to anything, and the portal promised
 * "you will see the full price, including Yaadly's 15% fee, before anything
 * is agreed". This page broke both. Founder's instruction, 9 Sep 2026: "fix
 * this so it is clear what people are paying." The arithmetic is
 * lib/jobs/client-bill.ts, the same shape as raise_job_client_invoice.
 *
 * WHO PICKS. A client who asked Yaadly to pick (jobs.worker_choice =
 * 'yaadly', the default) sees no quotes at all until a named person at
 * Yaadly recommends one; the database hides the rest (quotes_for_code and
 * the RLS policy both apply client_may_see_quote). What they then see is one
 * price, marked as Yaadly's choice with the reason on it, and the same Accept
 * button. A client who asked to choose sees every quote, as before.
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

  /* A missing code is still notFound(): a bare /jobs/<id>/quotes with nothing
     after it is somebody guessing, and confirming the job exists would be the
     one thing worth telling them. A code that is PRESENT and wrong is a
     different person with a different problem, and gets a different answer
     below: almost always a client who copied the link out of WhatsApp and
     lost a character off the end. */
  if (!code) notFound();

  const supabase = await createClient();
  const [{ data: jobRows }, { data: quoteRows }] = await Promise.all([
    supabase.rpc("job_for_code", { p_job: id, p_code: code }),
    supabase.rpc("quotes_for_code", { p_job: id, p_code: code }),
  ]);

  const job = (jobRows ?? [])[0];
  if (!job) {
    /* Deliberately says nothing about whether the job exists. It reads the
       same for a mistyped code on a real job and for a job id invented out of
       thin air, which is what stops this page confirming ids to somebody
       working through them. What it does do is give the person a way out,
       which a bare 404 did not. */
    return (
      <div className="mx-auto max-w-[620px] px-5 py-16">
        <p className="text-[10.5px] font-bold uppercase tracking-[.2em] text-tealb">Your quotes</p>
        <h1 className="mt-2 font-display text-[clamp(26px,4vw,38px)] uppercase leading-none">
          That link did not open
        </h1>
        <p className="mt-3.5 text-[14.5px] leading-relaxed text-mute">
          The code on the end of it is not one we recognise for this job. The
          commonest cause is a character lost when the link was copied out of a
          message, so it is worth opening the original again rather than
          retyping it.
        </p>
        <p className="mt-3 text-[13.5px] leading-relaxed text-dim">
          Still not working? Reply to the WhatsApp thread the link came from and
          a person will send a fresh one. Nothing about your job is lost.
        </p>
      </div>
    );
  }

  const quotes = (quoteRows ?? []) as {
    id: string; worker_name: string; labour_jmd: number; materials_jmd: number;
    materials_at_cost: boolean; earliest_start: string; days_estimate: string;
    note: string; status: string;
    scope_summary: string | null; timeline_note: string | null; payment_stage_note: string | null;
    included_note: string | null; excluded_note: string | null;
    recommended_at: string | null; recommended_by: string | null; recommended_reason: string | null;
  }[];

  const booked = String(job.worker_email ?? "") !== "";
  const yaadlyPicks = String(job.worker_choice ?? "yaadly") !== "client";
  const eyebrow = yaadlyPicks ? "Your price" : "Your quotes";

  return (
    <div className="mx-auto max-w-[1080px] px-5 py-10">
      {/* Purple, like every other public page's eyebrow. This was the only
          one in gold, with no rule behind the difference. */}
      <p className="text-[10.5px] font-bold uppercase tracking-[.2em] text-tealb">{eyebrow}</p>
      <h1 className="mt-2 font-display text-[clamp(28px,5vw,52px)] uppercase leading-[.95]">
        {job.title}
      </h1>
      <p className="mt-3 max-w-[62ch] text-[14px] text-mute">
        {job.parish} · <span className="font-mono text-[12.5px]">{job.id}</span>
      </p>

      {quotes.length === 0 && !booked && yaadlyPicks && (
        <div className="mt-6 max-w-[62ch] rounded-2xl border border-line bg-panel p-6 text-[14.5px] leading-relaxed text-mute">
          <b className="text-ink">Yaadly is choosing your tradesperson.</b>
          <p className="mt-2">
            You asked us to pick. A few vetted tradespeople in your parish are
            being asked to quote, a person at Yaadly reads every quote against
            what the job needs, and then you get one price on this page, with
            the reason Yaadly chose them.
          </p>
          <p className="mt-2">
            Nothing is booked and nothing is charged until you agree that
            price. The link keeps working, so keep it. If you would rather see
            every quote and choose yourself, reply to the WhatsApp thread and
            say so.
          </p>
        </div>
      )}

      {quotes.length === 0 && !booked && !yaadlyPicks && (
        <div className="mt-6 max-w-[62ch] rounded-2xl border border-line bg-panel p-6 text-[14.5px] leading-relaxed text-mute">
          <b className="text-ink">No quotes on this job yet.</b>
          <p className="mt-2">
            A person at Yaadly reads every job and comes back within one working
            day. When a price lands it appears on this page, and the link keeps
            working, so keep it.
          </p>
        </div>
      )}

      {quotes.length > 0 && (
        <>
          {yaadlyPicks ? (
            <p className="mt-6 max-w-[62ch] text-[14.5px] leading-relaxed text-mute">
              <b className="text-ink">You asked Yaadly to pick, and a person has.</b>{" "}
              The price below is the whole price you would pay Yaadly: the
              work, Yaadly&rsquo;s 15% Guarantee &amp; Support fee, and materials
              at cost with the receipt filed against your job. You pay Yaadly,
              never the tradesperson.{" "}
              <b className="text-ink">Nothing is booked until you agree it.</b>
            </p>
          ) : (
            <p className="mt-6 max-w-[62ch] text-[14.5px] leading-relaxed text-mute">
              <b className="text-ink">Every price here is the whole price you would pay Yaadly</b>:
              the work, Yaadly&rsquo;s 15% Guarantee &amp; Support fee, and
              materials at cost with the receipt filed against your job. You
              pay Yaadly, never the tradesperson. Nothing here is charged. Ask
              for a Kickoff Pack from more than one worker if you want to
              compare, and{" "}
              <b className="text-ink">nothing is booked until you choose one.</b>
            </p>
          )}

          <div className="mt-5 grid max-w-[62ch] gap-3">
            {quotes.map((q) => {
              const bill = clientBill(q.labour_jmd, q.materials_jmd);
              const isAccepted = q.status === "accepted";
              const kickoffRequested = q.status === "kickoff_requested";
              /* "Chosen by Yaadly", never by a named person. Founder's
                 instruction, 10 Sep 2026: her name comes off the product.
                 The person who chose is still recorded on the quote
                 (recommended_by) for the desk and for a dispute. */
              const chooser = "Yaadly";
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
                    {!isAccepted && q.recommended_at && (
                      <span className="rounded-full border border-softline bg-soft px-3 py-1 text-[11px] font-bold text-tealb">
                        Chosen by {chooser}
                      </span>
                    )}
                    {kickoffRequested && (
                      <span className="rounded-full border border-line bg-panel2 px-3 py-1 text-[11px] font-bold text-mute">
                        Kickoff Pack requested
                      </span>
                    )}
                  </div>

                  {q.recommended_at && (
                    <div className="mt-4 rounded-xl border border-softline bg-soft px-4 py-3 text-[13px] leading-relaxed">
                      <p className="text-[10.5px] font-bold uppercase tracking-[.15em] text-tealb">Why {chooser} chose {q.worker_name}</p>
                      <p className="mt-1 text-mute">
                        {q.recommended_reason?.trim()
                          || `A person at Yaadly read every quote on this job against what it needs and put this one forward.`}
                      </p>
                    </div>
                  )}

                  {/* Three lines and a total, the same three lines the
                      invoice carries. The fee is on the work only, never on
                      materials, and it is shown here before anything is
                      agreed, which is what the client agreement promises. */}
                  <div className="mt-4 grid gap-1.5 text-[13.5px]">
                    <div className="flex justify-between gap-4">
                      <span className="text-mute">The work</span>
                      <span className="font-mono">{money(bill.labour)}</span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-mute">Yaadly&rsquo;s Guarantee &amp; Support, 15% of the work</span>
                      <span className="font-mono">{money(bill.fee)}</span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-mute">
                        Materials{q.materials_at_cost ? ", at cost, nothing added" : ""}
                      </span>
                      <span className="font-mono">{money(bill.materials)}</span>
                    </div>
                    <div className="mt-1 flex justify-between gap-4 border-t border-line pt-2 font-bold">
                      <span>You pay Yaadly</span>
                      <span className="font-mono">{money(bill.total)}</span>
                    </div>
                  </div>

                  {q.note && (
                    <p className="mt-3 text-[13px] leading-relaxed text-mute">{q.note}</p>
                  )}

                  {(q.scope_summary || q.included_note || q.excluded_note || q.timeline_note || q.payment_stage_note) && (
                    <div className="mt-4 grid gap-3 border-t border-line pt-4 text-[13px] leading-relaxed">
                      {q.scope_summary && (
                        <div>
                          <p className="text-[10.5px] font-bold uppercase tracking-[.15em] text-dim">Scope</p>
                          <p className="mt-1 whitespace-pre-wrap text-mute">{q.scope_summary}</p>
                        </div>
                      )}
                      {(q.included_note || q.excluded_note) && (
                        <div className="grid gap-3 sm:grid-cols-2">
                          {q.included_note && (
                            <div>
                              <p className="text-[10.5px] font-bold uppercase tracking-[.15em] text-dim">Included</p>
                              <p className="mt-1 whitespace-pre-wrap text-mute">{q.included_note}</p>
                            </div>
                          )}
                          {q.excluded_note && (
                            <div>
                              <p className="text-[10.5px] font-bold uppercase tracking-[.15em] text-dim">Excluded</p>
                              <p className="mt-1 whitespace-pre-wrap text-mute">{q.excluded_note}</p>
                            </div>
                          )}
                        </div>
                      )}
                      {q.timeline_note && (
                        <div>
                          <p className="text-[10.5px] font-bold uppercase tracking-[.15em] text-dim">Timeline</p>
                          <p className="mt-1 whitespace-pre-wrap text-mute">{q.timeline_note}</p>
                        </div>
                      )}
                      {q.payment_stage_note && (
                        <div>
                          <p className="text-[10.5px] font-bold uppercase tracking-[.15em] text-dim">Payment stages</p>
                          <p className="mt-1 whitespace-pre-wrap text-mute">{q.payment_stage_note}</p>
                        </div>
                      )}
                    </div>
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
