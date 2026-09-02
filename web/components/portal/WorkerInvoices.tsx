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

const jmd = (n: number) => "J$" + Math.round(n).toLocaleString("en-JM");

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
                <li
                  key={inv.id}
                  className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-bg px-3 py-2 text-[12.5px]"
                >
                  <span className="min-w-[140px] flex-1 text-mute">{inv.periodLabel}</span>
                  <span className="font-bold text-tealb">{jmd(inv.totalPence)}</span>
                  <span
                    className={
                      "rounded-full border px-2 py-0.5 text-[10.5px] font-bold " +
                      (inv.status === "sent" && !j.paid
                        ? "border-mango/40 text-mango"
                        : "border-softline bg-soft text-tealb")
                    }
                  >
                    {inv.status === "sent" && !j.paid ? "Pending" : inv.status === "sent" ? "Recorded paid" : inv.status}
                  </span>
                  <span className="font-mono text-[10px] text-dim">{inv.id}</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}
