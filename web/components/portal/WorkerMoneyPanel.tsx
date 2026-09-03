"use client";

import { useState } from "react";
import { recordPayInfo } from "@/app/portal/worker-actions";
import { jmd } from "@/lib/money";

/**
 * Stage 5.6. The worker portal's own header has promised "what you are
 * owed" since it was written and never once shown a number. This is that
 * number, job by job: the same 88%-plus-materials arithmetic
 * FeeBreakdown.tsx already shows on a single job, held while the job is
 * live and released once it is complete.
 *
 * Released does not mean paid. Nothing in this repository moves money
 * (CLAUDE.md 9): a released figure is what Yaadly's part is done with,
 * cleared to be paid off-platform within 3 working days. Recording how that
 * actually happened, bank transfer, Lynk or remittance, and what reference
 * it carried, is the worker's own note for their own record, through
 * record_pay_info() in Postgres, not a payment confirmation Yaadly makes.
 */

export type MoneyJob = {
  id: string;
  title: string | null;
  takeHome: number;
  held: boolean;
  payMethod: string | null;
  payRef: string | null;
};



const METHOD_LABEL: Record<string, string> = {
  bank_transfer: "Bank transfer",
  lynk: "Lynk wallet",
  remittance: "Remittance pick up",
};

export function WorkerMoneyPanel({ jobs }: { jobs: MoneyJob[] }) {
  if (jobs.length === 0) return null;
  return (
    <section className="mt-8">
      <h2 className="mb-3 text-[10.5px] font-bold uppercase tracking-[.2em] text-tealb">
        Your money, job by job
      </h2>
      <ul className="grid gap-3">
        {jobs.map((j) => (
          <MoneyRow key={j.id} job={j} />
        ))}
      </ul>
    </section>
  );
}

function MoneyRow({ job }: { job: MoneyJob }) {
  const [editing, setEditing] = useState(false);

  return (
    <li className="rounded-2xl border border-line bg-panel p-4">
      <div className="flex flex-wrap items-center gap-3">
        <b className="min-w-[180px] flex-1 text-[14.5px]">{job.title ?? "Untitled job"}</b>
        <span
          className={
            "rounded-full border px-2.5 py-1 text-[11px] font-bold " +
            (job.held ? "border-mango/40 text-mango" : "border-softline bg-soft text-tealb")
          }
        >
          {job.held ? "Held" : "Released"}
        </span>
        <span className="text-[15px] font-bold text-tealb">{jmd(job.takeHome)}</span>
      </div>

      {job.held ? (
        <p className="mt-2 text-[12px] leading-relaxed text-dim">
          Held until the client approves the evidence on this job.
        </p>
      ) : (
        <div className="mt-3 border-t border-line pt-3">
          {!editing && job.payMethod ? (
            <p className="text-[12.5px] text-mute">
              Recorded as {METHOD_LABEL[job.payMethod] ?? job.payMethod}
              {job.payRef ? ", ref " + job.payRef : ""}.{" "}
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="text-tealb underline-offset-2 hover:underline"
              >
                Change
              </button>
            </p>
          ) : !editing ? (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-[12.5px] font-bold text-tealb underline-offset-2 hover:underline"
            >
              Record how you were paid
            </button>
          ) : (
            <form
              action={async (fd) => {
                await recordPayInfo(fd);
                setEditing(false);
              }}
              className="flex flex-wrap items-center gap-2"
            >
              <input type="hidden" name="jobId" value={job.id} />
              <select
                name="method"
                defaultValue={job.payMethod ?? ""}
                required
                className="rounded-xl border border-line bg-bg px-3 py-2 text-[13px] text-ink outline-none focus:border-teal"
              >
                <option value="" disabled>How were you paid?</option>
                <option value="bank_transfer">Bank transfer</option>
                <option value="lynk">Lynk wallet</option>
                <option value="remittance">Remittance pick up</option>
              </select>
              <input
                name="ref"
                defaultValue={job.payRef ?? ""}
                placeholder="Reference, optional"
                maxLength={80}
                className="rounded-xl border border-line bg-bg px-3 py-2 text-[13px] text-ink outline-none focus:border-teal"
              />
              <button className="rounded-full bg-linear-to-r from-teal to-mango px-4 py-2 text-[12.5px] font-bold text-onbrand">
                Save
              </button>
            </form>
          )}
        </div>
      )}
    </li>
  );
}
