"use client";

import { useState } from "react";

/**
 * "Download this report as a PDF."
 *
 * The Completion Report is the artefact a client keeps: assembled from the
 * job's own record, carrying the evidence index and its fingerprints, with
 * section 6 legally load bearing. It lived only as a web page behind a login,
 * so there was nothing to file, nothing to hand to a lender or an insurer, and
 * nothing at all if the account ever lapsed.
 *
 * Until 28 Sep 2026 this button was window.print(), on the reasoning that
 * every browser can already save a PDF and a PDF maker is one more thing to
 * own. Monique asked for a real PDF, the same as invoices in the desk, so the
 * button now makes one file, A4, named after the job, in one tap. It is made
 * in the browser from the page on screen, so it still cannot drift from what
 * the page says, and nothing is sent anywhere. See DECISIONS.md, 28 Sep 2026.
 *
 * The page is dark; paper is not. The PDF is drawn from a copy of the page
 * with the .pdf-render class on it, which swaps in the light tokens from
 * globals.css and drops everything marked print:hidden (this button, the
 * back link). If the PDF cannot be made, it says so and falls back to the
 * browser's print dialog, which uses the same light tokens.
 *
 * The library is loaded on the tap, not with the page, so nobody who never
 * presses the button downloads it.
 */
export function PrintReport({ jobId, targetId }: { jobId: string; targetId: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function download() {
    const el = document.getElementById(targetId);
    if (!el) return;
    setBusy(true);
    setErr("");
    try {
      const { default: html2pdf } = await import("html2pdf.js");
      if (document.fonts) await document.fonts.ready;
      // html2pdf() with no element hands back its chainable worker; the
      // library's own types cannot tell the two overloads apart.
      const worker = html2pdf() as unknown as InstanceType<typeof html2pdf.Worker>;
      await worker
        .set({
          margin: [12, 12, 14, 12],
          filename: `Completion Report ${jobId}.pdf`,
          image: { type: "jpeg", quality: 0.95 },
          html2canvas: {
            scale: 2,
            backgroundColor: "#ffffff",
            onclone: (doc: Document) => {
              doc.documentElement.classList.add("pdf-render");
            },
          },
          jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
          // Keep a record and its fingerprint on one sheet, as print does.
          pagebreak: { mode: ["css", "legacy"], avoid: ["li", "h2"] },
        } as Parameters<typeof worker.set>[0])
        .from(el)
        .save();
    } catch {
      setErr("The PDF could not be made here. Opening the print dialog instead: choose Save as PDF.");
      window.print();
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="flex flex-col items-end gap-1 print:hidden">
      <button
        type="button"
        onClick={download}
        disabled={busy}
        className="rounded-full border border-line2 px-4 py-2 text-[12.5px] font-bold text-mute transition hover:border-purple hover:text-purpleb disabled:opacity-60 print:hidden"
      >
        {busy ? "Making the PDF…" : "Download PDF"}
      </button>
      {err && <span className="text-[11.5px] text-coral">{err}</span>}
    </span>
  );
}
