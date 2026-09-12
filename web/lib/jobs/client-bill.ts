/**
 * The client's all-in price for a managed job, built the way the invoice is.
 *
 * raise_job_client_invoice (migration 20260903a) charges: the work at the
 * worker's labour price, plus Yaadly's Guarantee & Support fee at 15% of the
 * labour only, plus materials at cost with nothing added. This is that sum,
 * in one place, so every client-facing surface shows the number the invoice
 * will carry. Until 9 September 2026 the no-account quotes page showed
 * labour plus materials with no fee on it, and a client who accepted
 * J$100,000 there was billed J$115,000.
 *
 * If the invoice function's arithmetic changes, change this with it, or the
 * page and the bill disagree again. The 15% is the locked client-side fee
 * (BridgeWorks_Ideas_Ledger, 9 Sep 2026 entry); the worker's 5% is not the
 * client's business and does not appear here.
 */
export const CLIENT_FEE_RATE = 0.15;

export type ClientBill = { labour: number; fee: number; materials: number; total: number };

export function clientBill(labourJmd: number | null | undefined, materialsJmd: number | null | undefined): ClientBill {
  const labour = Math.round(Number(labourJmd) || 0);
  const materials = Math.round(Number(materialsJmd) || 0);
  const fee = Math.round(labour * CLIENT_FEE_RATE);
  return { labour, fee, materials, total: labour + fee + materials };
}
