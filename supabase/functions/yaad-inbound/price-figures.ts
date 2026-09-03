// The figure guard: no number reaches a client that the site does not
// publish.
//
// The assistant is allowed to repeat Yaadly's own published service prices
// (faq.ts) and nothing else with a currency sign on it. A prompt is a strong
// preference, never a guarantee, and the one number this business cannot
// afford a model to improvise is a price. So the rule lives in code: every
// pound, J$ or percent figure in a reply is checked against the published
// list, and a sentence carrying any other figure is cut before the reply is
// sent. If nothing is left, the client gets the fixed sentence below, which
// says the true thing about who prices work.
//
// This is deliberately a list of exact figures, not a range check. A range
// would let "£150" through as close enough to £149, and close enough is how
// a client ends up quoted a number nobody agreed. Add a figure here when it
// is published on the site, in the same commit as faq.ts.

/** Figures published on yaadly.co.uk today. Pound amounts as integers,
 *  J$ amounts as integers, percents as integers. */
export const PUBLISHED_POUNDS = new Set([45, 70, 95, 125, 149, 245, 249, 349, 395, 495, 500, 2500]);
export const PUBLISHED_JMD = new Set([3500, 4500]);
export const PUBLISHED_PERCENTS = new Set([2, 5, 12, 15]);

export const NO_PRICE_SENTENCE =
  "Yaadly does not price the work itself; an identity checked worker quotes against the written scope. "
  + "Yaadly's own services and their published prices are at yaadly.co.uk/services.";

const POUNDS = /£\s?(\d[\d,]*)(?:\.\d+)?/g;
const JMD = /J\$\s?(\d[\d,]*)(?:\.\d+)?/g;
// "12 to 15%" is one published figure written as two numbers; both are on
// the list so both pass. A percent with a decimal point is never published.
const PERCENT = /(\d+(?:\.\d+)?)\s?%/g;

const num = (s: string) => Number(s.replace(/,/g, ""));

/** Every figure in the text that is not on the published list. */
export function unpublishedFigures(text: string): string[] {
  const bad: string[] = [];
  for (const m of String(text ?? "").matchAll(POUNDS)) if (!PUBLISHED_POUNDS.has(num(m[1]))) bad.push(m[0]);
  for (const m of String(text ?? "").matchAll(JMD)) if (!PUBLISHED_JMD.has(num(m[1]))) bad.push(m[0]);
  for (const m of String(text ?? "").matchAll(PERCENT)) {
    const v = Number(m[1]);
    if (!Number.isInteger(v) || !PUBLISHED_PERCENTS.has(v)) bad.push(m[0]);
  }
  return bad;
}

/** The reply with every sentence carrying an unpublished figure removed.
 *  Returns what is left, or the fixed no-price sentence if nothing is. */
export function priceFigureGuard(reply: string): { text: string; cut: string[] } {
  const cut = unpublishedFigures(reply);
  if (!cut.length) return { text: reply, cut };
  const kept = reply.split(/(?<=[.!?])\s+/).filter((sentence) => unpublishedFigures(sentence).length === 0);
  const text = kept.join(" ").trim();
  return { text: text || NO_PRICE_SENTENCE, cut };
}
