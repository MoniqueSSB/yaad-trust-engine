"use client";

import { useState } from "react";
import { startPayoutSetup } from "@/app/portal/payout-actions";

/**
 * Opens Stripe's own form, where a worker types the bank details Yaadly pays
 * them into. The link is made fresh on the tap, because Stripe's is single use
 * and lasts ten minutes. If the server refuses, its own sentence is shown.
 */
export function PayoutSetupButton({ label }: { label: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  return (
    <div className="mt-3">
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setErr(null);
          setBusy(true);
          const out = await startPayoutSetup();
          if (out.ok) {
            window.location.href = out.url;
            return;
          }
          setErr(out.error);
          setBusy(false);
        }}
        className="rounded-full bg-linear-to-r from-teal to-mango px-4 py-2.5 text-[12.5px] font-bold text-onbrand disabled:opacity-40"
      >
        {busy ? "Opening Stripe..." : label}
      </button>
      {err && <p role="alert" className="mt-2 text-[12.5px] leading-relaxed text-coral">{err}</p>}
    </div>
  );
}
