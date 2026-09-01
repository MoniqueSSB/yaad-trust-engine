"use client";

import { useState } from "react";
import { submitQuote } from "@/app/jobs/actions";

/**
 * The quote form, MARKETPLACE-BUILD-SPEC 2.4. Helper copy is decided and
 * carried verbatim. The live fee split renders the moment a labour figure
 * is typed: the client fee sits INSIDE the headline number, never added at
 * checkout, which is the DMCCA requirement made visible.
 */
function jmd(n: number) {
  return "J$" + n.toLocaleString("en-US");
}

type QuotePackDraft = {
  status: string;
  docs: {
    scope_summary?: string; included?: string[]; excluded?: string[];
    rough_timeline?: string; payment_stages?: { stage: string; proportion_percent: number; evidence_note: string }[];
  } | null;
  guardrail: { price_language_detected?: boolean; banned_language_detected?: boolean } | null;
};

/** included/excluded as plain bullet lines, same reasoning as
 *  stagesToText: the founder's own description is "editable text" for
 *  every one of these fields, not a structured form. */
function linesToText(items: string[] | undefined): string {
  return items?.length ? items.join("\n") : "";
}

/** payment_stages as plain lines, the shape the worker actually edits and
 *  the shape job_quotes.payment_stage_note stores. Founder's own
 *  description: all three fields are "editable text", not a structured
 *  form, so the stage list is flattened to text at the door rather than
 *  carrying jsonb into the textarea. */
function stagesToText(stages: { stage: string; proportion_percent: number; evidence_note: string }[] | undefined): string {
  if (!stages?.length) return "";
  return stages.map((s) => `${s.stage} — ${s.proportion_percent}% — ${s.evidence_note}`).join("\n");
}

/** A draft is usable only once it is ready AND clean. A dirty or still-
 *  drafting one falls back to blank fields rather than showing a worker
 *  something that read a price or the word escrow into a live document. */
function usableDraft(draft: QuotePackDraft | null): QuotePackDraft["docs"] | null {
  if (!draft || draft.status !== "ready" || !draft.docs) return null;
  if (draft.guardrail?.price_language_detected || draft.guardrail?.banned_language_detected) return null;
  return draft.docs;
}

export function QuotePanel({ jobId, draft }: { jobId: string; draft?: QuotePackDraft | null }) {
  const docs = usableDraft(draft ?? null);
  const [labour, setLabour] = useState(0);
  const [materials, setMaterials] = useState(0);
  const [scopeSummary, setScopeSummary] = useState(docs?.scope_summary ?? "");
  const [includedNote, setIncludedNote] = useState(linesToText(docs?.included));
  const [excludedNote, setExcludedNote] = useState(linesToText(docs?.excluded));
  const [timelineNote, setTimelineNote] = useState(docs?.rough_timeline ?? "");
  const [paymentStageNote, setPaymentStageNote] = useState(stagesToText(docs?.payment_stages));
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (sent) {
    return (
      <div className="mt-3.5 rounded-xl border border-mango/30 bg-mango/5 p-4 text-[13.5px] leading-relaxed text-mute">
        <b className="font-mono text-[11px] font-bold text-mango">✦ quote sent</b>
        <p className="mt-2">
          Your quote is with the client, scope, timeline and payment stages
          included. They see your Yaad Score, jobs completed and evidence
          from past work alongside it. If they accept, the Kickoff Pack is
          drafted from it, then Monique reviews before anything is signed.
        </p>
      </div>
    );
  }

  return (
    <form
      action={async (fd) => {
        setBusy(true);
        setError(null);
        try {
          await submitQuote(fd);
          setSent(true);
        } catch {
          setError(
            "The database refused this quote. Quoting needs a published worker profile, a signed Worker Guidelines, and a job that is still open.",
          );
        }
        setBusy(false);
      }}
      className="mt-3.5 border-t border-line2 pt-4"
    >
      <input type="hidden" name="jobId" value={jobId} />
      <p className="mb-2.5 text-[10.5px] font-bold uppercase tracking-[.18em] text-tealb">
        Your quote · {jobId}
      </p>
      <div className="grid gap-3.5 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[.13em] text-dim">
            Your labour price (J$)
          </span>
          <input
            name="labour"
            inputMode="numeric"
            required
            onChange={(e) => setLabour(parseInt(e.target.value.replace(/\D/g, ""), 10) || 0)}
            className="w-full rounded-xl border border-line bg-bg px-3.5 py-3 text-[15px] text-ink outline-none focus:border-teal"
          />
          <span className="mt-1.5 block text-[11.5px] text-dim">
            The fee is calculated on this, and only this.
          </span>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[.13em] text-dim">
            Materials (J$)
          </span>
          <input
            name="materials"
            inputMode="numeric"
            onChange={(e) => setMaterials(parseInt(e.target.value.replace(/\D/g, ""), 10) || 0)}
            className="w-full rounded-xl border border-line bg-bg px-3.5 py-3 text-[15px] text-ink outline-none focus:border-teal"
          />
          <span className="mt-1.5 block text-[11.5px] text-dim">
            Passed through at cost. Never fee&apos;d, either side.
          </span>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[.13em] text-dim">
            Earliest start
          </span>
          <select name="start" className="w-full rounded-xl border border-line bg-bg px-3.5 py-3 text-[14px] text-ink outline-none focus:border-teal">
            <option>Within 48 hours</option>
            <option>This week</option>
            <option>Next week</option>
            <option>Two weeks or more</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[.13em] text-dim">
            How many days on site
          </span>
          <input
            name="days"
            placeholder="e.g. 1 day, or 2 to 3 days"
            className="w-full rounded-xl border border-line bg-bg px-3.5 py-3 text-[14px] text-ink outline-none focus:border-teal"
          />
        </label>
      </div>
      <label className="mt-3.5 block">
        <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[.13em] text-dim">
          What is included
        </span>
        <textarea
          name="note"
          rows={3}
          placeholder="Be specific about what is and is not in the price. Vague quotes get skipped."
          className="w-full rounded-xl border border-line bg-bg px-3.5 py-3 text-[14px] leading-relaxed text-ink outline-none focus:border-teal"
        />
      </label>

      <div className="mt-4 border-t border-line2 pt-3.5">
        <p className="mb-2.5 text-[10.5px] font-bold uppercase tracking-[.18em] text-tealb">
          {docs ? "Yaadly's starting draft, edit to your own terms" : "Scope, timeline and payment stages"}
        </p>
        <label className="mt-2 block">
          <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[.13em] text-dim">
            Scope summary
          </span>
          <textarea
            name="scopeSummary"
            rows={3}
            value={scopeSummary}
            onChange={(e) => setScopeSummary(e.target.value)}
            placeholder="What the job involves, in your own words."
            className="w-full rounded-xl border border-line bg-bg px-3.5 py-3 text-[14px] leading-relaxed text-ink outline-none focus:border-teal"
          />
        </label>
        <div className="mt-2.5 grid gap-3.5 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[.13em] text-dim">
              What&apos;s included
            </span>
            <textarea
              name="includedNote"
              rows={3}
              value={includedNote}
              onChange={(e) => setIncludedNote(e.target.value)}
              placeholder="One line per item. What you are taking on."
              className="w-full rounded-xl border border-line bg-bg px-3.5 py-3 text-[14px] leading-relaxed text-ink outline-none focus:border-teal"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[.13em] text-dim">
              What&apos;s excluded
            </span>
            <textarea
              name="excludedNote"
              rows={3}
              value={excludedNote}
              onChange={(e) => setExcludedNote(e.target.value)}
              placeholder="One line per item. What is not covered by this price."
              className="w-full rounded-xl border border-line bg-bg px-3.5 py-3 text-[14px] leading-relaxed text-ink outline-none focus:border-teal"
            />
          </label>
        </div>
        <label className="mt-2.5 block">
          <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[.13em] text-dim">
            Rough timeline
          </span>
          <textarea
            name="timelineNote"
            rows={2}
            value={timelineNote}
            onChange={(e) => setTimelineNote(e.target.value)}
            placeholder="How long this runs and what it depends on."
            className="w-full rounded-xl border border-line bg-bg px-3.5 py-3 text-[14px] leading-relaxed text-ink outline-none focus:border-teal"
          />
        </label>
        <label className="mt-2.5 block">
          <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[.13em] text-dim">
            Payment stages
          </span>
          <textarea
            name="paymentStageNote"
            rows={3}
            value={paymentStageNote}
            onChange={(e) => setPaymentStageNote(e.target.value)}
            placeholder="Stage name — proportion — what proves it's done. One per line."
            className="w-full rounded-xl border border-line bg-bg px-3.5 py-3 text-[14px] leading-relaxed text-ink outline-none focus:border-teal"
          />
          <span className="mt-1.5 block text-[11.5px] text-dim">
            Percentages of your total, never amounts. This is what gets checked before you're paid, so be specific.
          </span>
        </label>
      </div>

      {labour > 0 && (
        <div className="mt-3.5 rounded-xl border border-line bg-panel2 p-4 text-[13.5px] tabular-nums">
          <div className="flex justify-between text-mute"><span>Your labour price</span><span>{jmd(labour)}</span></div>
          <div className="flex justify-between text-mute"><span>Materials, at cost</span><span>{jmd(materials)}</span></div>
          <div className="my-2 h-px bg-line" />
          <div className="flex justify-between text-mute"><span>Client fee, 15% on labour</span><span>+{jmd(Math.round(labour * 0.15))}</span></div>
          <div className="flex justify-between font-bold text-ink"><span>Client sees one number</span><span>{jmd(Math.round(labour * 1.15) + materials)}</span></div>
          <div className="my-2 h-px bg-line" />
          <div className="flex justify-between text-mute"><span>Your fee, 12% on labour</span><span>-{jmd(Math.round(labour * 0.12))}</span></div>
          <div className="flex justify-between font-bold text-tealb"><span>You receive</span><span>{jmd(Math.round(labour * 0.88) + materials)}</span></div>
          <p className="mt-2.5 text-[11.5px] leading-relaxed text-dim">
            The client is shown the all-in total before they accept, never a
            base price with the fee added at the end.
          </p>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-3 rounded-xl border border-coral/30 bg-coral/10 px-3.5 py-3 text-[13px] text-mute">{error}</p>
      )}

      <p className="mt-3 text-[11.5px] leading-relaxed text-dim">
        This is your quote to the client, scope, timeline and stages
        included. If they accept, the Kickoff Pack and its own payment
        schedule are drafted from it, then Monique reviews before anything
        is signed.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button disabled={busy} className="rounded-full bg-linear-to-r from-teal to-mango px-4.5 py-2.5 text-[13.5px] font-bold text-[#04211D] transition hover:brightness-110 disabled:opacity-40">
          {busy ? "Sending..." : "Send quote"}
        </button>
        <span className="text-[11.5px] text-dim">
          Goes straight to the client. Your phone number is not attached.
        </span>
      </div>
    </form>
  );
}
