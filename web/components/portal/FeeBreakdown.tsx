import { jmd } from "@/lib/money";

/**
 * The settled fee panel, from the preview's `feeClient()` and `feeWorker()`.
 *
 * QuotePanel already shows this arithmetic while a quote is being built. This
 * is the version for after a worker is chosen: the same numbers, past tense,
 * on the job itself, so neither side has to remember what they agreed to.
 *
 * Two rules the layout is enforcing, not decorating:
 *   the fee is charged on labour only, never on materials
 *   the client sees the all-in total, because a mandatory platform charge has
 *   to sit inside the displayed price rather than appear at the end
 */

export function FeeBreakdown({
  side,
  labour,
  materials,
  materialsAtCost,
  workerName,
}: {
  side: "client" | "worker";
  labour: number | null;
  materials: number | null;
  materialsAtCost: boolean | null;
  workerName?: string | null;
}) {
  if (labour == null) return null;
  const mat = materials ?? 0;

  if (side === "client") {
    const fee = Math.round(labour * 0.15);
    return (
      <section className="mt-4 rounded-2xl border border-line bg-panel p-5">
        <h2 className="mb-3 text-[10.5px] font-bold uppercase tracking-[.2em] text-tealb">
          What you are paying
        </h2>
        <dl className="grid grid-cols-[1fr_auto] gap-y-2 text-[14px] tabular-nums">
          <dt className="text-mute">
            {workerName ? workerName + "'s labour price" : "Labour price"}
          </dt>
          <dd className="text-right text-mute">{jmd(labour)}</dd>
          <dt className="text-mute">Guarantee &amp; Support, 15%</dt>
          <dd className="text-right text-mute">+{jmd(fee)}</dd>
          <dt className="text-mute">
            Materials{materialsAtCost ? ", at cost" : ""}
          </dt>
          <dd className="text-right text-mute">{jmd(mat)}</dd>
          <dt className="col-span-2 mt-1 h-px bg-line" />
          <dt className="font-bold text-ink">Total, all in</dt>
          <dd className="text-right font-bold text-ink">
            {jmd(labour + fee + mat)}
          </dd>
        </dl>
        <p className="mt-3 text-[12.5px] leading-relaxed text-dim">
          This is the number you were shown before you accepted. Nothing is
          added at the end, and materials are never fee&rsquo;d.
        </p>
      </section>
    );
  }

  const fee = Math.round(labour * 0.12);
  return (
    <section className="mt-4 rounded-2xl border border-line bg-panel p-5">
      <h2 className="mb-3 text-[10.5px] font-bold uppercase tracking-[.2em] text-tealb">
        What you keep
      </h2>
      <dl className="grid grid-cols-[1fr_auto] gap-y-2 text-[14px] tabular-nums">
        <dt className="text-mute">Your labour price</dt>
        <dd className="text-right text-mute">{jmd(labour)}</dd>
        <dt className="text-mute">Yaadly fee, 12%</dt>
        <dd className="text-right text-mute">&minus;{jmd(fee)}</dd>
        <dt className="text-mute">
          Materials{materialsAtCost ? ", at cost" : ""}
        </dt>
        <dd className="text-right text-mute">{jmd(mat)}</dd>
        <dt className="col-span-2 mt-1 h-px bg-line" />
        <dt className="font-bold text-ink">You receive</dt>
        <dd className="text-right font-bold text-tealb">
          {jmd(labour - fee + mat)}
        </dd>
      </dl>
      <p className="mt-3 text-[12.5px] leading-relaxed text-dim">
        You keep 88%. Nothing to join, nothing per quote, nothing per lead.
      </p>
    </section>
  );
}
