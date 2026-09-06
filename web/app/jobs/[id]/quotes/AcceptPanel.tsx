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
}: {
  jobId: string;
  code: string;
  quoteId: string;
  workerName: string;
}) {
  const router = useRouter();
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
    try {
      const supabase = createClient();
      const { data: auth } = await supabase.auth.getUser();

      if (!auth?.user) {
        // No account yet. Agreeing a price with a named worker is the moment
        // real terms begin, so it is where the account is asked for, and not
        // one screen earlier.
        const next = new URLSearchParams({ job: jobId, code, quote: quoteId, want: mode });
        router.push(`/portal/join?${next.toString()}`);
        return;
      }

      const { error: rpcErr } = mode === "pack"
        ? await supabase.rpc("request_kickoff_as_me", { p_quote: quoteId })
        : await supabase.rpc("agree_quote_as_me", { p_quote: quoteId });
      if (rpcErr) throw new Error(rpcErr.message);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not go through.");
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 border-t border-line pt-4">
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
      <p className="mt-2 text-[12px] font-bold leading-relaxed text-ink">
        This does not book {workerName} on its own. {workerName} confirms the
        same price from their side, and then you choose. You can accept more
        than one price and compare before you choose.
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
          confirm the pack before anything is booked. It takes longer, and for
          a straightforward repair the quote and its scope summary usually say
          enough.
        </p>
      </div>
      {error && <p className="mt-2 text-[13px] text-coral">{error}</p>}
    </div>
  );
}
