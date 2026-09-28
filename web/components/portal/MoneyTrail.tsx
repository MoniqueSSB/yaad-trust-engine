/**
 * Where the money is, on the Money tab (founder, 28 Sep 2026): for the client
 * and the worker alike, what has been billed and paid in, what has gone out
 * to the worker and what is still owed to them, and the materials money.
 * The Mirror Rule: both sides read the same trail. Nothing here moves money;
 * every figure is read from a record a named person made.
 *
 * Who-has-been-paid comes from job_worker_payments() (20260929060000), which
 * gives both parties each worker pay invoice's stage, labour share and
 * whether it is owed or paid, and never the worker's net figure or payout
 * details.
 */

export type TrailBill = { id: string; label: string; total: number | null; paid: boolean; paidAt: string | null };
export type TrailWorkerPay = { id: string; what: string; labour: number | null; paid: boolean; paidAt: string | null };
/** due: money sent, no receipt yet. filed: the worker has uploaded one.
 *  recorded: a person at Yaadly has recorded it against the money. */
export type TrailMaterials = { released: number; quoted: number; receipt: "due" | "filed" | "recorded" };

function Row({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line py-2 last:border-b-0">
      <span className="text-[13px] text-mute">
        {label}
        {note && <span className="mt-0.5 block text-[11.5px] text-dim">{note}</span>}
      </span>
      <b className="font-mono-app text-[14px] text-ink">{value}</b>
    </div>
  );
}

export function MoneyTrail({
  side,
  bills,
  workerPays,
  materials,
  money,
  day,
  workerName,
}: {
  side: "client" | "worker";
  /** The client's bills on this job. Shown to the client only: the worker
      has no read on them, and says so. */
  bills: TrailBill[];
  workerPays: TrailWorkerPay[];
  materials: TrailMaterials | null;
  money: (n: number | null | undefined) => string | null;
  day: (iso: string | null | undefined) => string | null;
  workerName: string;
}) {
  const billed = bills.reduce((t, b) => t + (b.total ?? 0), 0);
  const paidIn = bills.filter((b) => b.paid).reduce((t, b) => t + (b.total ?? 0), 0);
  const paidOut = workerPays.filter((p) => p.paid).reduce((t, p) => t + (p.labour ?? 0), 0);
  const owed = workerPays.filter((p) => !p.paid).reduce((t, p) => t + (p.labour ?? 0), 0);
  const who = side === "worker" ? "you" : workerName;

  return (
    <section className="mb-3.5 rounded-2xl border border-line bg-linear-to-b from-[rgba(19,19,50,0.75)] to-[rgba(12,12,38,0.6)] px-5.5 py-5">
      <h3 className="font-display text-[17px] font-normal tracking-[-0.01em]">Where the money is</h3>
      <p className="mb-3 mt-1 text-[12.5px] text-dim">
        Everything paid in and paid out on this job, from the records. Yaadly marks each payment by hand, so a
        payment shows here once a person has recorded it.
      </p>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-line bg-bg/40 px-4 py-2">
          <p className="pt-1 text-[10.5px] font-bold uppercase tracking-[.16em] text-tealb">
            {side === "client" ? "What you have paid Yaadly" : "What the client pays Yaadly"}
          </p>
          {side === "client" ? (
            <>
              <Row label="Billed so far" value={money(billed) ?? "J$0"} />
              <Row label="Paid" value={money(paidIn) ?? "J$0"} />
              <Row label="Still to pay" value={money(billed - paidIn) ?? "J$0"} />
            </>
          ) : (
            <p className="py-2 text-[12.5px] leading-relaxed text-dim">
              The client pays Yaadly for the job, and Yaadly pays you. Their bills are between them and Yaadly, so
              they are not shown here.
            </p>
          )}
        </div>

        <div className="rounded-xl border border-line bg-bg/40 px-4 py-2">
          <p className="pt-1 text-[10.5px] font-bold uppercase tracking-[.16em] text-tealb">
            {side === "client" ? "What Yaadly has paid the tradesperson" : "What Yaadly has paid you"}
          </p>
          <Row label="Labour paid out" value={money(paidOut) ?? "J$0"} />
          <Row label="Labour owed, approved and waiting to be paid" value={money(owed) ?? "J$0"} />
          {materials && materials.quoted > 0 && (
            <Row
              label="Materials money sent"
              value={(money(materials.released) ?? "J$0") + " of " + (money(materials.quoted) ?? "")}
              note={
                materials.released > 0
                  ? materials.receipt === "recorded"
                    ? "Receipt recorded by Yaadly"
                    : materials.receipt === "filed"
                      ? "Receipt filed, being checked"
                      : "Receipt still to come"
                  : undefined
              }
            />
          )}
          {side === "worker" && (
            <p className="py-2 text-[11.5px] text-dim">Labour is shown before Yaadly&rsquo;s 5%. Your pay invoices below show what reaches you.</p>
          )}
        </div>
      </div>

      <p className="mt-4 text-[10.5px] font-bold uppercase tracking-[.16em] text-tealb">Who has been paid, stage by stage</p>
      {workerPays.length === 0 ? (
        <p className="mt-2 text-[12.5px] text-dim">
          Nothing yet. A payment to {who} is raised when the client approves a stage or a piece of extra work.
        </p>
      ) : (
        <ul className="mt-2 grid gap-1.5">
          {workerPays.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-bg/40 px-3.5 py-2.5 text-[12.5px]">
              <b className="text-ink">{p.what}</b>
              <span className="text-dim">{money(p.labour) ?? ""} labour</span>
              <span
                className={
                  "ml-auto rounded-full px-2.5 py-0.5 text-[10.5px] font-bold uppercase tracking-wide " +
                  (p.paid ? "bg-tealb/15 text-tealb" : "bg-mango/15 text-mango")
                }
              >
                {p.paid ? "Paid to " + who + (p.paidAt ? ", " + day(p.paidAt) : "") : "Approved, not paid yet"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
