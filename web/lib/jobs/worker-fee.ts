/**
 * Yaadly's margin on the worker's side, for the screen.
 *
 * Founder, 4 Oct 2026 (supabase/migrations/20261004150246): 7% for work
 * agreed from then on, 5% for work agreed before it, because a price agreed
 * in writing never moves afterwards. The database decides which applies in
 * public.worker_fee_rate(), reading app_settings.worker_fee_7pc_from, and
 * raises every worker payable with it. That function is not callable by a
 * signed-in worker, so this file mirrors it for display only. It never
 * raises, moves or changes any money.
 *
 * WORKER_FEE_7PC_FROM is the live value of app_settings.worker_fee_7pc_from,
 * read on 20 Oct 2026: 2026-10-04 00:00:00+00. The migration says it is set
 * once and never moved. If it ever is, change it here in the same change, or
 * the page and the pay invoice disagree.
 *
 * What counts as "agreed": a quote's created_at (raise_job_worker_payable,
 * raise_job_stage_worker_payable), and an add-on's agreed_at, else its
 * created_at (_sign_off_addon). No date means new work, so the current rate.
 */

/** The rate for work agreed today. */
export const WORKER_FEE_RATE = 0.07;
/** The rate for work agreed before WORKER_FEE_7PC_FROM. */
export const WORKER_FEE_RATE_BEFORE = 0.05;
/** app_settings.worker_fee_7pc_from, as live. */
export const WORKER_FEE_7PC_FROM = "2026-10-04T00:00:00Z";

const SWITCH_MS = Date.parse(WORKER_FEE_7PC_FROM);

/** The worker-side rate for work agreed at this moment, as worker_fee_rate() decides it. */
export function workerFeeRate(agreedAt?: string | null): number {
  if (!agreedAt) return WORKER_FEE_RATE;
  const t = Date.parse(agreedAt);
  if (Number.isNaN(t)) return WORKER_FEE_RATE;
  return t < SWITCH_MS ? WORKER_FEE_RATE_BEFORE : WORKER_FEE_RATE;
}

/** The rate as the page writes it: "7%" or "5%". */
export function workerFeePct(rate: number): string {
  return Math.round(rate * 100) + "%";
}
