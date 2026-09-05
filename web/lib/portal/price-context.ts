/**
 * Where a quote sits against what Yaadly knows about real prices.
 *
 * ── Why this exists ──
 *
 * The founding "why", in the founder's own words: "I want to be able to
 * provide people pricing based on realistic costs, not people being priced
 * above because they're not local." Property work in Jamaica is priced
 * privately in WhatsApp DMs and four-agent research on 1 August 2026 found no
 * public prices anywhere in the country. That opacity is precisely what lets
 * an overseas owner be quoted more than the neighbour for identical work.
 *
 * A client cannot judge a number they have nothing to compare against. This
 * gives them the comparison.
 *
 * ── The line this must not cross, and how it stays on the right side ──
 *
 * Yaadly guarantees project management, procurement and oversight judgment.
 * It does NOT guarantee price estimation, which is quantity surveying and is
 * regulated work. CLAUDE.md section 5 is emphatic that pricing is a lookup and
 * never a model, and that "no public price exists in Jamaica for this work" is
 * a correct and complete answer rather than a gap.
 *
 * So four rules, and they are the whole design:
 *
 *   1. NO VERDICT. It never says a quote is too high, too low, fair or
 *      unfair. It says where the number sits and what the comparison is made
 *      of. The reader decides. A verdict is an estimate wearing a hat.
 *
 *   2. IT SHOWS ITS WORKING. Sample size and source travel with every
 *      statement. "3 quotes seen" is a very different claim from "40 quotes
 *      seen" and a reader is entitled to tell them apart.
 *
 *   3. IT SAYS NOTHING RATHER THAN SOMETHING THIN. Below MIN_OBSERVATIONS
 *      there is no spread worth showing, and a researched band with no
 *      figures stays "no public price exists", which is the honest answer and
 *      the reason the product exists.
 *
 *   4. BOTH SIDES SEE THE SAME THING. The Mirror Rule. A client told a quote
 *      is above typical, while the worker cannot see that and cannot answer
 *      it, is a protection with no counterpart. The worker is also the one
 *      who knows the access is bad, so the copy names that.
 */

import { PRICE_BENCHMARKS, type GeneratedBand } from "./price-bands";

/** One real quoted price, from price_observations. */
export type Observation = { labour_jmd: number | null };

/**
 * Fewer than this and the spread is noise. Three is not a market, but it is
 * enough to say "here is what we have seen" honestly with the count attached,
 * which is the whole point: the reader can discount it themselves.
 */
export const MIN_OBSERVATIONS = 3;

export type PriceContext = {
  /** Rendered only when true. False means there is nothing honest to say. */
  show: boolean;
  /** The researched band, when one exists with real figures. */
  band: { low: number; high: number; confidence: string; source: string } | null;
  /** What Yaadly has actually seen quoted for this trade. */
  observed: { count: number; low: number; high: number; middle: number } | null;
  /** True when the researched answer is that no public price exists. */
  noPublicPrice: boolean;
  /** Where this quote sits, in plain words. Never a judgement. */
  position: string | null;
};

function bandFor(trade: string | null | undefined): GeneratedBand | null {
  const fam = PRICE_BENCHMARKS.taxonomy_to_benchmark[String(trade ?? "")];
  if (!fam) return null;
  const b = PRICE_BENCHMARKS.bands;
  // The ":*" default only. A variant is a judgement about which kind of job
  // this is, and nobody has made it here.
  return b[`${fam}:*`] ?? null;
}

export function priceContext(
  trade: string | null | undefined,
  labourJmd: number | null | undefined,
  observations: Observation[],
): PriceContext {
  const labour = Number(labourJmd ?? 0);
  const empty: PriceContext = {
    show: false, band: null, observed: null, noPublicPrice: false, position: null,
  };
  if (!(labour > 0)) return empty;

  const raw = bandFor(trade);
  const hasFigures = !!raw && raw.low_jmd !== null && raw.high_jmd !== null;
  const band = hasFigures
    ? { low: Number(raw!.low_jmd), high: Number(raw!.high_jmd), confidence: raw!.confidence, source: raw!.source }
    : null;
  const noPublicPrice = !!raw && !hasFigures;

  const nums = observations
    .map((o) => Number(o.labour_jmd ?? 0))
    .filter((n) => n > 0)
    .sort((a, b) => a - b);
  const observed = nums.length >= MIN_OBSERVATIONS
    ? { count: nums.length, low: nums[0], high: nums[nums.length - 1], middle: nums[Math.floor(nums.length / 2)] }
    : null;

  if (!band && !observed && !noPublicPrice) return empty;

  // Where it sits. Stated as a position, never as a verdict, and only against
  // whichever comparison is actually solid. The researched band wins when both
  // exist, because it is sourced and an observation set is only ever "what we
  // happen to have seen".
  let position: string | null = null;
  const ref = band ?? (observed ? { low: observed.low, high: observed.high } : null);
  if (ref) {
    if (labour < ref.low) position = "below";
    else if (labour > ref.high) position = "above";
    else position = "within";
  }

  return { show: true, band, observed, noPublicPrice, position };
}

/** The sentence a client or a worker reads. Same words for both, on purpose. */
export function priceSentence(ctx: PriceContext, labourJmd: number): string {
  if (!ctx.show) return "";
  const j = (n: number) => "J$" + Math.round(n).toLocaleString();

  if (ctx.band) {
    const where =
      ctx.position === "within"
        ? `sits inside the range Yaadly has on record for this trade, ${j(ctx.band.low)} to ${j(ctx.band.high)}`
        : ctx.position === "above"
          ? `sits above that range, which tops out near ${j(ctx.band.high)}`
          : `sits below that range, which starts near ${j(ctx.band.low)}`;
    return `The labour on this quote, ${j(labourJmd)}, ${where}. Source: ${ctx.band.source}.`;
  }

  if (ctx.noPublicPrice && ctx.observed) {
    return `There is no public price in Jamaica for this kind of work, so there is no official figure to check against. `
      + `What Yaadly has seen is ${ctx.observed.count} real quotes for this trade, from ${j(ctx.observed.low)} to ${j(ctx.observed.high)} for labour.`;
  }
  if (ctx.noPublicPrice) {
    return "There is no public price in Jamaica for this kind of work, so there is no figure to check this against. "
      + "Yaadly prices from materials and a day rate instead, and every quote reviewed builds the record.";
  }
  if (ctx.observed) {
    return `Yaadly has seen ${ctx.observed.count} real quotes for this trade, from ${j(ctx.observed.low)} to ${j(ctx.observed.high)} for labour. `
      + `This one is ${j(labourJmd)}.`;
  }
  return "";
}

/**
 * The caveat, shown with every sentence above and never optional.
 *
 * It is doing real work. Without it a range reads as a valuation, which is the
 * thing Yaadly does not do and must not be understood to be doing. It also
 * names the legitimate reasons a quote sits outside a range, which is what
 * stops this becoming a stick to beat a tradesperson with.
 */
export const PRICE_CAVEAT =
  "This is a reference, not a valuation. Yaadly does not price the trade work: the tradesperson sets their own "
  + "labour price against the written scope. Access, the spec, and what materials cost this month all move a fair "
  + "price legitimately, so a quote outside the range is a question worth asking rather than an answer.";
