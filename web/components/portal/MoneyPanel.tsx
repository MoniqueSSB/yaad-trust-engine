import { InvoicePdfButton } from "./InvoicePdfButton";
import { amount, gbp } from "@/lib/money";
import { whenDate } from "@/lib/date";
import { PayByCardButton } from "./PayByCardButton";
import { invoiceLabel } from "@/lib/portal/invoice-label";
import { WORKER_FEE_RATE, workerFeePct } from "@/lib/jobs/worker-fee";

/**
 * What this job costs, what has been invoiced, and the rules that govern
 * both. Founder's instruction, 2 Sep 2026: the agency fee has to be in
 * here, and it has to be clear where you are on invoices.
 *
 * The fee shown is the one Postgres actually raises: 15% of the accepted
 * quote's labour, ONE invoice at the start of the job, never per stage
 * (20260901y), and the job cannot progress until it is paid (20260902f).
 * Worker pay is the separate, evidence-gated thing (20260902j), and this
 * panel keeps the two visibly apart because conflating them is exactly the
 * mistake that migration was written to undo.
 *
 * Invoice rows arrive already filtered by RLS: a client sees their own
 * non-draft invoices, a worker sees only the ones payable to them. Neither
 * side is filtered again here, because a second filter in app code would
 * be a second place for the rule to drift.
 */

export type InvoiceRow = {
  id: string;
  status: string;
  total_pence: number | null;
  currency: string | null;
  stage: number | null;
  payable_to: string | null;
  issue_date: string | null;
  paid_at: string | null;
  period_label: string | null;
  /** Paying this invoice starts the job: it carries the Guarantee & Support line. */
  starts_job?: boolean | null;
  /** On a part payment, the whole-job bill it was requested from. */
  part_of?: string | null;
  /** How a worker's pay went out, and its reference (mark_worker_paid, 20260914230000). */
  paid_method?: string | null;
  paid_reference?: string | null;
};

/** One agreed add-on, priced for the side reading it. */
export type ExtraWorkLine = {
  id: string;
  scope: string;
  /** the amount agreed for the work */
  work: number;
  /** client: Yaadly's 15% on top. worker: Yaadly's 7%, or 5% on work
      agreed before 4 Oct 2026, taken off. */
  fee: number;
  /** Worker side: the rate this add-on was agreed at (workerFeeRate() on its
      agreed_at), so the label names the figure that was taken off. */
  feeRate?: number;
  /** client: what they pay for it. worker: what they are paid for it. */
  total: number;
  status: string;
  /** Agreed or approved: counted in the totals. False for one still being
      agreed, or closed, which is listed so both sides see it and never
      added up (founder, 28 Sep 2026: all extra work on the money side). */
  counted?: boolean;
  /** Where its money stands, in words: bill paid or not, worker paid or not. */
  moneyNote?: string | null;
  /** Plain-English state for this reader, e.g. "Waiting on you". */
  stateLabel?: string;
};

/** The independent check, once a client has added one, as a line in the job
 *  total. Priced and invoiced in pounds; jmd is the page's conversion at the
 *  rate named in jmdPerGbp. Client side only: it is never the worker's money. */
export type CheckTotalLine = {
  label: string;
  jmd: number;
  pence: number;
  fullPence: number | null;
  invoiced: boolean;
  jmdPerGbp: number;
};

/* amount() moved to lib/money.ts, unchanged apart from the null case, which
   said a lone em dash and now says "not set". A dash in a money column is
   ambiguous between nothing and zero, and those are different answers to
   somebody asking what they owe. */

const TERMS: { title: string; body: string }[] = [
  {
    title: "Nothing moves without an approval",
    body: "Each stage is paid only after the client has seen that stage's evidence and approved it.",
  },
  {
    title: "Bank transfer, against an invoice",
    body: "Yaadly invoices, and payment is made by transfer. No card is stored and nothing is taken automatically.",
  },
  {
    title: "The Yaadly fee is 15%, once",
    body: "Calculated on the labour price and charged once, as a line on the job bill. It does not change as stages complete.",
  },
  {
    title: "If something is wrong, say so",
    body: "Raising a problem instead of approving brings a person at Yaadly in before any money moves.",
  },
];

export function MoneyPanel({
  side,
  labour,
  materials,
  fee,
  allIn,
  takeHome,
  invoices,
  money,
  materialsReleased,
  check = null,
  cardPayments = {},
  cardReturning = false,
  bankDetails = "",
  extraWork = null,
  workerFeeRate = WORKER_FEE_RATE,
}: {
  /** Worker side: the rate on this job's accepted quote, workerFeeRate() on
   *  the quote's created_at, the same rule raise_job_worker_payable() uses.
   *  7% from 4 Oct 2026, 5% on a quote given before it. Display only: the
   *  figure in `fee` must be worked out at this same rate by the caller. */
  workerFeeRate?: number;
  /** Agreed extra work (add-ons agreed or approved), one row each, shown as
   *  its own section UNDER the main work. NOT included in allIn or takeHome,
   *  which are the main work only. Founder, 28 Sep 2026: "What this job
   *  costs" has two sections, the main work and the additional work, so
   *  there is no confusion between them. */
  extraWork?: ExtraWorkLine[] | null;
  side: "client" | "worker";
  labour: number | null;
  materials: number | null;
  fee: number | null;
  allIn: number | null;
  takeHome: number | null;
  invoices: InvoiceRow[];
  money: (n: number | null | undefined) => string | null;
  /** J$ of the materials line already released to the worker; 0 if none */
  materialsReleased: number;
  /** The check the client added, already included in allIn. */
  check?: CheckTotalLine | null;
  /** Card payments Stripe has reported, by invoice id (invoice_payments).
   *  Client side only. A payment here never means the invoice is paid: a
   *  named person at Yaadly marks it paid. */
  cardPayments?: Record<string, "succeeded" | "mismatch">;
  /** The client has just come back from Stripe's page (?card=paid). Stripe's
   *  confirmation can land a few seconds after them, so until it does the
   *  button is replaced, not offered again: a second press would open a
   *  second payment page. 14 Sep 2026. */
  cardReturning?: boolean;
  /** The business bank details a client may pay into (client_bank_details()).
   *  Empty means none are set, and then no bank line is drawn at all. */
  bankDetails?: string;
}) {
  const agreed = labour != null;
  const showCheck = side === "client" && check != null;
  const hasExtra = !!extraWork && extraWork.length > 0;
  /* An add-on still being agreed is shown, so it is never invisible, and
     never counted: nobody owes money on it until both sides agree. A line
     can also say so itself (counted: false), e.g. a cancelled one listed
     only because its bill was paid. */
  const counts = (x: ExtraWorkLine) => x.counted ?? (x.status === "agreed" || x.status === "signed_off");
  const extraTotal = (extraWork ?? []).filter(counts).reduce((t, x) => t + x.total, 0);
  const mainTotal = side === "client" ? allIn : takeHome;
  const workerPct = workerFeePct(workerFeeRate);

  return (
    <>
      <section className="mb-3.5 rounded-2xl border border-line bg-linear-to-b from-[var(--card-top-75)] to-[var(--card-bot-60)] px-5.5 py-5">
        <h3 className="font-display text-[17px] font-normal tracking-[-0.01em]">
          {side === "client" ? "What this job costs" : "What you are paid"}
        </h3>
        <p className="mb-3.5 mt-1 text-[12.5px] text-dim">
          {agreed
            ? "Agreed when the quote was accepted."
            : side === "client"
              ? "Nothing is agreed until you choose a quote. Posting and receiving quotes is free."
              : "Set once a client accepts your quote."}
        </p>

        {!agreed ? (
          <div className="rounded-2xl border border-dashed border-line2 bg-bg/30 px-5 py-6 text-center">
            <b className="mb-1 block text-[14px] font-semibold text-ink">No price yet, and nothing owed</b>
            <p className="mx-auto max-w-[46ch] text-[12.5px] leading-relaxed text-dim">
              {side === "client"
                ? "When quotes arrive you will see each worker's labour price, Yaadly's 15% fee calculated on it, and the full all-in total, before you commit to anything."
                : "When a client accepts your quote, your labour price and what you take home after Yaadly's " + workerPct + " appear here."}
            </p>
          </div>
        ) : (
          <>
            {/* The main work as one plain card, the same layout as each
                add-on card below (founder, 28 Sep 2026: "change this layout
                so it aligns to the additional work layout", the bars and long
                captions were "too childish"). A line only carries a short
                note where the note changes what the figure means. */}
            {hasExtra && (
              <h4 className="mb-2.5 text-[10.5px] font-bold uppercase tracking-[.16em] text-mute">Main work</h4>
            )}
            <div className="rounded-xl border border-line bg-bg/40 px-3.5 py-3">
              <div className="grid gap-1.5 text-[12.5px]">
                <Line label={side === "client" ? "The work, worker labour" : "Your labour price"} value={money(labour)} />
                {materials != null && materials > 0 && (
                  <Line
                    label="Materials, at cost"
                    value={money(materials)}
                    note={materialsReleased > 0
                      ? (money(materialsReleased) ?? "") + " released to the worker to buy them"
                      : "Not released yet"}
                  />
                )}
                {side === "client" ? (
                  <Line label="Yaadly Guarantee & Support, 15% of the labour" value={money(fee)} />
                ) : (
                  <Line label={"Yaadly's " + workerPct + ", taken off"} value={fee == null ? null : "−" + (money(fee) ?? "")} />
                )}
                {showCheck && check && (
                  <Line
                    label={check.label}
                    value={money(check.jmd)}
                    note={(check.invoiced ? "Invoiced at " : "") + gbp(check.pence) + ", billed in pounds, shown at J$" + check.jmdPerGbp.toLocaleString("en-JM") + " to £1"}
                  />
                )}
                <div className="mt-0.5 flex justify-between gap-3 border-t border-line pt-1.5 font-semibold">
                  <span className="text-mute">
                    {hasExtra
                      ? side === "client" ? "Main work, what you pay" : "Main work, paid to you"
                      : side === "client" ? "All in, everything you pay" : "Paid to you in total"}
                  </span>
                  <span className="font-mono-app text-ink">{money(mainTotal) ?? "—"}</span>
                </div>
              </div>
            </div>
            {hasExtra && extraWork && (
              <div className="mt-5 border-t border-line2 pt-4">
                <h4 className="text-[10.5px] font-bold uppercase tracking-[.16em] text-mute">Additional work</h4>
                <p className="mb-3 mt-1 text-[12px] leading-relaxed text-dim">
                  Extra work agreed after the job was booked, on the Extra work tab. Each one is billed on its own
                  invoice and does not change the main work above.
                </p>
                <div className="flex flex-col gap-2.5">
                  {extraWork.map((x) => (
                    <div key={x.id} className="rounded-xl border border-line bg-bg/40 px-3.5 py-3">
                      <div className="flex items-baseline justify-between gap-3">
                        <b className="min-w-0 truncate text-[13px] font-semibold text-ink" title={x.scope}>{x.scope}</b>
                        <span className={"flex-none text-[10.5px] font-bold uppercase tracking-wide " + (counts(x) ? "text-dim" : "text-mango")}>
                          {x.stateLabel ?? (x.status === "signed_off" ? "Done and approved" : x.status === "agreed" ? "Agreed" : "Being agreed, not counted")}
                        </span>
                      </div>
                      {!counts(x) && x.status !== "cancelled" && (
                        <p className="mt-1 text-[11.5px] text-mango">Not agreed by both sides yet, so not in the totals below.</p>
                      )}
                      {x.moneyNote && <p className="mt-1 text-[11.5px] text-dim">{x.moneyNote}</p>}
                      <div className="mt-2 grid gap-1 text-[12.5px]">
                        <div className="flex justify-between gap-3"><span className="text-dim">The work</span><span className="font-mono-app">{money(x.work)}</span></div>
                        <div className="flex justify-between gap-3">
                          <span className="text-dim">{side === "client" ? "Yaadly Guarantee & Support, 15%" : "Yaadly's " + workerFeePct(x.feeRate ?? workerFeeRate) + ", taken off"}</span>
                          <span className="font-mono-app">{side === "client" ? "" : "−"}{money(x.fee)}</span>
                        </div>
                        <div className="flex justify-between gap-3 border-t border-line pt-1 font-semibold">
                          <span className="text-mute">
                            {counts(x)
                              ? side === "client" ? "You pay for this" : "Paid to you for this"
                              : x.status === "cancelled"
                                ? side === "client" ? "You paid for this, then it was cancelled" : "Cancelled, not due to you"
                                : side === "client" ? "You would pay, once agreed" : "You would be paid, once agreed"}
                          </span>
                          <span className="font-mono-app text-ink">{money(x.total)}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex items-baseline justify-between">
                  <span className="text-[13px] font-semibold text-ink">
                    {side === "client" ? "Additional work, what you pay" : "Additional work, paid to you"}
                  </span>
                  <span className="font-mono-app text-[17px] font-semibold text-ink">{money(extraTotal)}</span>
                </div>
                <div className="mt-4 flex items-baseline justify-between border-t-2 border-line2 pt-3.5">
                  <span className="text-[13px] font-semibold text-ink">
                    {side === "client" ? "All in, main and additional work" : "Paid to you in total, main and additional work"}
                  </span>
                  <span className="font-mono-app text-[22px] font-semibold text-ink">
                    {money(mainTotal == null ? null : mainTotal + extraTotal) ?? "—"}
                  </span>
                </div>
              </div>
            )}
            {/* Said "You take home" over labour plus materials until 28 Sep
                2026. The materials money is spent on the materials, so a
                worker reading J$119,250 as what they keep was reading the
                wrong number. */}
            {side === "worker" && takeHome != null && materials != null && materials > 0 && (
              <p className="mt-1 text-right text-[12px] text-dim">
                {money(materials)} of that buys the materials. You keep{" "}
                <b className="text-mute">{money(takeHome - materials)}</b>.
              </p>
            )}
          </>
        )}
      </section>

      {/* id="invoices", and "invoice-<id>" on each row, are where the
          outstanding list's "See the invoice" and "Invoice X is unpaid"
          land. */}
      <section id="invoices" className="mb-3.5 scroll-mt-6 rounded-2xl border border-line bg-linear-to-b from-[var(--card-top-75)] to-[var(--card-bot-60)] px-5.5 py-5">
        <h3 className="font-display text-[17px] font-normal tracking-[-0.01em]">
          {side === "client" ? "Your invoices" : "Your pay invoices"}
        </h3>
        <p className="mb-1 mt-1 text-[12.5px] text-dim">
          {side === "client"
            ? "Every invoice on this job, newest last. Paid by bank transfer."
            : "Raised in your favour by Yaadly as each stage is accepted and checked."}
        </p>

        {invoices.length === 0 ? (
          <div className="mt-3 rounded-2xl border border-dashed border-line2 bg-bg/30 px-5 py-6 text-center">
            <b className="mb-1 block text-[14px] font-semibold text-ink">No invoices yet</b>
            <p className="mx-auto max-w-[48ch] text-[12.5px] leading-relaxed text-dim">
              {side === "client"
                ? "Your bill for this job comes from Yaadly once you have chosen a quote: the labour, Yaadly's 15% and materials, on one bill. Nothing is owed before it arrives."
                : "Yaadly raises a pay invoice as soon as a stage is accepted and checked. Nothing appears here before that."}
            </p>
          </div>
        ) : (
          <div className="mt-1">
            {invoices.map((inv) => {
              const paid = inv.status === "paid";
              /* The name comes from lib/portal/invoice-label.ts, which says
                 why: since 3 Sep 2026 the client's invoice is the whole job,
                 and since 14 Sep it can go out in parts. */
              const startsJobNote =
                inv.payable_to !== "worker" && inv.starts_job && !paid ? " · paying this starts the job" : "";
              return (
                <div key={inv.id} id={"invoice-" + inv.id} className="flex scroll-mt-6 gap-3.5 border-b border-line py-3.5 last:border-b-0">
                  <span
                    className={
                      "mt-1.5 size-[11px] shrink-0 rounded-full border-2 " +
                      (paid ? "border-green bg-green" : "border-gold bg-gold")
                    }
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2.5 text-[13.5px] font-semibold text-ink">
                      <span>{invoiceLabel(inv) + startsJobNote}</span>
                      <span
                        className={
                          "rounded-full border px-2 py-0.5 font-mono-app text-[9px] font-semibold uppercase tracking-[0.1em] " +
                          (paid
                            ? "border-green/30 bg-green/[0.12] text-green"
                            : "border-gold/35 bg-gold/[0.12] text-goldb")
                        }
                      >
                        {paid ? "Paid" : inv.status === "sent" ? "Sent, unpaid" : inv.status}
                      </span>
                      <span className="ml-auto whitespace-nowrap font-mono-app text-[13px]">
                        {amount(inv.total_pence, inv.currency)}
                      </span>
                    </div>
                    <div className="mt-1 text-[12px] leading-relaxed text-dim">
                      <span className="font-mono-app">{inv.id}</span>
                      {inv.issue_date ? " · issued " + inv.issue_date : ""}
                      {inv.paid_at ? " · paid " + (whenDate(inv.paid_at) ?? inv.paid_at) : ""}
                      {side === "worker" && inv.paid_at && inv.paid_method === "bank_transfer" ? " by bank transfer" : ""}
                      {side === "worker" && inv.paid_at && inv.paid_reference ? ", reference " + inv.paid_reference : ""}
                      {inv.period_label ? " · " + inv.period_label : ""}
                    </div>
                    {/* The invoice as the PDF it was emailed as (28 Sep 2026). */}
                    {inv.status !== "draft" && (
                      <div className="mt-2">
                        <InvoicePdfButton invoiceId={inv.id} />
                      </div>
                    )}
                    {/* Pay by card, phase 1 (14 Sep 2026). Only the client,
                        only Yaadly's own invoices, only once sent and unpaid.
                        Once Stripe reports a payment the button goes, so a
                        client cannot pay twice from here; the invoice stays
                        "Sent, unpaid" until a person marks it paid. */}
                    {side === "client" && inv.payable_to !== "worker" && inv.status === "sent" && (
                      cardPayments[inv.id] ? (
                        <p className="mt-2 text-[12px] leading-relaxed text-tealb">
                          {cardPayments[inv.id] === "succeeded"
                            ? "Card payment received. A person at Yaadly signs it off, then this invoice shows as Paid" + (inv.starts_job ? " and the project starts." : ".")
                            : "A card payment arrived that does not match this invoice. Yaadly is checking it."}
                        </p>
                      ) : (
                        cardReturning ? (
                          <p className="mt-2 text-[12px] leading-relaxed text-tealb">
                            Payment is being confirmed. Refresh in a moment and it shows here as received.
                          </p>
                        ) : (
                          <PayByCardButton invoiceId={inv.id} amountLabel={amount(inv.total_pence, inv.currency)} />
                        )
                      )
                    )}
                    {/* Bank transfer, the second way to pay (14 Sep 2026).
                        Drawn only once the founder has written the details
                        (client_bank_details(), 20260914160000), only on an
                        unpaid invoice with no card payment under way. A
                        transfer is marked paid by a person, as before. */}
                    {side === "client" && inv.payable_to !== "worker" && inv.status === "sent" &&
                      !cardPayments[inv.id] && !cardReturning && bankDetails && (
                      <p className="mt-2 text-[12px] leading-relaxed text-dim">
                        Or pay by bank transfer: <span className="text-mute">{bankDetails}</span>. Use{" "}
                        <b className="font-mono-app text-ink">{inv.id}</b> as the reference, and Yaadly marks it paid when it arrives.
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="mb-3.5 rounded-2xl border border-line bg-linear-to-b from-[var(--card-top-75)] to-[var(--card-bot-60)] px-5.5 py-5">
        <h3 className="font-display text-[17px] font-normal tracking-[-0.01em]">How paying works</h3>
        <p className="mb-3.5 mt-1 text-[12.5px] text-dim">The same rules on every marketplace job.</p>
        <div className="grid gap-2.5 sm:grid-cols-2">
          {TERMS.map((t) => (
            <div key={t.title} className="rounded-xl border border-line bg-bg/35 px-4 py-3.5">
              <b className="mb-0.5 block text-[12.5px] font-semibold text-ink">{t.title}</b>
              <span className="text-[11.5px] leading-relaxed text-dim">{t.body}</span>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

function Line({ label, value, note }: { label: string; value: string | null; note?: string }) {
  return (
    <div>
      <div className="flex justify-between gap-3">
        <span className="text-dim">{label}</span>
        <span className="font-mono-app text-ink">{value ?? "—"}</span>
      </div>
      {note && <div className="text-[11.5px] text-dim/80">{note}</div>}
    </div>
  );
}
