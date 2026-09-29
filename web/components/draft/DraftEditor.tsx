"use client";

import { useActionState, useState } from "react";
import { sendReportDraft, type DraftActionState } from "@/app/draft/actions";

/**
 * The report draft, in a box the worker can type in.
 *
 * One text box and one button. WhatsApp cannot hand anybody a message with
 * the words already in their typing box, so correcting a draft there means
 * copying, pasting and retyping on a phone mid-job, which nobody does. Here
 * the words are already in the box.
 *
 * The button says what it does and who to. Nothing is sent by opening the
 * page, and nothing is saved until Send is pressed.
 */

const box = "rounded-2xl border border-line bg-bg p-4";
const input = "mt-1 w-full rounded-xl border border-line2 bg-panel px-3 py-2 text-[14px] leading-relaxed text-ink";
const btn = "rounded-full px-5 py-2.5 text-[13px] font-bold transition disabled:opacity-60";

export function DraftEditor({ jobId, code, draft }: { jobId: string; code: string; draft: string }) {
  const [sent, sendAction, sending] = useActionState<DraftActionState, FormData>(sendReportDraft, {});
  const [text, setText] = useState(draft);

  if (sent.ok) {
    return (
      <div className={box}>
        <p className="text-[14px] font-bold text-ink">Sent to the client{sent.changed ? ", in your words" : " as drafted"}.</p>
        <p className="mt-1 text-[12.5px] text-mute">You can close this page. Nothing more is needed from you.</p>
      </div>
    );
  }

  const changed = text.trim() !== draft.trim();
  return (
    <form action={sendAction} className={box}>
      <input type="hidden" name="jobId" value={jobId} />
      <input type="hidden" name="code" value={code} />
      <label className="block text-[12px] font-bold text-dim">
        What the client will be told
        <textarea
          name="text" rows={9} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)}
          className={input} autoCapitalize="sentences"
        />
      </label>
      <p className="mt-1 text-[12px] text-dim">
        {changed ? "You have changed the draft. Your words are what the client gets." : "This is the draft as written. Change anything that is not right."}
        {" "}{text.length} of 2000.
      </p>
      {sent.error && <p className="mt-2 text-[12.5px] text-coral">{sent.error}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="submit" disabled={sending || text.trim().length < 10} className={btn + " bg-teal text-white hover:bg-tealb"}>
          {sending ? "Sending" : "Send to the client"}
        </button>
        {changed && (
          <button type="button" onClick={() => setText(draft)} className={btn + " border border-line2 text-mute hover:text-ink"}>
            Put the draft back
          </button>
        )}
      </div>
    </form>
  );
}
