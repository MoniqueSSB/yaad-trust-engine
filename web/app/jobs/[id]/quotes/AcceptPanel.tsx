"use client";

/* Accepting is the booking, and booking is the moment the account is required.
 *
 * So this does one of two things depending on who is holding the phone. A
 * client already signed in books it here, in one press. A client with no
 * account is sent to the claim page carrying the job, the code and the quote,
 * makes the account there, and the quote is accepted on the way back.
 *
 * Either way accept_quote_as_me is the thing that decides, and it refuses
 * anybody who is not this job's client. Holding the link is enough to look at
 * prices and never enough to book one. */

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
        // No account yet. This is the booking moment, so it is where the
        // account is asked for, and not one screen earlier.
        const next = new URLSearchParams({ job: jobId, code, quote: quoteId });
        router.push(`/portal/join?${next.toString()}`);
        return;
      }

      const { error: rpcErr } = await supabase.rpc("accept_quote_as_me", { p_quote: quoteId });
      if (rpcErr) throw new Error(rpcErr.message);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not book that quote.");
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 border-t border-line pt-4">
      <button
        type="button"
        onClick={accept}
        disabled={busy}
        className="rounded-full bg-linear-to-r from-teal to-mango px-5 py-2.5 text-[13px] font-bold text-[#04211D] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? "Booking…" : `Book ${workerName}`}
      </button>
      <p className="mt-2 text-[12px] leading-relaxed text-dim">
        This is the point an account is set up, because it is the point one
        starts earning its keep: approving the evidence, holding the invoice,
        and carrying the record of this property between jobs.
      </p>
      {error && <p className="mt-2 text-[13px] text-coral">{error}</p>}
    </div>
  );
}
