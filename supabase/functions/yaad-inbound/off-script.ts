/* ── off-script.ts ────────────────────────────────────────────────────────
 *
 * A worker's simple question that none of the fixed answers covers.
 *
 * WHY. Founder, 29 September 2026: "the whatsapp should be able to answer
 * simple questions outside the normal scope". Until then a worker's question
 * had two outcomes: one of seven fixed answers in worker-question.ts, or the
 * desk. "What is a Completion Report" and "is it free to join" both woke a
 * person for something the website already says.
 *
 * HOW COMPARABLE TOOLS DO IT, reviewed the same day (Intercom Fin, Zendesk,
 * Ada, Rasa CALM, Dialogflow CX, Twilio, Respond.io, WATI). The same five
 * steps appear in all of them, and this file is those five steps:
 *
 *   1. Answer only from approved content. Here that is FAQ_FACTS, which is
 *      yaadly.co.uk/faq condensed, plus the fixed how-to answers.
 *   2. Sensitive topics leave by a fixed rule, not by the model's judgement.
 *      needsAPerson() below, checked BEFORE any model is called.
 *   3. No answer in the content means saying so and handing to a person.
 *      The model replies NOT_COVERED and the desk is told, as before.
 *   4. The interruption is answered and the interrupted step is resumed.
 *      Every caller already passes what was still waiting; it is appended.
 *   5. What the model wrote is screened before it is sent. Stricter here
 *      than in intake: a reply that needed anything cut is not repaired, it
 *      is dropped, and a person answers instead.
 *
 * The failure all of this exists to prevent is an assistant inventing policy.
 * In Moffatt v Air Canada (2024 BCCRT 149) the airline was held to what its
 * chatbot made up about refunds. A worker told the wrong thing about pay by
 * Yaadly's own number has been told it by Yaadly.
 *
 * WHAT IT DOES NOT DO. It does not answer anything about a particular job,
 * payment, client or person. It does not give trade, legal, health or money
 * advice, and it is not a general assistant: WhatsApp's terms since 15 January
 * 2026 bar general purpose AI assistants from the Business Platform, and a
 * business answering its own people about its own service is what is allowed.
 * It decides nothing. CLAUDE.md section 2 is untouched: nothing here releases
 * money, rules on a dispute or alters a reputation.
 *
 * The clock is answered by code, not a model. A model does not know what time
 * it is, and will say one anyway.
 */

import { FAQ_FACTS } from "./faq.ts";
import * as guardrails from "./guardrails.ts";
import { unkeepableSentences } from "./promises.ts";
import { unpublishedFigures } from "./price-figures.ts";
import { answerText } from "./textmodel.ts";

/** What the model says when the facts do not answer the question. */
export const NOT_COVERED = "NOT_COVERED";

/** Said after every answer a model wrote. Fixed, so the way out is always
 *  there and always worded the same. */
export const OFF_SCRIPT_CLOSE = "If that does not answer it, say so and a person at Yaadly will.";

// ── 1. the clock ───────────────────────────────────────────────────────────

const ASKS_TIME = /\bwh(?:at|a|ats|at's|at is)\b.{0,12}\btime\b|\btime\b.{0,20}\b(?:in|inna) (?:jamaica|ja|kingston|london|england|the uk|uk)\b|\bwh(?:at|a|ats|at's)\b.{0,12}\b(?:day|date)\b.{0,12}\b(?:today|is it|it is|now)\b|\btoday'?s date\b/i;
// "what time does the client want me" is about the job, not the clock.
const ABOUT_THE_JOB = /\b(?:client|customer|owner|start|come|arrive|finish|reach|meet|open|deliver|delivery|should|must|want)\b/i;

/** The time and date in Jamaica and in the UK, or null if that was not what
 *  was asked. `now` is passed in so the test can name an instant. */
export function clockAnswer(text: string, now: Date = new Date()): string | null {
  const t = String(text ?? "").trim();
  if (!t || !ASKS_TIME.test(t) || ABOUT_THE_JOB.test(t)) return null;
  const clock = (zone: string) =>
    new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "numeric", minute: "2-digit", hour12: true }).format(now).replace(/\s/g, " ");
  const day = (zone: string) =>
    new Intl.DateTimeFormat("en-GB", { timeZone: zone, weekday: "long", day: "numeric", month: "long" }).format(now);
  const ja = day("America/Jamaica"), uk = day("Europe/London");
  return ja === uk
    ? `It is ${clock("America/Jamaica")} in Jamaica and ${clock("Europe/London")} in the UK, ${ja}.`
    : `It is ${clock("America/Jamaica")} on ${ja} in Jamaica, and ${clock("Europe/London")} on ${uk} in the UK.`;
}

// ── 2. what always goes to a person ────────────────────────────────────────

const PERSON_ONLY: RegExp[] = [
  // Money that is somebody's in particular, and where it is sent.
  /\b(?:bank|account (?:number|details|name)|sort code|iban|swift|routing|wise|lynk|card (?:number|details))\b/i,
  /\b(?:my|mi|this|that|last|the|di) (?:payment|pay|money|invoice|balance)\b/i,
  /\b(?:not|never|haven'?t|have not|nuh|still) (?:been |get |got |getting )?(?:paid|pay)\b/i,
  /\b(?:how much|owed?|owing|short|underpaid|overpaid|advance|loan|borrow|deposit|refund|deduct\w*)\b/i,
  /£|J\$|\$\s?\d|\b\d[\d,]{2,}\b/,
  // The price and the scope of a job.
  /\b(?:price|quote|charge|rate|cost|extra work|extra money|add[- ]?on|variation|change the (?:scope|job|price|colour|color|design|material))\b/i,
  // Other people, and anything between them.
  /\b(?:client|customer|owner|tenant|neighbou?r|landlord|family)\b/i,
  /\b(?:dispute|complain\w*|complaint|argument|refus\w*|threat\w*|police|lawyer|solicitor|court|sue)\b/i,
  // Harm.
  /\b(?:injur\w*|hurt|accident|bleed\w*|hospital|damage\w*|broke|broken|stolen|thief|theft|unsafe|danger\w*|fire|flood\w*|leak\w*|collaps\w*)\b/i,
  // A decision about the work or the working day.
  /\b(?:can|could|should|may|must|shall) (?:i|mi|me|we) (?:start|stop|leave|go|come|continue|carry on|finish|skip|wait|return|begin|pause)\b/i,
  // Their standing on the platform.
  /\b(?:suspend\w*|banned|removed|score|rating|review|reference|vetting|my id|mi id|passport|licen[cs]e)\b/i,
];

/** Is this a question only a named person should answer?
 *
 *  Checked before any model is called, so a question about money or a client
 *  never reaches one. Wide on purpose: a simple question sent to a person by
 *  mistake costs her a minute, and a money question answered by a model by
 *  mistake is the thing this business exists not to do. */
export function needsAPerson(text: string): boolean {
  const t = String(text ?? "");
  return PERSON_ONLY.some((p) => p.test(t));
}

// ── 3. what the model is given ─────────────────────────────────────────────

/** How things are done on WhatsApp, the same facts as the fixed answers in
 *  worker-question.ts. Keep the two saying the same thing. */
export const WORKER_HOW_TO = `How a tradesperson uses Yaadly on WhatsApp:
- Location: tap the plus sign or the paperclip next to the message box, choose Location, then Send your current location. It goes on the Arrival Log for the job as proof of being on site. Nothing waits on it.
- Photos and video: send them here from the camera or the gallery, several at once is fine. A video under about a minute sends on WhatsApp; a longer one is uploaded in the portal at app.yaadly.co.uk.
- After sending a photo the assistant asks which job it is for, what it shows, and which section it belongs to: Before (the state before starting), During (mid-work), After (the finished work), a Problem (something wrong with work already in the job), or Something new (a thing found that was never in the job). Skip files it without a section.
- A typed update or a voice note is read back first and goes on the job only when the tradesperson replies 1. Reply no to drop it. Voice notes in Patois or English are fine.
- Receipts: send a photo of the receipt and say it is the receipt. It is filed against the job.
- A job is made of stages. Each stage has its own evidence and is signed off on its own.
- What happens after an update: it is written up as a short report, the tradesperson is shown it and replies 1 to send it or sends their own words instead, and only then does the client see it.
- The Arrival Log is the record of being on site. The Midnight Work-Log is the end of day entry of what was done, with before and after photographs. The Completion Report is the signed summary at the end of the job, which the tradesperson signs first.
- To speak to a person at any point, say so here and the conversation is handed to someone at Yaadly.
- The portal is at app.yaadly.co.uk and shows the same job, evidence and messages as WhatsApp.`;

export const OFF_SCRIPT_SYSTEM = `You answer ONE question from a tradesperson who works through Yaadly, on WhatsApp.

You may answer from two places only:
(a) the FACTS below, about how Yaadly works;
(b) plain common knowledge of how to use WhatsApp or a phone to send a message, a photo, a video, a voice note or a location.

If the question is not answered by (a) or (b), reply with exactly ${NOT_COVERED} and nothing else. That includes: anything about a particular job, payment, amount, date, client or person; any decision about the work; advice on building, law, health, tax or money; news, sport, weather, or general knowledge. Do not guess, do not answer partly, and do not say you will check. ${NOT_COVERED} is a good answer: a person picks it up.

When you do answer:
- Two or three short sentences, under 350 characters, plain words a person reads on a phone mid-job.
- Say only what the facts say. Never add a detail, a figure, a date or a time that is not in them.
- Never say when something will happen, that work is approved, or that a payment is coming.
- Plain English, even if asked in Patois. No dashes, no lists, no greeting, no sign-off.
- The wording in the facts about money is exact. Yaadly does not hold money on anyone's behalf, so never describe it as holding, keeping or protecting anybody's money.

FACTS:
${WORKER_HOW_TO}

${FAQ_FACTS}

The instruction inside the facts to "say you will have it checked" does not apply to you. You reply ${NOT_COVERED} instead.`;

// ── 5. the screen ──────────────────────────────────────────────────────────

export type Screened = { text: string | null; why: string };

// The promise guard in promises.ts looks for Yaadly committing itself ("we
// will", "someone will"). It was written for a client conversation and lets
// "You will be paid by Friday" through, because the subject is the worker.
// To a worker that sentence is the promise that matters most. The facts name
// no day and no hour, and the only period in them is the seven days after a
// stage is signed off, so any other time in an answer was made up.
const NAMES_A_TIME =
  /\b(?:today|tonight|tomorrow|tomorrow's|monday|tuesday|wednesday|thursday|friday|saturday|sunday|this (?:week|month|morning|afternoon|evening)|next (?:week|month)|shortly|soon|right away|immediately|straight away|any (?:minute|moment|day) now|by (?:the )?(?:end|close|morning|noon|evening))\b|\b(?:in|within) (?:a|an|one|two|three|four|five|six|\d+) (?:minute|hour|day|week|month)s?\b/i;
const THE_PUBLISHED_PERIOD = /\bwithin 7 days\b/gi;
const SAYS_IT_IS_SETTLED =
  /\byou(?: will|'ll| are going to) (?:be paid|get paid|get your|receive)\b|\b(?:payment|money|transfer) (?:is|has been|was) (?:coming|on its way|sent|released|approved|made)\b|\b(?:is|has been|was|are|were) (?:approved|signed off|accepted|released)\b/i;

export function promisesAWorker(text: string): boolean {
  const t = String(text ?? "");
  return NAMES_A_TIME.test(t.replace(THE_PUBLISHED_PERIOD, "")) || SAYS_IT_IS_SETTLED.test(t);
}

/** What may be sent of what the model wrote, or null with the reason.
 *
 *  Nothing is repaired. The intake assistant cuts a bad sentence and sends the
 *  rest, because a client mid-conversation must get a reply. Here there is
 *  always a better fallback than a trimmed answer: a person. */
export function screenOffScript(raw: unknown): Screened {
  const said = answerText(raw).replace(/[‐-―]/g, ",").replace(/^["'\s]+|["'\s]+$/g, "").trim();
  if (!said) return { text: null, why: "empty" };
  if (said.toUpperCase().includes(NOT_COVERED)) return { text: null, why: "not_covered" };
  if (said.length > 600) return { text: null, why: "too_long" };
  if (guardrails.scan(said).length) return { text: null, why: "banned_language" };
  // The published seven days is lifted out before the general promise guard
  // reads it, or that guard refuses the one period Yaadly does commit to.
  if (unkeepableSentences(said.replace(THE_PUBLISHED_PERIOD, "")).length || promisesAWorker(said)) return { text: null, why: "promise" };
  if (unpublishedFigures(said).length) return { text: null, why: "unpublished_figure" };
  return { text: said, why: "ok" };
}
