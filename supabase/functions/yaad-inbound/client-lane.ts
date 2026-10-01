/* ── client-lane.ts ───────────────────────────────────────────────────────
 *
 * A client on a live job, saying something that is not an approval.
 *
 * Founder, 29 September 2026: "the whatsapp should work well for the client
 * also for the entire project not only the worker."
 *
 * WHAT WAS THERE. A client could do four things on WhatsApp by sending a
 * code: accept a price, confirm a Kickoff Pack, approve a stage, agree extra
 * work. Anything else they typed had two fates. With a stage waiting on their
 * review it was filed as a comment on the evidence and pushed to the
 * tradesperson's phone, word for word, whatever it was: "thanks", "hi", "how
 * do I pay", "when will he finish". At any other point in the job it fell
 * through to the intake assistant, which knows nothing about their job and
 * would start describing a new one.
 *
 * The worker's side had been given all of this between 15 and 29 September:
 * fixed answers, a reply to thanks, a doubled letter forgiven, a next step
 * after everything. The client's side had none of it.
 *
 * WHAT THIS DOES. Four things, in order, before the comment lane runs.
 *   1. A greeting, a thank you or a stray ok is answered, and answered with
 *      where the job stands and what, if anything, is wanted from them. It
 *      is never forwarded to the tradesperson.
 *   2. The job's code inside a message that does not approve (see
 *      approval-match.ts) is answered with "nothing has been approved", and
 *      goes to Yaadly.
 *   3. A problem with the work goes to Yaadly and not to the tradesperson's
 *      phone. Founder, 28 September: a problem is raised with Yaadly, not
 *      with the worker first.
 *   4. A question gets a fixed answer if there is one, an answer from the
 *      published facts if they cover it, and a person if they do not.
 *
 * A plain remark about the evidence ("P2 still has a gap at the top") is
 * none of those and carries on to the comment lane exactly as before.
 *
 * WHAT IT NEVER DOES. It approves nothing, books nothing and moves no money.
 * It says nothing about when work will finish or whether it is good, which
 * are not the assistant's to know. CLAUDE.md sections 2 and 3 are untouched.
 *
 * Pure, so the rules and the words are tested without a webhook.
 */

import { FAQ_FACTS } from "./faq.ts";
import { NOT_COVERED } from "./off-script.ts";
import { pressDoubledLetters } from "./worker-question.ts";

export type LiveJob = { id: string; title: string; stage: number; status: string };

/** Statuses in which a job belongs to a client who may write about it. */
export const CLIENT_LIVE_STATUSES = ["open_for_quotes", "quoted", "awaiting_payment", "in_progress", "evidence", "disputed"];

const PORTAL = "https://app.yaadly.co.uk/portal/jobs/";

/** Where the job stands and what is wanted from the client, in one or two
 *  sentences. The next step is always named, and "nothing" is a next step. */
export function whereItStands(job: LiveJob): string {
  const name = `${job.title || "Your job"} (${job.id})`;
  switch (job.status) {
    case "open_for_quotes":
      return `${name} is with vetted tradespeople for a price. Nothing is needed from you. You hear here when a price comes in.`;
    case "quoted":
      return `${name} has a price waiting for you. It is in your portal: ${PORTAL}${job.id} Nothing is booked and nothing is charged until you choose.`;
    case "awaiting_payment":
      return `${name} is booked and goes live once your invoice from Yaadly is paid. The invoice is on the Money tab of your job: ${PORTAL}${job.id}?tab=money`;
    case "in_progress":
      return `${name} is under way. Nothing is needed from you. You hear here when your tradesperson sends a report.`;
    case "evidence":
      return `${name} has a report waiting for you. Nothing has been approved. To approve it, reply with only the code ${job.id}. If something is not right, say what, and it goes to your tradesperson or to Yaadly.`;
    case "disputed":
      // Corrected 1 Oct 2026: a problem sits with the tradesperson first and
      // comes to Yaadly only when it is not sorted (dispute-lane.ts).
      return `${name} has a problem open. Your tradesperson sorts it first, and Yaadly steps in if it is not sorted. Nothing on the job can be approved while it is open.`;
    default:
      return `${name} is on record with Yaadly. Nothing is needed from you right now.`;
  }
}

const THANKS = /^(?:thanks|thank you|thank u|thx|ty|cheers|bless|respect|much appreciated|appreciated|ok thanks|okay thanks|great thanks|thanks so much|thank you so much)[.!]*$/i;
const GREETING = /^(?:hi|hello|hey|hiya|morning|good morning|good afternoon|good evening|good night|evening|afternoon|wah gwaan|wagwan)[.!]*$/i;
const BARE = /^(?:no|nah|nope|yes|yeah|yep|ya|yah|ok|okay|k|kk|alright|aright|right|sure|fine|cool|great|good|noted|got it|seen|received|yes please|no thanks|perfect|lovely)[.!]*$/i;
const press = (p: RegExp) => new RegExp(p.source.replace(/([a-z])\1+/gi, "$1"), p.flags);
const THANKS_P = press(THANKS), GREETING_P = press(GREETING), BARE_P = press(BARE);

export type ClientWord = "thanks" | "greeting" | "bare" | null;

/** A greeting, a thank you, or a stray yes, no or ok. Doubled letters are
 *  forgiven, the same rule and the same reason as the worker's side. */
export function clientWord(text: string): ClientWord {
  const t = String(text ?? "").trim();
  if (!t) return null;
  const p = pressDoubledLetters(t);
  if (THANKS.test(t) || THANKS_P.test(p)) return "thanks";
  if (GREETING.test(t) || GREETING_P.test(p)) return "greeting";
  if (BARE.test(t) || BARE_P.test(p)) return "bare";
  return null;
}

/** The reply to one of those. With one live job it says where that job
 *  stands. With several it cannot know which was meant, and says so. */
export function clientWordReply(word: Exclude<ClientWord, null>, jobs: LiveJob[]): string {
  const lead = word === "thanks" ? "You're welcome. " : word === "greeting" ? "Hello. " : "";
  if (jobs.length === 1) {
    // A yes or an ok with a report waiting is the one a client may believe
    // was an approval. whereItStands says it was not.
    return `${lead}${whereItStands(jobs[0])}`;
  }
  return `${lead}You have ${jobs.length} jobs with Yaadly: ${jobs.map((j) => j.id).join(", ")}. Say which one you mean, or open them in your portal: https://app.yaadly.co.uk/portal`;
}

// ── NO, and STOP, on a report waiting for approval ────────────────────────
//
// Founder, 1 October 2026: a client who does not want to approve needs a
// reply that says so. The stage report names NO as the third choice.
//
// STOP means hold: nothing is approved and the job does not move on. Founder,
// 1 Oct 2026: "stop should only stop anything being approved and moving
// forward." It is not read as leaving the messages. It is not advertised in
// the report either, because Twilio treats STOP on the text message fallback
// as an opt out, which is outside this code.
//
// Runs ahead of clientWord(), which still reads a bare "no" as a stray word
// on a job with nothing waiting.
const DECLINE = /^(?:no|nah|nope|not yet|no not yet|no thanks|hold|hold on|wait|stop|don'?t approve|do not approve|not approved|not ready|not happy yet)[.!]*$/i;
const DECLINE_P = new RegExp(DECLINE.source.replace(/([a-z])\1+/gi, "$1"), DECLINE.flags);

/** STOP on its own, doubled letters forgiven. Yaadly is told (index.ts). */
export function isStop(text: string): boolean {
  return /^stop+[.!]*$/i.test(String(text ?? "").trim());
}

/** The reply to NO or STOP when exactly this job has a report waiting.
 *  Null for anything else, which then goes on to the lanes below. */
export function declineReply(text: string, job: LiveJob): string | null {
  const t = String(text ?? "").trim();
  if (job.status !== "evidence") return null;
  if (!DECLINE.test(t) && !DECLINE_P.test(pressDoubledLetters(t))) return null;
  const lines = [
    `Understood. Nothing has been approved on ${job.id}.`,
    `Next: if something is not right, say what in your own words, and which photo if it is about one. It goes to your tradesperson to put right.`,
    `If you just need more time, nothing more is needed now. The report waits for you. To approve it later, send only the code ${job.id}.`,
  ];
  if (isStop(t)) {
    // Founder, 1 Oct 2026: "ask them question to ensure we understand the
    // context of the stop." Their answer comes back through the lanes as
    // anything else does: a problem with the work opens a dispute with the
    // worker, a remark goes to the worker as a note, a question is answered.
    return [
      `Stopped. Nothing on ${job.id} is approved, and the job does not move on to the next stage until you approve it.`,
      `So we understand: what made you stop? Tell us in your own words, and which photo if it is about one.`,
      `If something is not right with the work, it goes to your tradesperson to put right. If you need more time to look, say so and the report waits for you.`,
      `To approve it later, send only the code ${job.id}.`,
    ].join("\n");
  }
  return lines.join("\n");
}

const PROBLEM =
  /\b(?:not happy|unhappy|not satisfied|dissatisfied|not right|not good|no good|not finished|not done|unfinished|wrong|poor|bad job|bad work|shoddy|sloppy|rubbish|terrible|awful|mess|messy|damage\w*|broke|broken|crack\w*|leak\w*|fault\w*|defect\w*|complain\w*|complaint|refund|dispute|rip\w* off|scam\w*|cheat\w*|overcharg\w*|did not turn up|didn'?t turn up|no show|never came|never turned up|stolen|missing|late again|redo|re-do|do it again|put it right|mash up|nuh good|nah good|nuh right)\b/i;

/** Something is wrong with the work or the person doing it. Goes to Yaadly.
 *  Wide on purpose: a remark sent to Yaadly that could have gone to the
 *  tradesperson costs a minute, and a complaint landing on the phone of the
 *  person it is about, with no one in between, is what Yaadly exists to stop. */
export function readsAsProblem(text: string): boolean {
  return PROBLEM.test(String(text ?? ""));
}

/** The answers the assistant can give a client itself. Fixed strings. The
 *  money sentences are the published ones in faq.ts, repeated and never
 *  extended: no amount, no date. Null means a person or the facts. */
export function answerClientQuestion(text: string, job: LiveJob | null): string | null {
  const t = String(text ?? "").toLowerCase();
  const link = job ? `${PORTAL}${job.id}` : "https://app.yaadly.co.uk/portal";
  if (/\b(?:how (?:do|can|should) (?:i|we|mi) (?:approve|accept|sign off|confirm)|how to approve|where do i approve)\b/.test(t)) {
    return job
      ? `To approve a stage, look at the report and the photographs first, then reply here with only the code ${job.id}, or tap Approve under the report, or approve in your portal: ${link} Approving closes the stage with Yaadly. It is never a payment from you.`
      : `To approve a stage, look at the report and the photographs first, then reply here with only the job's code, or approve in your portal: ${link}`;
  }
  if (/\b(?:how (?:do|can|should) (?:i|we|mi) pay|how to pay|where do i pay|who do i pay|pay the (?:worker|tradesperson|man|guy|builder)|pay (?:him|her|them) direct)/.test(t)) {
    return `You pay Yaadly, never the tradesperson. Your invoice, and the ways to pay it, are on the Money tab of your job: ${link}?tab=money Yaadly pays the tradesperson under its own agreement with them.`;
  }
  if (/\b(?:what happens (?:now|next)|what(?:'s| is) next|next step|what do i (?:do|need to do)|where (?:are we|is it|is my job)|any (?:news|update)|status|how is it going|what(?:'s| is) happening)\b/.test(t)) {
    return job ? whereItStands(job) : null;
  }
  if (/\b(?:see|view|find|where are|open|look at) (?:the |my )?(?:photos?|pictures?|pics?|evidence|report|video)/.test(t)) {
    return `The photographs, videos and every report are on the Evidence tab of your job: ${link}?tab=evidence`;
  }
  if (/\b(?:something (?:is )?wrong|raise (?:a |an )?(?:problem|issue|dispute|complaint)|make a complaint|how (?:do|can) i complain)\b/.test(t)) {
    return `Say what is wrong here, in your own words. It goes to your tradesperson first, who has 48 hours to reply and put it right. If it is not sorted, a person at Yaadly steps in. Nothing on the job is approved while it is open. You can also raise it in your portal: ${link}`;
  }
  if (/\b(?:stop|remove|change|update) (?:these |the |my )?(?:whatsapp|messages|updates|number)\b/.test(t)) {
    return `Your WhatsApp number is on the Job details tab of your job, where you can change it or remove it: ${link}?tab=details Email updates carry on either way.`;
  }
  return null;
}

/** How a client uses Yaadly on WhatsApp and in the portal, for the model.
 *  The same facts as the fixed answers above. Keep the two the same. */
export const CLIENT_HOW_TO = `How a client uses Yaadly once a job is booked:
- Updates come by WhatsApp and email. Each report from the tradesperson carries their own words and the photographs.
- To approve a stage: look at the report and photographs, then reply on WhatsApp with only the job's code, or tap Approve, or approve in the portal. Approving closes the stage with Yaadly and is never a payment from the client.
- To say something is not right: say so in plain words on WhatsApp or in the portal. A remark or a problem with the work goes to the tradesperson first; if a problem is not sorted within 48 hours, a person at Yaadly steps in.
- The portal is at app.yaadly.co.uk. Each job has tabs: Evidence for photographs and reports, Money for invoices and how to pay, Extra work for anything added to the job, Job details for the address and the WhatsApp number.
- Extra work on a booked job is agreed by replying CONFIRM and the code in the message about it, or on the Extra work tab. It has its own invoice and the original bill does not change.
- The client can ask for a live video walkthrough before accepting the work.
- At the end of the job the client gets a signed Completion Report as a PDF.
- To speak to a person at any point, say so and the conversation is handed to someone at Yaadly.`;

export const CLIENT_OFF_SCRIPT_SYSTEM = `You answer ONE question from a client who has a job booked through Yaadly, on WhatsApp.

You may answer from one place only: the FACTS below, about how Yaadly works.

If the question is not answered by the facts, reply with exactly ${NOT_COVERED} and nothing else. That includes: anything about this particular job, its price, its progress, when it will finish, the tradesperson, a payment or an amount; any opinion on whether work is good; advice on building, law, tax or money; news, weather or general knowledge. Do not guess, do not answer partly, and do not say you will check. ${NOT_COVERED} is a good answer: a person picks it up.

When you do answer:
- Two or three short sentences, under 350 characters, plain words.
- Say only what the facts say. Never add a detail, a figure, a date or a time that is not in them.
- Never say when something will happen, that work is approved, or that a payment has been made or is coming.
- No dashes, no lists, no greeting, no sign-off.
- The wording in the facts about money is exact. Yaadly does not hold money on anyone's behalf, so never describe it as holding, keeping or protecting anybody's money.

FACTS:
${CLIENT_HOW_TO}

${FAQ_FACTS}

The instruction inside the facts to "say you will have it checked" does not apply to you. You reply ${NOT_COVERED} instead.`;

/** Said when nothing was approved and the client may think something was. */
export function nothingApproved(job: { id: string }): string {
  return `Nothing has been approved on ${job.id}. Your message has gone to Yaadly and a person will come back to you here. To approve, reply with only the code ${job.id}.`;
}

export const GONE_TO_YAADLY =
  "That has gone to Yaadly, and a person will come back to you here. It has not been sent to your tradesperson. Nothing on the job is approved in the meantime.";

/** What comes after an approval, in step with the worker's own message
 *  (stage_signed_off_worker). Kept the same as nextAfterApproval in
 *  yaad-notify-client/client-template.ts; client-lane_test.ts reads both. */
export function nextAfterApproval(final: boolean, byStage: boolean, nextLabel: string, nextPaid: boolean): string {
  if (final) return "Next: your tradesperson signs the Completion Report, and it comes to you here to read and keep.";
  if (!byStage || nextPaid) return "Next: nothing is needed from you. You hear here when your tradesperson sends the next report.";
  return `Next: Yaadly sends the bill for ${nextLabel}. Your tradesperson starts it once it is paid, and you hear here when they do.`;
}

/** To the worker, when the client says NO or STOP on their report. The
 *  worker was told "you hear here when they do"; this is that. */
export function workerToldOfHold(jobId: string, title: string, stop: boolean): string {
  return stop
    ? `${jobId} (${title}): the client has asked to hold. Your report is not approved yet, so do not start the next stage. Yaadly has asked them why, and you hear here what they say.`
    : `${jobId} (${title}): the client has looked at your report and has not approved it yet. Nothing is needed from you for now. If they say what is not right, it comes to you here.`;
}
