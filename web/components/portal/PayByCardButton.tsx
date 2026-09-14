"use client";

import { useState } from "react";
import { startCardPayment } from "@/app/portal/pay-actions";

/**
 * "Pay by card" on an unpaid invoice in the client portal.
 *
 * Asks yaad-checkout (through a server action) for a Stripe payment page for
 * exactly this invoice, then goes there. If the server refuses, its own
 * sentence is shown rather than a silent nothing: "already paid", "not one
 * of yours", "card payment is not switched on yet" are all answers a client
 * should read. Phase 1 of card payment, 14 Sep 2026.
 */
export function PayByCardButton({ invoiceId, amountLabel }: { invoiceId: string; amountLabel: string }) {
  const [state, setState] = useState<"idle" | "busy">("idle");
  const [err, setErr] = useState<string | null>(null);

  return (
    <div className="mt-2.5">
      <button
        type="button"
        disabled={state === "busy"}
        onClick={async () => {
          setErr(null);
          setState("busy");
          const out = await startCardPayment(invoiceId);
          if (out.ok) {
            window.location.href = out.url;
            return;
          }
          setErr(out.error);
          setState("idle");
        }}
        className="rounded-full bg-gold px-4 py-2 text-[12.5px] font-bold text-bg transition hover:opacity-90 disabled:opacity-60"
      >
        {state === "busy" ? "Opening the payment page..." : "Pay " + amountLabel + " by card"}
      </button>
      {err && <p className="mt-1.5 text-[12px] leading-relaxed text-coral">{err}</p>}
    </div>
  );
}
