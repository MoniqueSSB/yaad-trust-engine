import { chooseJobCheck, clearJobCheck } from "@/app/portal/job-check-actions";
import { CHECK_LABEL, type CheckLevel, type CheckState } from "@/lib/portal/job-check";
import { gbp } from "@/lib/money";

/**
 * The independent check at sign-off, PORTALS-BUILD-SPEC section 5.11 given a
 * real path. Optional: the default is that the client approves from the
 * evidence themselves, and that stays the default. Choosing a check changes
 * who attends the finished stage, never who approves, so this panel sits
 * beside the Approve button and never in front of it.
 *
 * Prices come from service_catalogue, read by the page, never typed here.
 * These are the MARKETPLACE rungs (job-visual-check, job-technical-check),
 * not the £149 professional Visual Check on the services page.
 *
 * Server component: both actions are Postgres functions and the panel
 * re-renders from the row they wrote.
 */

export type CheckPrice = {
  id: string;
  name: string;
  blurb: string;
  full_pence: number | null;
  founding_pence: number | null;
};

export type CheckInvoice = {
  id: string;
  status: string | null;
  total_pence: number | null;
  currency: string | null;
};

function priceLine(p: CheckPrice | null): string {
  if (!p || p.full_pence == null) return "price on request";
  const full = gbp(p.full_pence);
  if (p.founding_pence != null && p.founding_pence !== p.full_pence) {
    return full + ", " + gbp(p.founding_pence) + " at the founding rate";
  }
  return full;
}

export function JobCheckPanel({
  jobId,
  role,
  state,
  canChange,
  level,
  chosenAt,
  assignedTo,
  invoice,
  prices,
}: {
  jobId: string;
  role: "client" | "worker";
  state: CheckState;
  canChange: boolean;
  level: CheckLevel | null;
  chosenAt: string | null;
  assignedTo: string | null;
  invoice: CheckInvoice | null;
  prices: Record<CheckLevel, CheckPrice | null>;
}) {
  if (state === "not_yet") return null;

  /* The worker's view is one sentence. They do not choose it, they do not
     pay for it, and it changes nothing about their evidence or what they are
     owed. The Mirror Rule: they should still know somebody is coming. */
  if (role === "worker") {
    return (
      <section id="check" className="mt-4 rounded-2xl border border-line bg-panel p-4">
        <p className="text-[10.5px] font-bold uppercase tracking-[.2em] text-tealb">Independent check</p>
        <p className="mt-1 text-[12.5px] leading-relaxed text-dim">
          {level
            ? "The client has booked a " + CHECK_LABEL[level] + ". Somebody independent of you attends the finished stage and files what they saw. It changes nothing about your evidence or what you are owed."
            : "No independent check is booked on this job. The client approves from your evidence."}
          {level && assignedTo ? " Attending: " + assignedTo + "." : ""}
        </p>
      </section>
    );
  }

  return (
    <section id="check" className="mt-4 rounded-2xl border border-line bg-panel p-4">
      <p className="text-[10.5px] font-bold uppercase tracking-[.2em] text-tealb">Independent check at sign-off</p>
      <p className="mt-1 text-[12px] leading-relaxed text-dim">
        Optional. By default you approve each stage yourself from the evidence, and that costs nothing.
        If you would rather somebody independent of the worker attended the finished stage and filed what
        they saw, choose a level here. <b className="text-ink">It is a record for your sign-off, not a ruling</b>:
        you still press Approve yourself, and nothing here moves any payment.
      </p>

      {state === "open" && (
        <>
          <ul className="mt-3 grid gap-2.5 sm:grid-cols-2">
            {(["visual", "technical"] as CheckLevel[]).map((k) => {
              const p = prices[k];
              return (
                <li key={k} className="rounded-xl border border-line bg-bg px-3.5 py-3">
                  <p className="text-[13.5px] font-bold text-ink">{CHECK_LABEL[k]}</p>
                  <p className="mt-0.5 text-[12.5px] font-semibold text-tealb">{priceLine(p)}</p>
                  <p className="mt-1.5 text-[12px] leading-relaxed text-dim">
                    {p?.blurb ??
                      (k === "visual"
                        ? "An independent looker confirms it is visibly done and basically works. They record. They do not rate, advise or certify."
                        : "A technically trained inspector reviews the stage against the agreed scope and the trade standard.")}
                  </p>
                  <form action={chooseJobCheck} className="mt-2.5">
                    <input type="hidden" name="jobId" value={jobId} />
                    <input type="hidden" name="level" value={k} />
                    <button className="rounded-full bg-linear-to-r from-teal to-mango px-4 py-2 text-[12.5px] font-bold text-onbrand">
                      Add this
                    </button>
                  </form>
                </li>
              );
            })}
          </ul>
          <p className="mt-2.5 text-[11.5px] leading-relaxed text-dim">
            Visits not agreed at the start are chargeable. The choice stays open until the final stage&rsquo;s
            evidence is filed; after that, message us on WhatsApp and a person will arrange it.
          </p>
        </>
      )}

      {state === "locked" && (
        <p className="mt-3 rounded-xl border border-line bg-bg px-3.5 py-3 text-[12.5px] leading-relaxed text-mute">
          The final stage&rsquo;s evidence is already in, so a check cannot be added from here.
          Visits not agreed at the start are chargeable: message us on WhatsApp and a person will arrange one.
        </p>
      )}

      {state === "chosen" && level && (
        <div className="mt-3 rounded-xl border border-softline bg-soft px-3.5 py-3">
          <p className="text-[13px] text-mute">
            <b className="text-tealb">Booked:</b> {CHECK_LABEL[level]}
            {chosenAt ? ", chosen " + new Date(chosenAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : ""}.
          </p>
          <p className="mt-1 text-[12.5px] text-dim">
            {assignedTo ? "Attending: " + assignedTo + "." : "Yaadly is arranging who attends. You will see the name here."}
          </p>
          <p className="mt-1 text-[12.5px] text-dim">
            {invoice
              ? "Invoice " + invoice.id + (invoice.total_pence != null && invoice.currency === "GBP" ? ", " + gbp(invoice.total_pence) : "") + ", " + (invoice.status ?? "raised") + "."
              : "Priced at " + priceLine(prices[level]) + ". The invoice follows from Yaadly, separately from the job itself."}
          </p>
          {canChange && !assignedTo && !invoice ? (
            <form action={clearJobCheck} className="mt-2">
              <input type="hidden" name="jobId" value={jobId} />
              <button className="text-[11.5px] text-dim underline-offset-2 hover:underline hover:text-coral">
                Remove this check
              </button>
            </form>
          ) : (
            <p className="mt-2 text-[11.5px] text-dim">To change or cancel this, message us on WhatsApp.</p>
          )}
        </div>
      )}
    </section>
  );
}
