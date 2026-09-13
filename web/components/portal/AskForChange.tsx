"use client";

/* The client's second move on an open quote, beside Accept. Founder
 * instruction, 13 Sep 2026: a client should be able to respond to a quote
 * and ask for a revision before agreeing to it.
 *
 * Deliberately the quieter control, the same weight as the Kickoff Pack
 * link: accepting is still the main button. Asking changes nothing on the
 * quote, so the copy says plainly that the client can still accept it as it
 * stands. request_quote_change_as_me() in Postgres decides who may ask; this
 * only collects the words. */

import { useRouter } from "next/navigation";
import { useState } from "react";
import { askForQuoteChange } from "@/app/portal/job-actions";

export function AskForChange({
  jobId,
  quoteId,
  workerName,
}: {
  jobId: string;
  quoteId: string;
  workerName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 block text-[12px] font-bold text-tealb underline underline-offset-2 transition hover:brightness-110"
      >
        Ask {workerName} for a change
      </button>
    );
  }

  async function send() {
    setError("");
    setBusy(true);
    try {
      const res = await askForQuoteChange(jobId, quoteId, text);
      if (!res.ok) {
        setError(res.error);
        setBusy(false);
        return;
      }
      router.refresh();
    } catch {
      setError("That did not go through. Refresh the page and try again.");
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 rounded-xl border border-line bg-panel2 p-3.5">
      <label className="block">
        <span className="mb-1.5 block text-[10.5px] font-bold uppercase tracking-[.14em] text-dim">
          What would you like changed?
        </span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={1500}
          rows={4}
          placeholder="For example: can the price include painting the whole rail, not just the new timber?"
          className="w-full rounded-lg border border-line2 bg-bg px-3 py-2 text-[13px] leading-relaxed text-ink"
        />
      </label>
      <p className="mt-1.5 max-w-[56ch] text-[11.5px] leading-snug text-dim">
        This goes straight to {workerName}. They can update their quote or keep
        it as it is. Nothing changes until they answer, and you can still accept
        this price as it stands. Phone numbers and emails are taken out, because
        contact stays on Yaadly.
      </p>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={send}
          disabled={busy || !text.trim()}
          className="rounded-full border border-teal bg-soft px-4 py-1.5 text-[12.5px] font-bold text-tealb transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "Sending…" : "Send to " + workerName}
        </button>
        <button
          type="button"
          onClick={() => { setOpen(false); setError(""); }}
          disabled={busy}
          className="text-[12px] font-bold text-mute underline underline-offset-2"
        >
          Cancel
        </button>
      </div>
      {error && <p className="mt-2 text-[12.5px] text-coral">{error}</p>}
    </div>
  );
}
