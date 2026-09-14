/**
 * What an invoice on a job is called, in the job room.
 *
 * Since the principal structure (3 Sep 2026) the client's invoice on a job is
 * one bill for the whole job: the labour, Yaadly's 15% Guarantee & Support
 * line and materials at cost (raise_job_client_invoice). The room still
 * called every invoice payable to Yaadly "Yaadly Guarantee & Support fee",
 * so a J$134,250 bill read as a J$134,250 fee. Found by the founder on the
 * verandah job, 14 Sep 2026.
 *
 * A part requested from a bill (20260913233000) is its own numbered invoice,
 * and says so, so a client paying a part knows the rest of the bill exists.
 */

export type LabelledInvoice = {
  payable_to: string | null;
  stage: number | null;
  starts_job?: boolean | null;
  part_of?: string | null;
};

export function invoiceLabel(inv: LabelledInvoice): string {
  if (inv.payable_to === "worker") {
    return "Worker pay" + (inv.stage != null ? " · stage " + inv.stage : "");
  }
  if (inv.part_of) return "Part of the job bill";
  if (inv.stage != null) return "Job bill · stage " + inv.stage;
  if (inv.starts_job) return "Job bill";
  return "Yaadly invoice";
}
