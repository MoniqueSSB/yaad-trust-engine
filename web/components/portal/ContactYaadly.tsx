"use client";

import { useState } from "react";
import { contactYaadly } from "@/app/portal/job-actions";

/**
 * A message to Yaadly itself, from inside the job. Founder, 13 Sep 2026:
 * "there should be a way they can contact yaadly directly if they have a
 * problem and it comes directly to my whatsapp and email."
 *
 * The page only writes a row to portal_contacts. The WhatsApp, the email
 * and the push to her phone come from the database trigger on that row, so
 * no other way of inserting one can skip telling her. Her number and address
 * come from app_settings on the server, never from this page.
 */
export function ContactYaadly({ jobId, otherSide }: { jobId: string; otherSide: string }) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState("");
  const short = body.trim().length < 5;

  if (sent)
    return (
      <div className="mt-6 rounded-2xl border border-tealb/30 bg-tealb/5 p-4 text-[13px] leading-relaxed text-mute">
        <b className="text-tealb">Sent. Monique has it.</b>{" "}
        It went to her WhatsApp and her email with this job attached. She
        answers on WhatsApp or by email, whichever you use with Yaadly.
        <button onClick={() => { setSent(false); setBody(""); }} className="ml-2 underline hover:text-ink">
          Send another
        </button>
      </div>
    );

  return (
    <div className="mt-6 rounded-2xl border border-line bg-panel p-4">
      <b className="text-[14px] text-ink">Message Yaadly directly</b>
      <p className="mt-1.5 text-[13px] leading-relaxed text-mute">
        For anything you would rather not raise with {otherSide}, or anything
        this page cannot sort. It goes straight to Monique, on WhatsApp and by
        email, with this job attached. Patois or English.
      </p>
      <textarea value={body} onChange={(e) => { setBody(e.target.value); setErr(""); }} rows={3} maxLength={2000}
        placeholder="What is the problem?"
        className="mt-2.5 w-full rounded-xl border border-line bg-bg px-3.5 py-3 text-[13.5px] text-ink outline-none focus:border-teal" />
      <div className="mt-2.5 flex flex-wrap items-center gap-3">
        <button disabled={busy || short}
          onClick={async () => {
            setBusy(true); setErr("");
            try { await contactYaadly(jobId, body); setSent(true); }
            catch { setErr("That did not send. If you have sent a few in the last hour, wait a little; otherwise try again."); }
            setBusy(false);
          }}
          className="rounded-full bg-linear-to-r from-teal to-mango px-4 py-2 text-[13px] font-bold text-onbrand disabled:opacity-40">
          {busy ? "Sending" : "Send to Yaadly"}
        </button>
        {short && body.length > 0 && <span className="text-[11.5px] text-dim">A few more words, please.</span>}
      </div>
      {err && <p className="mt-2 text-[12.5px] text-coral">{err}</p>}
    </div>
  );
}
