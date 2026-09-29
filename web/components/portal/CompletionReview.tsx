"use client";

import { useActionState, useState } from "react";
import {
  signCompletionReport, saveCompletionWords, raiseCompletionIssue, confirmCompletionReport, flagCompletionReport,
  type ReportActionState,
} from "@/app/portal/completion-report-actions";

/**
 * The two interactive parts of the Completion Report: the worker's review and
 * signature, and the client's review. Both render nothing on paper.
 *
 * The worker's form is the one worker web page in the product beyond sign-up
 * and file upload. That is a deliberate exception to CLAUDE.md section 9,
 * chosen by the founder on 28 Sep 2026. It edits words only: the care notes
 * and the worker's own account of the work. Everything else on the report is
 * read from the record and is not in this form.
 *
 * Signing is one button (founder: "it has to be a button the work presses").
 * No typed name: the signature is the name on their Yaadly profile. The same
 * button is on WhatsApp, where a tap signs the words as they stand.
 */

const box = "rounded-2xl border border-line bg-bg p-4 print:hidden";
const input = "mt-1 w-full rounded-xl border border-line2 bg-panel px-3 py-2 text-[13px] text-ink";
const btn = "rounded-full px-4 py-2 text-[12.5px] font-bold transition disabled:opacity-60";

export function WorkerSign({
  jobId, code, careNotes, account, workerName,
}: { jobId: string; code: string; careNotes: string[]; account: string; workerName: string }) {
  const [signed, signAction, signing] = useActionState<ReportActionState, FormData>(signCompletionReport, {});
  const [saved, saveAction, saving] = useActionState<ReportActionState, FormData>(saveCompletionWords, {});
  const [raised, raiseAction, raising] = useActionState<ReportActionState, FormData>(raiseCompletionIssue, {});
  const [issueOpen, setIssueOpen] = useState(false);
  if (signed.ok) {
    return (
      <div className={box}>
        <p className="text-[13.5px] font-bold text-ink">Signed. Thank you.</p>
        <p className="mt-1 text-[12.5px] text-mute">The report goes to the owner in a moment.</p>
      </div>
    );
  }
  if (raised.ok) {
    return (
      <div className={box}>
        <p className="text-[13.5px] font-bold text-ink">Sent to Yaadly.</p>
        <p className="mt-1 text-[12.5px] text-mute">
          The report waits and does not go to the owner. Yaadly will come back to you, and the report comes back
          to you to sign once it is right.
        </p>
      </div>
    );
  }
  const err = signed.error || saved.error || raised.error;
  return (
    <form className={box}>
      <h3 className="text-[14px] font-bold text-ink">Your report. Change the words if they are wrong, then sign</h3>
      <p className="mt-1 text-[12.5px] text-mute">
        You can change the care notes and your own account of the work. The dates, the photographs, the
        arrivals and the approvals come from the record and cannot be changed by anybody. If something is
        wrong that you cannot fix here, raise an issue instead of signing.
      </p>
      <input type="hidden" name="jobId" value={jobId} />
      <input type="hidden" name="code" value={code} />
      <label className="mt-3 block text-[12px] font-bold text-dim">
        What you did, in your own words (optional)
        <textarea name="account" rows={4} maxLength={2000} defaultValue={account} className={input}
          placeholder="What you did on each stage, anything you found on site, and anything the owner should know." />
      </label>
      <label className="mt-3 block text-[12px] font-bold text-dim">
        Looking after it, one note per line
        <textarea name="careNotes" rows={5} defaultValue={careNotes.join("\n")} className={input} />
      </label>
      <div className="mt-3 rounded-xl border border-line2 bg-panel px-3 py-2.5 text-[12.5px] text-mute">
        I carried out the work described in this report. The account of what was done is accurate, and the
        photographs and video were taken by me on this property on the dates shown.
      </div>
      {!code && (
        <p className="mt-2 text-[12px] text-coral">
          This page was opened without its code. Open the link from your WhatsApp message.
        </p>
      )}
      {saved.ok && !err && <p className="mt-2 text-[12.5px] text-tealb">Your changes are saved. Sign when it reads right.</p>}
      {err && <p className="mt-2 text-[12.5px] text-coral">{err}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="submit" formAction={signAction} disabled={signing || !code} className={btn + " bg-teal text-white hover:bg-tealb"}>
          {signing ? "Signing" : "Sign the report"}
        </button>
        <button type="submit" formAction={saveAction} disabled={saving || !code} className={btn + " border border-line2 text-mute hover:border-purple hover:text-purpleb"}>
          {saving ? "Saving" : "Save my changes"}
        </button>
        <button type="button" onClick={() => setIssueOpen((v) => !v)} disabled={!code} className={btn + " border border-coral/60 text-coral"}>
          Raise an issue
        </button>
      </div>
      <p className="mt-2 text-[11.5px] text-dim">
        You sign as {workerName || "the name on your Yaadly profile"}. Signing sends the words above.
      </p>
      {issueOpen && (
        <div className="mt-3">
          <label className="block text-[12px] font-bold text-dim">
            What is wrong? It goes to Yaadly, and the report waits.
            <textarea name="issue" rows={3} maxLength={1500} className={input}
              placeholder="The client asked for the floor tiles too, and that is not on here." />
          </label>
          <button type="submit" formAction={raiseAction} disabled={raising || !code} className={btn + " mt-2 bg-coral text-white"}>
            {raising ? "Sending" : "Send the issue to Yaadly"}
          </button>
        </div>
      )}
    </form>
  );
}

export function ClientReview({ jobId }: { jobId: string }) {
  const [ok, okAction, okPending] = useActionState<ReportActionState, FormData>(confirmCompletionReport, {});
  const [flag, flagAction, flagPending] = useActionState<ReportActionState, FormData>(flagCompletionReport, {});
  const [open, setOpen] = useState(false);
  if (ok.ok) {
    return <div className={box}><p className="text-[13.5px] font-bold text-ink">Thank you. Recorded on the report.</p></div>;
  }
  if (flag.ok) {
    return (
      <div className={box}>
        <p className="text-[13.5px] font-bold text-ink">Raised as a dispute.</p>
        <p className="mt-1 text-[12.5px] text-mute">
          The worker hears first and answers on the job. Yaadly has been told too. If the report needs to
          change, it goes back to the worker to correct and sign again, and you receive the new version.
        </p>
      </div>
    );
  }
  return (
    <div className={box}>
      <h3 className="text-[14px] font-bold text-ink">Is this report right?</h3>
      <p className="mt-1 text-[12.5px] text-mute">
        It is the worker&apos;s signed report, so it cannot be edited here. If something is wrong or missing,
        raise it: that opens a dispute on the job, the worker answers first, and Yaadly steps in if it cannot
        be sorted between you.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <form action={okAction}>
          <input type="hidden" name="jobId" value={jobId} />
          <button type="submit" disabled={okPending} className={btn + " bg-teal text-white hover:bg-tealb"}>
            {okPending ? "Recording" : "This is right"}
          </button>
        </form>
        <button type="button" onClick={() => setOpen((v) => !v)} className={btn + " border border-line2 text-mute hover:border-purple hover:text-purpleb"}>
          Something is wrong or missing
        </button>
      </div>
      {ok.error && <p className="mt-2 text-[12.5px] text-coral">{ok.error}</p>}
      {open && (
        <form action={flagAction} className="mt-3">
          <input type="hidden" name="jobId" value={jobId} />
          <textarea name="body" rows={3} maxLength={2000} required className={input}
            placeholder="The mixer in the photographs is not the one I bought." />
          {flag.error && <p className="mt-2 text-[12.5px] text-coral">{flag.error}</p>}
          <button type="submit" disabled={flagPending} className={btn + " mt-2 bg-purple text-white hover:bg-purpleb"}>
            {flagPending ? "Raising it" : "Raise it"}
          </button>
        </form>
      )}
    </div>
  );
}
