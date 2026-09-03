import { amount } from "@/lib/money";
import { whenDate } from "@/lib/date";

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
    body: "Calculated on the labour price and invoiced at the start of the job. It does not change as stages complete.",
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
}: {
  side: "client" | "worker";
  labour: number | null;
  materials: number | null;
  fee: number | null;
  allIn: number | null;
  takeHome: number | null;
  invoices: InvoiceRow[];
  money: (n: number | null | undefined) => string | null;
  /** J$ of the materials line already paid out against a receipt; 0 if none */
  materialsReleased: number;
}) {
  const agreed = labour != null;

  return (
    <>
      <section className="mb-3.5 rounded-2xl border border-line bg-linear-to-b from-[rgba(19,19,50,0.75)] to-[rgba(12,12,38,0.6)] px-5.5 py-5">
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
                : "When a client accepts your quote, your labour price and what you take home after Yaadly's 12% appear here."}
            </p>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-3">
              <MoneyRow
                colour="bg-purple"
                label={side === "client" ? "Worker labour" : "Your labour price"}
                value={money(labour) ?? "—"}
                width={fee != null && labour != null ? Math.round((labour / (labour + fee)) * 100) : 100}
                caption="Paid across the payment stages in the Kickoff Pack, each released only when the client approves that stage's evidence."
              />
              {materials != null && materials > 0 && (
                <MoneyRow
                  colour="bg-purpleb"
                  label="Materials"
                  value={money(materials) ?? "—"}
                  width={30}
                  caption={
                    materialsReleased > 0
                      ? (money(materialsReleased) ?? "") +
                        " released to the worker against a receipt. Never fee'd on either side."
                      : "Paid to the worker against a receipt before labour starts, once the client has said where materials are kept. Not released yet. Never fee'd on either side."
                  }
                />
              )}
              <MoneyRow
                colour="bg-gold"
                label={side === "client" ? "Yaadly Guarantee & Support fee" : "Yaadly fee, deducted"}
                value={money(fee) ?? "—"}
                width={fee != null && labour != null ? Math.max(Math.round((fee / (labour + fee)) * 100), 6) : 15}
                caption={
                  side === "client"
                    ? "15% of the labour price, invoiced once at the start of the job, never per stage. The job cannot start until it is paid."
                    : "Yaadly's cut, taken from the labour price rather than invoiced to you."
                }
              />
            </div>
            <div className="mt-4 flex items-baseline justify-between border-t border-line2 pt-3.5">
              <span className="text-[13px] font-semibold text-ink">
                {side === "client" ? "All in, everything you pay" : "You take home"}
              </span>
              <span className="font-mono-app text-[22px] font-semibold text-ink">
                {money(side === "client" ? allIn : takeHome) ?? "—"}
              </span>
            </div>
          </>
        )}
      </section>

      <section className="mb-3.5 rounded-2xl border border-line bg-linear-to-b from-[rgba(19,19,50,0.75)] to-[rgba(12,12,38,0.6)] px-5.5 py-5">
        <h3 className="font-display text-[17px] font-normal tracking-[-0.01em]">
          {side === "client" ? "Your invoices" : "Your pay invoices"}
        </h3>
        <p className="mb-1 mt-1 text-[12.5px] text-dim">
          {side === "client"
            ? "Every invoice on this job, newest last. Paid by bank transfer."
            : "Raised in your favour as the client approves each stage."}
        </p>

        {invoices.length === 0 ? (
          <div className="mt-3 rounded-2xl border border-dashed border-line2 bg-bg/30 px-5 py-6 text-center">
            <b className="mb-1 block text-[14px] font-semibold text-ink">No invoices yet</b>
            <p className="mx-auto max-w-[48ch] text-[12.5px] leading-relaxed text-dim">
              {side === "client"
                ? "The first will be Yaadly's Guarantee & Support fee once you have chosen a quote. Stage invoices follow, one per stage, each raised only after you approve that stage."
                : "A pay invoice is raised the moment the client approves a stage. Nothing appears here before that."}
            </p>
          </div>
        ) : (
          <div className="mt-1">
            {invoices.map((inv) => {
              const paid = inv.status === "paid";
              const isFee = inv.payable_to !== "worker";
              return (
                <div key={inv.id} className="flex gap-3.5 border-b border-line py-3.5 last:border-b-0">
                  <span
                    className={
                      "mt-1.5 size-[11px] shrink-0 rounded-full border-2 " +
                      (paid ? "border-green bg-green" : "border-gold bg-gold")
                    }
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2.5 text-[13.5px] font-semibold text-ink">
                      <span>
                        {isFee
                          ? "Yaadly Guarantee & Support fee"
                          : "Worker pay" + (inv.stage != null ? " · stage " + inv.stage : "")}
                      </span>
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
                      {inv.period_label ? " · " + inv.period_label : ""}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="mb-3.5 rounded-2xl border border-line bg-linear-to-b from-[rgba(19,19,50,0.75)] to-[rgba(12,12,38,0.6)] px-5.5 py-5">
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

function MoneyRow({
  colour,
  label,
  value,
  width,
  caption,
}: {
  colour: string;
  label: string;
  value: string;
  width: number;
  caption: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3 text-[13px]">
        <span className="flex items-center gap-2 text-mute">
          <i className={"size-2 shrink-0 rounded-sm " + colour} />
          {label}
        </span>
        <span className="whitespace-nowrap font-mono-app text-[13.5px] font-semibold text-ink">{value}</span>
      </div>
      <div className="h-[7px] overflow-hidden rounded-[4px] bg-bg/60">
        <span className={"block h-full rounded-[4px] " + colour} style={{ width: width + "%" }} />
      </div>
      <span className="text-[11.5px] leading-snug text-dim">{caption}</span>
    </div>
  );
}
