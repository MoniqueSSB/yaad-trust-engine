"use client";

import { useState } from "react";
import { invoicePdf } from "@/app/portal/invoice-pdf-actions";

/** "PDF" beside an invoice in the portal: the same file the invoice email
 *  carries, drawn by yaad-invoice (28 Sep 2026). Nothing is changed by it. */
export function InvoicePdfButton({ invoiceId }: { invoiceId: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function go() {
    setBusy(true);
    setErr("");
    const out = await invoicePdf(invoiceId);
    setBusy(false);
    if (!out.ok) { setErr(out.error); return; }
    const bytes = Uint8Array.from(atob(out.pdf), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = out.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  return (
    <span className="inline-flex flex-col">
      <button
        type="button"
        onClick={go}
        disabled={busy}
        className="rounded-full border border-line2 px-3 py-1 text-[11.5px] font-bold text-mute transition hover:border-teal hover:text-tealb disabled:opacity-60"
      >
        {busy ? "Making the PDF…" : "Download PDF"}
      </button>
      {err && <span className="mt-1 text-[11.5px] text-coral">{err}</span>}
    </span>
  );
}
