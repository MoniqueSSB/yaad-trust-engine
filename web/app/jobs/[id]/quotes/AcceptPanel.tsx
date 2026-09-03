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

  async function accept() {
    setError("");
    setBusy(true);
    try {
      const supabase = createClient();
      const { data: auth } = await supabase.auth.getUser();

      if (!auth?.user) {
        // No account yet. Requesting a Kickoff Pack is the moment real
        // terms with a real worker begin, so it is where the account is
        // asked for, and not one screen earlier.
        const next = new URLSearchParams({ job: jobId, code, quote: quoteId });
        router.push(`/portal/join?${next.toString()}`);
        return;
      }

      const { error: rpcErr } = await supabase.rpc("request_kickoff_as_me", { p_quote: quoteId });
      if (rpcErr) throw new Error(rpcErr.message);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not request that Kickoff Pack.");
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 border-t border-line pt-4">
      <button
        type="button"
        onClick={accept}
        disabled={busy}
        className="rounded-full bg-linear-to-r from-teal to-mango px-5 py-2.5 text-[13px] font-bold text-onbrand transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? "Requesting…" : `Get a Kickoff Pack from ${workerName}`}
      </button>
      <p className="mt-2 text-[12px] leading-relaxed text-dim">
        This is the point an account is set up, because it is the point one
        starts earning its keep: reading the Kickoff Pack, approving the
        evidence, holding the invoice, and carrying the record of this
        property between jobs.
      </p>
      {/* Founder's own point, 1 Sep 2026: this button asks {workerName} to
          write a Kickoff Pack against their own price. It books nothing.
          You can do this for more than one quote and compare the documents
          side by side; choosing one, once both sides have confirmed its
          pack, is what actually books the job. */}
      <p className="mt-2 text-[12px] font-bold leading-relaxed text-ink">
        This does not book {workerName}. It asks them to write a Kickoff
        Pack, the scope of work and payment terms, against their own price.
        You can do this for other quotes too and compare before you choose.
      </p>
      {error && <p className="mt-2 text-[13px] text-coral">{error}</p>}
    </div>
  );
}
