/* ── reply-from-card.ts ───────────────────────────────────────────────────
 *
 * The reply you can write without a model, from what the classifier already
 * found.
 *
 * WHY THIS EXISTS. Splitting the one model call into two (classify, then
 * write) creates a state that did not exist before: the classifier worked and
 * the writer did not. Either it failed, or the request ran out of clock and
 * was never started. Without something here, that state would fall back to
 * the fixed generic opener, which throws away a perfectly good reading of
 * their message and asks a person who has just told you about their roof what
 * needs doing.
 *
 * So this builds the reply out of the card. It is worse prose than the model
 * writes. It is much better than the generic opener, because it proves they
 * were heard and it asks for the right missing thing.
 *
 * WHAT IT WILL NOT DO, and these are the same rules the prompt carries:
 * no price, no figure of any kind, no date, no promise about what happens
 * next, and no dash characters. The composed text still goes through
 * stripPromises, priceFigureGuard and the banned-language screen like any
 * other reply, so this is belt and braces rather than the only guard. Its own
 * test asserts the screen passes everything it can produce.
 *
 * The two missing things it asks for are the two a worker would refuse to
 * quote without, which is the same bar the prompt sets for "enough": which
 * parish, and who can let a worker in.
 */

export type Card = {
  title?: string; scope?: string; trade?: string; urgency?: string;
  parish?: string; client_name?: string; access_note?: string;
  questions?: string[]; enough?: boolean; confirmed?: boolean; wants_human?: boolean;
};

const s = (v: unknown) => String(v ?? "").trim();

/** Their own words for the job, preferred over ours, and short enough for a
 *  phone. Falls back through the card in the order a person would recognise. */
function whatTheySaid(card: Card): string {
  const scope = s(card.scope);
  if (scope) return scope.length > 160 ? scope.slice(0, 157).trimEnd() + "..." : scope;
  const title = s(card.title);
  if (title) return title;
  const trade = s(card.trade);
  return trade ? trade.toLowerCase() : "";
}

/** What is still missing, in the order it is worth asking. */
export function missingFrom(card: Card): string[] {
  const gaps: string[] = [];
  if (!whatTheySaid(card)) gaps.push("what needs doing");
  if (!s(card.parish)) gaps.push("which parish the property is in");
  if (!s(card.access_note)) gaps.push("who can let a worker in");
  return gaps;
}

/** A reply built from the card alone. `stage` is what the pipeline decided,
 *  so this cannot disagree with the sentence the code appends after it. */
export function replyFromCard(card: Card, stage: "gathering" | "confirming" | "done"): string {
  const said = whatTheySaid(card);
  const heard = said ? `Got it, ${said}.` : "Thanks for writing in.";

  if (stage === "confirming" || stage === "done") {
    // Read it back. Everything known, in plain sentences, nothing invented.
    const bits: string[] = [];
    if (said) bits.push(said);
    if (s(card.parish)) bits.push(`in ${s(card.parish)}`);
    const line = bits.join(" ");
    const access = s(card.access_note) ? ` ${s(card.access_note)} can let a worker in.` : "";
    return `Let me read that back. ${line ? line.charAt(0).toUpperCase() + line.slice(1) + "." : ""}${access}`.replace(/\s+/g, " ").trim();
  }

  // At most two, the same cap the prompt sets, because a phone screen is not
  // a form and three questions at once gets one answer.
  const gaps = missingFrom(card).slice(0, 2);
  if (!gaps.length) return heard;

  const asked = gaps.length === 1 ? gaps[0] : `${gaps[0]}, and ${gaps[1]}`;
  return `${heard} Can you tell me ${asked}?`;
}
