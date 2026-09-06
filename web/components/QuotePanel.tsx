"use client";

import { useState } from "react";
import { submitQuote } from "@/app/jobs/actions";
import { jmd } from "@/lib/money";

/**
 * The quote form, MARKETPLACE-BUILD-SPEC 2.4. Helper copy is decided and
 * carried verbatim. The live fee split renders the moment a labour figure
 * is typed: the client fee sits INSIDE the headline number, never added at
 * checkout, which is the DMCCA requirement made visible.
 */


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

/** A draft is usable only once an admin, or the automatic clean-guardrail
 *  check standing in for one, has approved it - 'ready' alone is not
 *  enough (20260901r, founder's own correction: "I never saw when the
 *  small pack was issued for review"). RLS is the real gate; this is a
 *  courtesy so a still-drafting or unapproved row never renders even if
 *  it somehow reached this component. */
function usableDraft(draft: QuotePackDraft | null): QuotePackDraft["docs"] | null {
  if (!draft || draft.status !== "approved" || !draft.docs) return null;
  if (draft.guardrail?.price_language_detected || draft.guardrail?.banned_language_detected) return null;
  return draft.docs;
}

/** One line of what the job needs. No price on it: the money is the labour and
 *  materials figures above, and a second set of numbers beside them would be a
 *  second source of truth about one job. */
type MatLine = { item: string; qty: string; unit: string };

const BLANK_LINE: MatLine = { item: "", qty: "", unit: "" };

export function QuotePanel({
  jobId,
  draft,
  materialsBy,
}: {
  jobId: string;
  draft?: QuotePackDraft | null;
  /** jobs.materials_by: 'yaadly', 'client', or null on a job posted before
   *  the client was asked. Null is treated as Yaadly supplying, which is the
   *  normal route and what every older job was quoted as. */
  materialsBy?: string | null;
}) {
  const docs = usableDraft(draft ?? null);
  const clientSupplies = materialsBy === "client";
  const [labour, setLabour] = useState(0);
  const [materials, setMaterials] = useState(0);
  /* What the job needs, stated by the worker at quote time.
     On a client-supplied job this is the ORDER the client fills, so it is
     required: telling somebody they are buying the materials without telling
     them what to buy guarantees the wasted journey it exists to prevent.
     On a Yaadly-supplied job it is what the materials money is released
     against and what the receipt is read against later. */
  const [lines, setLines] = useState<MatLine[]>([{ ...BLANK_LINE }]);
  const filledLines = lines.filter((l) => l.item.trim() !== "");
  const needsLines = clientSupplies && filledLines.length === 0;

  const setLine = (i: number, k: keyof MatLine, v: string) =>
    setLines((p) => p.map((l, n) => (n === i ? { ...l, [k]: v } : l)));
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
        {/* On a client-supplied job there is no materials figure to give and
            the database refuses one (quote_materials_match_route, 20260905d).
            The field is not shown rather than shown and rejected: a worker
            typing a number into a box that then throws is a worker who thinks
            the platform is broken. */}
        {clientSupplies ? (
          <div className="rounded-xl border border-mango/30 bg-mango/5 px-3.5 py-3">
            <span className="block text-[11px] font-bold uppercase tracking-[.13em] text-mango">
              Client supplies the materials
            </span>
            <span className="mt-1.5 block text-[11.5px] leading-relaxed text-mute">
              Quote your <b className="text-ink">labour only</b>. List what the
              job needs below and the client buys it, so it is on site when you
              get there. You are not answerable for materials being short, late
              or wrong.
            </span>
          </div>
        ) : (
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
              At cost. Never fee&apos;d, either side.
            </span>
          </label>
        )}
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
      {/* What the job needs, item by item. Step 4 of the materials route spec,
          and the reason it exists is the wasted journey: a tradesperson who
          travels to Portmore and finds no blocks on site. Rows rather than a
          paragraph because on a client-supplied job this is an order somebody
          fills and ticks off, and a paragraph cannot be ticked off. */}
      <div className="mt-4 border-t border-line2 pt-3.5">
        <p className="mb-1 text-[10.5px] font-bold uppercase tracking-[.18em] text-tealb">
          What this job needs{" "}
          {clientSupplies && <span className="text-mango">· required</span>}
        </p>
        <p className="mb-2.5 text-[11.5px] leading-relaxed text-dim">
          {clientSupplies
            ? "The client is buying these. Be exact about quantities, because this is the list they shop from."
            : "What you will be buying. This is what the materials money is released against, and what your receipt is checked against."}
        </p>

        <div className="grid gap-2">
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-[1fr_4.5rem_5rem] gap-2">
              <input
                name="mat_item"
                value={l.item}
                onChange={(e) => setLine(i, "item", e.target.value)}
                placeholder="6in concrete block"
                className="w-full rounded-xl border border-line bg-bg px-3 py-2.5 text-[14px] text-ink outline-none focus:border-teal"
              />
              <input
                name="mat_qty"
                value={l.qty}
                inputMode="decimal"
                onChange={(e) => setLine(i, "qty", e.target.value.replace(/[^\d.]/g, ""))}
                placeholder="120"
                aria-label="Quantity"
                className="w-full rounded-xl border border-line bg-bg px-3 py-2.5 text-right text-[14px] tabular-nums text-ink outline-none focus:border-teal"
              />
              <input
                name="mat_unit"
                value={l.unit}
                onChange={(e) => setLine(i, "unit", e.target.value)}
                placeholder="blocks"
                aria-label="Unit"
                className="w-full rounded-xl border border-line bg-bg px-3 py-2.5 text-[14px] text-ink outline-none focus:border-teal"
              />
            </div>
          ))}
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setLines((p) => [...p, { ...BLANK_LINE }])}
            className="rounded-full border border-line px-3.5 py-2 text-[12.5px] text-mute transition hover:border-teal"
          >
            + Add another line
          </button>
          {lines.length > 1 && (
            <button
              type="button"
              onClick={() => setLines((p) => p.slice(0, -1))}
              className="text-[12.5px] text-dim underline underline-offset-2 hover:text-mute"
            >
              Remove last
            </button>
          )}
          <span className="text-[11.5px] text-dim">
            {filledLines.length === 0
              ? "No lines yet"
              : `${filledLines.length} line${filledLines.length === 1 ? "" : "s"}`}
          </span>
        </div>

        {needsLines && (
          <p className="mt-2 text-[11.5px] leading-relaxed text-mango">
            Add at least one line. The client is buying the materials for this
            job and cannot know what to get unless you say.
          </p>
        )}
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
            Percentages of your total, never amounts. This is what gets checked before you&rsquo;re paid, so be specific.
          </span>
        </label>
      </div>

      {labour > 0 && (
        <div className="mt-3.5 rounded-xl border border-line bg-panel2 p-4 text-[13.5px] tabular-nums">
          <div className="flex justify-between text-mute"><span>Your labour price</span><span>{jmd(labour)}</span></div>
          {!clientSupplies && (
            <div className="flex justify-between text-mute"><span>Materials, at cost</span><span>{jmd(materials)}</span></div>
          )}
          <div className="my-2 h-px bg-line" />
          <div className="flex justify-between text-mute"><span>Client fee, 15% on labour</span><span>+{jmd(Math.round(labour * 0.15))}</span></div>
          <div className="flex justify-between font-bold text-ink"><span>Client sees one number</span><span>{jmd(Math.round(labour * 1.15) + (clientSupplies ? 0 : materials))}</span></div>
          <div className="my-2 h-px bg-line" />
          <div className="flex justify-between text-mute"><span>Yaadly&rsquo;s margin, 12% on labour</span><span>{jmd(Math.round(labour * 0.12))}</span></div>
          <div className="flex justify-between font-bold text-tealb"><span>Yaadly pays you</span><span>{jmd(Math.round(labour * 0.88) + (clientSupplies ? 0 : materials))}</span></div>
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
        <button disabled={busy || needsLines} className="rounded-full bg-linear-to-r from-teal to-mango px-4.5 py-2.5 text-[13.5px] font-bold text-onbrand transition hover:brightness-110 disabled:opacity-40">
          {busy ? "Sending..." : "Send quote"}
        </button>
        <span className="text-[11.5px] text-dim">
          Goes straight to the client. Your phone number is not attached.
        </span>
      </div>
    </form>
  );
}
