"use client";

/* Accepting used to BE the booking. Founder's own correction, 1 Sep 2026,
 * live: a client can accept more than one quote. Each accepted worker
 * writes a Kickoff Pack against their own price, the client compares the
 * documents, and only choosing one afterward books the job. So this
 * requests a Kickoff Pack, nothing more.
 *
 * Either way one of two things happens depending on who is holding the
 * phone. A client already signed in requests it here, in one press. A
 * client with no account is sent to the claim page carrying the job, the
 * code and the quote, makes the account there, and the request goes through
 * on the way back.
 *
 * Either way request_kickoff_as_me is the thing that decides, and it
 * refuses anybody who is not this job's client. Holding the link is enough
 * to look at prices and never enough to move one forward. */

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function AcceptPanel({
  jobId,
  code,
  quoteId,
  workerName,
  check = null,
}: {
  jobId: string;
  code: string;
  quoteId: string;
  workerName: string;
  /** The Visual Check as an optional line on this quote, every figure
   *  already formatted by the page from the catalogue. Null hides it. */
  check?: { price: string; fullPrice: string | null; adds: string; total: string; rate: string } | null;
}) {
  const router = useRouter();
  /* Unticked to start, always. Approving from the evidence yourself is the
     default and costs nothing; the check is something a client adds. */
  const [addCheck, setAddCheck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Two doors, and which one is the DEFAULT is the whole point of this file.
  //
  // Until 4 September 2026 there was one button and it called
  // request_kickoff_as_me, so accepting a price always ordered a ten section
  // project pack, on a £300 repair as much as on a renovation. The booking
  // gate never required that: _do_choose_worker books on quote_confirmed with
  // no pack anywhere. The pack was optional in the database and mandatory in
  // practice, because the portal had nothing else to call.
  //
  // Founder's instruction: take the pack out of the flow and offer it as an
  // addition where somebody wants project documentation. So confirming the
  // price is the plain button, and the pack is the second, quieter one.
  async function run(mode: "price" | "pack") {
    setError("");
    setBusy(true);
    // Only on the plain price route. A Kickoff Pack books nobody, and the
    // database refuses a check before a worker is on the job.
    const wantsCheck = mode === "price" && !!check && addCheck;
    try {
      const supabase = createClient();
      const { data: auth } = await supabase.auth.getUser();

      if (!auth?.user) {
        // No account yet. Agreeing a price with a named worker is the moment
        // real terms begin, so it is where the account is asked for, and not
        // one screen earlier.
        const next = new URLSearchParams({ job: jobId, code, quote: quoteId, want: mode });
        if (wantsCheck) next.set("check", "visual");
        router.push(`/portal/join?${next.toString()}`);
        return;
      }

      const { error: rpcErr } = mode === "pack"
        ? await supabase.rpc("request_kickoff_as_me", { p_quote: quoteId })
        : await supabase.rpc("agree_quote_as_me", { p_quote: quoteId });
      if (rpcErr) throw new Error(rpcErr.message);

      // The price is agreed, so the worker is booked. Only now is the check
      // added, by the same choose_job_check() the portal's Approvals box
      // calls. A refusal never undoes the booking: the client is taken to
      // that box, where the check can still be added.
      if (wantsCheck) {
        const { error: checkErr } = await supabase.rpc("choose_job_check", { p_job: jobId, p_level: "visual" });
        if (checkErr) {
          router.push(`/portal/jobs/${encodeURIComponent(jobId)}?tab=approvals#check`);
          return;
        }
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not go through.");
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 border-t border-line pt-4">
      {check && (
        <label className="mb-3 flex cursor-pointer items-start gap-2.5 rounded-xl border border-line bg-bg px-3.5 py-3">
          <input
            type="checkbox"
            checked={addCheck}
            onChange={(e) => setAddCheck(e.target.checked)}
            disabled={busy}
            className="mt-1 accent-teal"
          />
          <span className="text-[12.5px] leading-relaxed text-dim">
            <b className="text-ink">Add a Visual Check</b>, optional:{" "}
            <span className="font-semibold text-tealb">
              {check.fullPrice && (
                <>
                  <s className="font-normal text-dim">{check.fullPrice}</s>{" "}
                </>
              )}
              {check.price}
            </span>
            . Somebody independent of {workerName} attends the finished work and
            files what they saw. It is a record for your sign-off, not a ruling:
            you still approve yourself. Adds {check.adds} at {check.rate}, so
            this job comes to <b className="text-ink">{check.total}</b>. Yaadly
            invoices the check in pounds, separately from the job.
          </span>
        </label>
      )}
      <button
        type="button"
        onClick={() => run("price")}
        disabled={busy}
        className="rounded-full bg-linear-to-r from-teal to-mango px-5 py-2.5 text-[13px] font-bold text-onbrand transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? "Sending…" : `Accept this price from ${workerName}`}
      </button>
      <p className="mt-2 text-[12px] leading-relaxed text-dim">
        This is the point an account is set up, because it is the point one
        starts earning its keep: approving the evidence, holding the invoice,
        and carrying the record of this property between jobs.
      </p>
      {/* Founder, 9 Sep 2026: "the only person that needs to accept is the
          client." The worker's quote is their word on the price, so this
          button books. It used to say the worker would confirm too and the
          client could accept more than one; both were true for one week. */}
      <p className="mt-2 text-[12px] font-bold leading-relaxed text-ink">
        This books {workerName} at this price. Nothing is charged until your
        invoice from Yaadly arrives, and nothing starts until it is paid.
        Other quotes on this job stop being available once you accept.
      </p>

      {/* The pack, as an addition rather than the route. Founder's
          instruction, 4 Sep 2026. Deliberately the quieter control: most
          repairs do not want a ten section project document, and the ones
          that do are usually renovations where somebody asks for it by
          name. */}
      <div className="mt-4 border-t border-line pt-3">
        <button
          type="button"
          onClick={() => run("pack")}
          disabled={busy}
          className="text-[12.5px] font-bold text-tealb underline underline-offset-2 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Ask for full project documentation first
        </button>
        <p className="mt-1.5 text-[12px] leading-relaxed text-dim">
          For bigger work. {workerName} writes a Kickoff Pack against their own
          price: scope of works, what is and is not included, the programme,
          the payment stages and what evidence proves each one. Both of you
          confirm the pack before anything is booked, because it is new terms
          rather than the price they already gave. It takes longer, and for
          a straightforward repair the quote and its scope summary usually say
          enough.
        </p>
      </div>
      {error && <p className="mt-2 text-[13px] text-coral">{error}</p>}
    </div>
  );
}
