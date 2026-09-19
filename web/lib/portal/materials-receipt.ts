/**
 * Where the materials receipt has got to: still to come from the worker, or
 * filed by them and with Yaadly.
 *
 * Since 20260914112000 materials money goes out before the goods are bought
 * and the receipt comes back afterwards. A released row with a blank
 * receipt_ref is a receipt still to come, and only a person at Yaadly writes
 * receipt_ref, through record_materials_receipt().
 *
 * Founder, 19 Sep 2026. Read off receipt_ref alone, the worker's row in the
 * outstanding list said "Send the materials receipt and a photo" for as long
 * as the desk had not typed the reference in, including after the worker had
 * uploaded the receipt under Files. So the one person the row was addressed
 * to had already done the only thing it asked of them, could see their own
 * file on the page, and had no way to make the row stop asking. This module
 * separates the two states the worker actually experiences: due from them,
 * or filed and waiting on somebody else.
 *
 * NO GATE MOVES HERE, and none may be added. A filed receipt is a file on a
 * job. Recording it against the money is still a named person's decision at
 * the desk, this function releases nothing, approves nothing, pays nothing,
 * and "filed" never becomes "recorded" on its own.
 *
 * Pure, so tests/materials-receipt.test.mjs can hold it without a database.
 */

export type MaterialsRelease = {
  amount_jmd: number | null;
  released_at: string | null;
  /** When the money actually left Yaadly. Null while it is being sent. */
  sent_at: string | null;
  /** The supplier receipt recorded against it. Blank means still to come. */
  receipt_ref: string | null;
};

export type ReceiptFile = {
  /** "worker" or "client". */
  side: string | null;
  /** One of FILE_KINDS in lib/portal/job-files. */
  kind: string | null;
  created_at: string | null;
};

export type MaterialsReceipt =
  /** Nothing has been sent that a receipt is owed on. */
  | { state: "none" }
  /** Money reached the worker, no receipt on the job yet. */
  | { state: "due"; jmd: number }
  /** The worker has filed a receipt. Yaadly records it against the money. */
  | { state: "filed"; jmd: number; filedAt: string };

export function materialsReceipt(
  releases: MaterialsRelease[],
  files: ReceiptFile[],
): MaterialsReceipt {
  /* Released AND sent. A release that has not been sent is not owed a
     receipt: nobody can buy goods with money that has not reached them. */
  const due = releases.filter(
    (m) => m.released_at && m.sent_at && !(m.receipt_ref ?? "").trim(),
  );
  if (due.length === 0) return { state: "none" };

  const jmd = due.reduce((t, m) => t + Number(m.amount_jmd ?? 0), 0);

  /* The earliest moment money reached the worker on an unaccounted release.
     A receipt filed before that cannot be the receipt for it, so it does not
     close the row: a quote or an old receipt uploaded last week is not proof
     of what today's money bought. */
  const sentTimes = due
    .map((m) => Date.parse(m.sent_at ?? ""))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  const firstSent = sentTimes.length ? sentTimes[0] : null;

  const filed = files
    .filter((f) => f.kind === "receipt" && f.side === "worker" && f.created_at)
    .map((f) => ({ at: Date.parse(f.created_at ?? ""), created_at: f.created_at as string }))
    .filter((x) => Number.isFinite(x.at) && (firstSent === null || x.at >= firstSent))
    .sort((a, b) => a.at - b.at)[0];

  return filed
    ? { state: "filed", jmd, filedAt: filed.created_at }
    : { state: "due", jmd };
}
