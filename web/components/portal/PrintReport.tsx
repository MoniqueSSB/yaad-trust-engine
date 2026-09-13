"use client";

/**
 * "Save or print this report."
 *
 * The Completion Report is the artefact a client keeps: assembled from the
 * job's own record, carrying the evidence index and its fingerprints, with
 * section 6 legally load bearing. It lived only as a web page behind a login,
 * so there was nothing to file, nothing to hand to a lender or an insurer, and
 * nothing at all if the account ever lapsed.
 *
 * window.print() plus the @media print block in globals.css is the whole fix.
 * Every browser and every phone can already turn that into a PDF, which is
 * better than a PDF pipeline this project would then have to own, and it
 * cannot drift from what the page says because it IS what the page says.
 *
 * A Client Component only because window.print() needs a browser. It renders
 * nothing when printing, so the button never appears on the paper.
 */
export function PrintReport() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-full border border-line2 px-4 py-2 text-[12.5px] font-bold text-mute transition hover:border-purple hover:text-purpleb print:hidden"
    >
      Save or print this report
    </button>
  );
}
