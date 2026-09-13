import { priceContext, priceSentence, PRICE_CAVEAT, type Observation } from "@/lib/portal/price-context";

/**
 * Where a quote sits, in words, for whoever is reading.
 *
 * No `role` prop, deliberately. Client and worker see identical text: a client
 * told their quote is above typical, while the worker cannot see that and
 * cannot answer it, is a protection with no counterpart. The Mirror Rule.
 *
 * Renders nothing at all when there is nothing honest to say, which is most of
 * the time on a young data set and is the correct behaviour rather than a
 * failure. The caveat is not optional and travels with every statement: a
 * range without it reads as a valuation, and valuing work is quantity
 * surveying, which is the one thing Yaadly does not guarantee.
 *
 * Moved out of the job room on 13 Sep 2026 so the quoting worker's room
 * (QuotedJobRoom) shows the same words the client sees.
 */
export function PriceContextNote({
  trade,
  labour,
  observations,
}: {
  trade: string | null;
  labour: number | null;
  observations: Observation[];
}) {
  const ctx = priceContext(trade, labour, observations);
  if (!ctx.show || !labour) return null;
  const sentence = priceSentence(ctx, labour);
  if (!sentence) return null;

  return (
    <div className="mt-3 rounded-xl border border-line bg-bg/40 px-3.5 py-3">
      <b className="block text-[10.5px] font-bold uppercase tracking-[.15em] text-dim">
        For comparison
      </b>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-mute">{sentence}</p>
      <p className="mt-2 text-[11.5px] leading-relaxed text-dim">{PRICE_CAVEAT}</p>
    </div>
  );
}

/** The aggregate from price_spread_for_trade arrives as low, high and middle,
 *  and priceContext wants the raw figures it would have derived them from.
 *  Feeding it the three we have is enough for the count and the spread, which
 *  is all it renders. */
export function observationsFromSpread(
  spread: { n?: number | string | null; low_jmd?: number | string | null; high_jmd?: number | string | null; middle_jmd?: number | string | null } | null | undefined,
): Observation[] {
  if (!spread?.n) return [];
  const n = Number(spread.n);
  return Array.from({ length: n }, (_, i) => ({
    labour_jmd: i === 0 ? Number(spread.low_jmd) : i === n - 1 ? Number(spread.high_jmd) : Number(spread.middle_jmd),
  }));
}
