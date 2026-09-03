/**
 * Founder's instruction, 2 Sep 2026: "there should be a place in the portal
 * where they can review the money of jobs and what is pending." Everything
 * in WorkerMoneyPanel is a computed estimate (88% of labour, held or
 * released off whether the whole job is complete); this is the real
 * document trail instead, the actual invoices raised in the worker's own
 * name (20260902n), one row per stage, job by job.
 *
 * "Pending" here means sent and not yet reflected in the worker's own
 * pay_method/pay_ref record on the job (record_pay_info(), the self-report
 * this portal already has). It is not, and cannot be, confirmation that
 * money has moved: nothing in this codebase moves money (CLAUDE.md 9).
 */

import { STATUS_TONE, type StatusLabel } from "./statusTone";
import { jmd } from "@/lib/money";

export type WorkerInvoiceJob = {
  jobId: string;
  jobTitle: string | null;
  paid: boolean; // the worker has recorded how they were paid on this job
  invoices: {
    id: string;
    stage: number | null;
    periodLabel: string;
    totalPence: number;
    status: string;
    sentAt: string | null;
  }[];
};



/**
 * The same four tones the job rows use, so "waiting on somebody" looks the
 * same whether it is a job or an invoice. Before this, "Recorded paid" and
 * "draft" shared one pill, which put the finished thing and the unsent thing
 * in the same colour on the one screen a worker opens to ask whether they
 * have been paid.
 *
 * "Pending" stays carefully worded. It means sent and waiting, and it is not
 * a claim that money has moved: only the worker's own note against the job
 * says that, and nothing in this codebase moves money (CLAUDE.md 9).
 */
function invoiceStatus(status: string, paid: boolean): StatusLabel {
  if (status === "sent" && !paid) return { label: "Pending", tone: "waiting" };
  if (status === "sent") return { label: "Recorded paid", tone: "done" };
  if (status === "draft") return { label: "Draft, not sent", tone: "idle" };
  return { label: status, tone: "idle" };
}

export function WorkerInvoices({ jobs }: { jobs: WorkerInvoiceJob[] }) {
  if (jobs.length === 0) return null;
  return (
    <section className="mt-8">
      <h2 className="mb-1.5 text-[10.5px] font-bold uppercase tracking-[.2em] text-tealb">
        Your invoices
      </h2>
      <p className="mb-3 text-[12px] leading-relaxed text-dim">
        The actual record, raised in your name as each stage was approved. Pending means
        sent and waiting; it is not proof the money has moved, only your own note against
        a job says that.
      </p>
      <ul className="grid gap-3">
        {jobs.map((j) => (
          <li key={j.jobId} className="rounded-2xl border border-line bg-panel p-4">
            <b className="text-[14.5px]">{j.jobTitle ?? j.jobId}</b>
            <ul className="mt-2 grid gap-1.5">
              {j.invoices.map((inv) => (
                /* Two explicit columns rather than a four item wrap. On a
                   narrow screen the flex row broke wherever it ran out of
                   width, which regularly put the amount on one line and the
                   status that qualifies it on the next: J$9,500 reading as
                   settled when the word underneath said Pending. The label
                   spans the top on a phone; the money and its status stay
                   together on the row below, which is the pairing that has
                   to survive. */
                <li
                  key={inv.id}
                  className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1.5 rounded-xl border border-line bg-bg px-3 py-2 text-[12.5px] max-[560px]:grid-cols-1"
                >
                  <span className="text-mute max-[560px]:col-span-full">{inv.periodLabel}</span>
                  <span className="flex flex-wrap items-center justify-end gap-2 max-[560px]:justify-start">
                  <span className="font-bold text-tealb">{jmd(inv.totalPence)}</span>
                  <span
                    className={
                      "rounded-full border px-2 py-0.5 text-[10.5px] font-bold " +
                      STATUS_TONE[invoiceStatus(inv.status, j.paid).tone]
                    }
                  >
                    {invoiceStatus(inv.status, j.paid).label}
                  </span>
                  <span className="font-mono text-[10px] text-dim">{inv.id}</span>
                  </span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}
