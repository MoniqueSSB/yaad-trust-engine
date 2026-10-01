/* ── worker-question.ts ───────────────────────────────────────────────────
 *
 * A worker asking a question, at a moment the assistant was waiting for
 * something else.
 *
 * WHY. Four of the worker prompts are greedy by design: "reply 1 to send this
 * report or send your own words", "what does this show?", "which section is
 * this?", and the plain update lane that files whatever a worker on one live
 * job says. Each one has a right answer and treats every other reply as a
 * version of that answer. On 15 September 2026 the founder, testing as the
 * worker, answered the report prompt with "how do i share my location" and
 * the assistant sent that sentence to the client as her status report. A
 * worker will always have questions mid-job, about the app and about the job,
 * and a question is never a report and never evidence.
 *
 * WHAT THIS DOES. Recognises a question, answers the handful the app can
 * answer itself (how to share a location, how to send a video), and leaves
 * everything else for a person. The prompt that was waiting stays waiting:
 * the session is kept, nothing is sent, nothing is filed, and the reply says
 * so and repeats what is still wanted.
 *
 * WHAT IT DOES NOT DO. Nothing in THIS file routes a question to a model.
 * The canned answers are fixed strings; a question about the job, the money
 * or the client goes to the desk as a high-priority note and is answered by
 * a named human. Since 29 September 2026 a simple question with no fixed
 * answer, and nothing to do with money or a client, may be answered from the
 * approved facts by off-script.ts, which is tried only after this file has
 * returned null. It also never hands the thread over: holding a
 * number silences every worker lane on it (see the human_handling branch in
 * index.ts), which is the wrong price for asking how to send a video.
 *
 * THE NEGATIVE HALF MATTERS MOST. "was able to complete stage one but have
 * some issues" is a report. "done" is a report. "A" is a section answer.
 * "1" is an acceptance. None of these may read as a question, or a worker's
 * real update quietly stops reaching the client.
 */

/** Does this read as a question rather than an answer or an update?
 *
 *  A trailing question mark, or an opening question word, in English or the
 *  Patois forms a worker on WhatsApp actually types ("weh", "wha", "how mi",
 *  "can mi"). Anchored at the start so "done, how does it look" is not
 *  caught while "how does it look, done" is; the first word is what a person
 *  leads with when they are asking. Single letters and digits never match,
 *  because those are the answers the section and report prompts ask for.
 *
 *  An auxiliary verb (can, do, is, was, will...) only counts when a subject
 *  follows it. "Can I send it tomorrow" asks; "was able to complete stage
 *  one" reports, and it was the first real update this file was tested
 *  against. */
const QUESTION_WORD =
  /^(?:how|what|wha|whe|weh|where|when|why|which|who|whose|any idea|anybody know|anyone know|ah wha|a wha|mi (?:can|fi)|me (?:can|fi))\b/i;
const PRONOUN = "i|mi|me|we|you|yuh|unu|it|this|that|there|he|she|they|him|her|anyone|anybody|someone|somebody";
const AUXILIARY_THEN_SUBJECT = new RegExp(
  "^(?:can|could|do|does|is|are|am|should|would|will|shall|may|might)\\s+(?:" + PRONOUN + "|the|di|dis|dat|dem|my|mi own|our|your)\\b" +
  // Past and perfect forms take only a pronoun. "Is the client happy" asks;
  // "did the first coat today" and "have the receipt" report.
  "|^(?:did|was|were|have|has)\\s+(?:" + PRONOUN + ")\\b",
  "i",
);

export function looksLikeQuestion(text: string): boolean {
  const t = String(text ?? "").trim();
  if (!t) return false;
  if (/^[a-z0-9]$/i.test(t)) return false;
  if (/\?\s*$/.test(t)) return true;
  // "How mi share location" and "how do i share location" both start with
  // a question word; "how it went: fine" does not read as one, but a worker
  // who typed it wanted it as an update and a colon marks it as one.
  if (/:/.test(t)) return false;
  return QUESTION_WORD.test(t) || AUXILIARY_THEN_SUBJECT.test(t);
}

/** A bare acknowledgement: not a question, not an update, not an answer.
 *
 *  "no", "ok", "thanks". On 15 September 2026 "no" was filed as evidence on
 *  a live job. Nothing to file, nothing to send, nobody to wake; the reply
 *  repeats what is still wanted. "done" and "finished" are NOT here: they are
 *  real updates and must keep filing. */
const ACKNOWLEDGEMENT =
  /^(?:no|nah|nope|yes|yeah|yep|ya|yah|ok|okay|k|kk|alright|aright|right|sure|fine|cool|thanks|thank you|thx|ty|cheers|bless|respect|hi|hello|hey|morning|good morning|good afternoon|good evening|evening|noted|got it|seen|received|ok thanks|okay thanks|yes please|no thanks)[.!]*$/i;

/** A word with its doubled letters pressed together, so a thumb landing twice
 *  on a key still reads as the word that was meant. On 29 September 2026 the
 *  founder, testing as the worker, answered "reply no to drop it" with "nno"
 *  and had "nno" read back to her as the next update for the job record.
 *
 *  Doubled letters only, on purpose. Anything looser (a missing letter, two
 *  swapped) starts catching real words: "on" is one swap from "no" and opens
 *  plenty of real updates. The pattern is tested against the pressed form as
 *  well as the typed one, and the list is the same list either way. */
export function pressDoubledLetters(text: string): string {
  return String(text ?? "").trim().replace(/([a-z])\1+/gi, "$1");
}

/** The pattern with the same pressing applied to its own words, so "cool"
 *  still matches once it has become "col". */
export function alsoPressed(pattern: RegExp): RegExp {
  return new RegExp(pattern.source.replace(/([a-z])\1+/gi, "$1"), pattern.flags);
}

const ACKNOWLEDGEMENT_PRESSED = alsoPressed(ACKNOWLEDGEMENT);

export function isBareAcknowledgement(text: string): boolean {
  const t = String(text ?? "").trim();
  return ACKNOWLEDGEMENT.test(t) || ACKNOWLEDGEMENT_PRESSED.test(pressDoubledLetters(t));
}

const THANKS = /^(?:thanks|thank you|thx|ty|cheers|bless|respect|ok thanks|okay thanks)[.!]*$/i;
const GREETING = /^(?:hi|hello|hey|morning|good morning|good afternoon|good evening|evening)[.!]*$/i;
const THANKS_PRESSED = alsoPressed(THANKS);
const GREETING_PRESSED = alsoPressed(GREETING);

/** What a bare acknowledgement is answered with, on its own with nothing
 *  waiting.
 *
 *  Every word on the list used to get one reply, written for a stray "no":
 *  "Noted, nothing filed. When you have a moment, send a few words on how the
 *  work went". On 29 September 2026 the founder, testing as the worker, filed
 *  an update, said thanks, and was told nothing had been filed and asked for
 *  another. The update was on the job. The reply was answering a different
 *  word.
 *
 *  Three kinds, three replies. `justFiled` is whether this worker put
 *  something on a job in the last few minutes, and it changes only the thank
 *  you: saying "your update is on the job" to somebody who filed nothing
 *  would be the same mistake the other way round. Nothing here files, sends
 *  or wakes anybody, exactly as before. */
export function acknowledgementReply(text: string, justFiled: boolean): string {
  const t = String(text ?? "").trim();
  const pressed = pressDoubledLetters(t);
  if (THANKS.test(t) || THANKS_PRESSED.test(pressed)) {
    return justFiled
      ? "You're welcome. Your update is on the job and nothing more is needed from you right now."
      : "You're welcome.";
  }
  if (GREETING.test(t) || GREETING_PRESSED.test(pressed)) {
    return "Hello. Send a photo, a few words or a voice note about the work and it goes on the job.";
  }
  return "Nothing is waiting on a reply from you right now. Send a photo, a few words or a voice note when you have an update.";
}

/** A worker saying they want paying, or asking for the client to be told so.
 *
 *  "let the client know i am ready for payment", 29 September 2026. It is not
 *  a question by shape and it is not a site update, and it was read back as
 *  one, ready to go on the job record and from there into the client's
 *  report. It gets the published pay answer and what has to happen first.
 *
 *  A REQUEST, never a mention. "paid for the cement, receipt coming" and
 *  "client paid the deposit so i started" are reports and must keep filing,
 *  so every pattern here needs the asking in it: ready for, waiting on, pay
 *  me, send or release my money. Capped at fourteen words so a long update
 *  that ends on the subject of money still files. */
const PAY_REQUEST = new RegExp(
  "\\b(?:" + [
    "ready (?:for|fi|to (?:be|get)) (?:my |mi |the |di )?(?:pay(?:ment|ing)?|paid|money)",
    "(?:waiting|wait) (?:for|on|pon|fi) (?:my |mi |the |di )?(?:pay(?:ment)?|money)",
    "(?:want|need|looking for|collect) (?:my |mi |the |di )?(?:pay(?:ment)?|money)\\b(?! (?:for|fi) (?:the |di )?(?:material|cement|lumber|paint|tile|block|steel|sand))",
    "pay (?:me|mi)\\b",
    "(?:send|release|transfer) (?:me |mi )?(?:my |mi |the |di )?(?:pay(?:ment)?|money|funds)\\b(?! (?:for|fi) (?:the |di )?(?:material|cement|lumber|paint|tile|block|steel|sand))",
    "request(?:ing)? (?:my |mi |the |di )?pay(?:ment)?",
    "(?:tell|let|ask) (?:the |di )?(?:client|customer|owner)\\b.{0,30}\\b(?:pay|payment|paid|money)",
  ].join("|") + ")\\b",
  "i",
);

export function asksForPayment(text: string): boolean {
  const t = String(text ?? "").trim();
  if (!t || t.split(/\s+/).length > 14) return false;
  return PAY_REQUEST.test(t);
}

/** What a worker asking for payment is told. Fixed, like every other answer
 *  here. The last two sentences are the published pay sentence from faq.ts,
 *  word for word; the first three are the order things happen in, which is
 *  the hold point the whole product is built on. No amount, no date, and no
 *  promise that this payment is coming. */
export const PAY_REQUEST_ANSWER =
  "That has not gone on the job record and nothing has gone to the client. " +
  "Payment is not something the client is asked for by message. It follows the work being accepted: " +
  "your update goes to the client once you have confirmed it, the client approves the stage, and a named person at Yaadly checks the evidence and signs it off. " +
  "Paid by Yaadly, not by the client, within 7 days of a named person at Yaadly signing the stage off, by bank transfer. Yaadly does not pay in cash. " +
  "If you have a question about a specific payment, say so and a person will answer it.";

/** A short instruction to the app that names a thing it can explain.
 *
 *  "share location", "send video", "location". Not a question by shape, but
 *  the second and third messages the founder sent when the first one was
 *  mishandled, and a worker typing "location" on its own wants to know how,
 *  not to put the word on the job. Capped at four words so a real update that
 *  happens to mention a receipt ("receipt for the cement is coming") keeps
 *  filing. */
export function wantsHelpWith(text: string): boolean {
  const t = String(text ?? "").trim();
  if (asksForPayment(t)) return true;
  if (!t || t.split(/\s+/).length > 4) return false;
  return answerWorkerQuestion(t) !== null;
}

/** The answers the app can give itself.
 *
 *  Fixed strings, deliberately: a worker asking how to send a clip must get
 *  the same instructions every time. The facts about pay, receipts and the
 *  client's view are the published ones in faq.ts and on yaadly.co.uk/faq,
 *  repeated, never extended: no date, no amount, no "it will be fine". Keep
 *  the pay sentence identical to faq.ts when either changes. Null means "not
 *  one the app answers", and the caller puts it in front of a person. */
export function answerWorkerQuestion(text: string): string | null {
  const t = String(text ?? "").toLowerCase();
  // First, because "ready for payment, photos sent" names two things and the
  // one a worker is waiting on is the money.
  if (asksForPayment(t)) return PAY_REQUEST_ANSWER;
  if (/\b(?:location|locashun|where i am|where mi deh|pin|gps|my position|check ?in|arriv|on site|reach)\b/.test(t)) {
    return "To share your location on WhatsApp: tap the plus sign (or the paperclip) next to the message box, choose Location, then Send your current location. It checks you in on the job for today. With your first photos or update of the day you are asked for it: reply skip and they still file, but check in before you leave site.";
  }
  if (/\b(?:video|vid|clip|record|recording|walk ?through|walkthrough|film)\b/.test(t)) {
    return "To send a video: tap the camera or the plus sign next to the message box and record a short clip, or pick one from your gallery. Under about a minute sends fine on WhatsApp. For anything longer, upload it on the job at app.yaadly.co.uk.";
  }
  if (/\b(?:photo|photos|pic|pics|picture|pictures|foto|image|images|snap)\b/.test(t)) {
    return "To send photos: tap the camera or the plus sign next to the message box and pick them from your gallery, several at once is fine. Add a line saying what they show, then answer which section they belong to: before, during, after, a problem, or something new you found.";
  }
  if (/\b(?:receipt|receipts|bill|invoice for material|materials?|cement|lumber|hardware)\b/.test(t)) {
    return "Send a photo of the receipt here, the same way as any photo, and say it is the receipt. It is filed against the job. Materials pass through at cost, so the receipt is what the client sees.";
  }
  if (/\b(?:before|during|after|section|letter|letters|which one|b or a|what is b|what does (?:b|d|a|p|n|s) mean)\b/.test(t) && /\b(?:mean|means|section|letter|letters|which|what)\b/.test(t)) {
    return "The sections: Before is the state before you started. During is mid-work. After is the finished work. A problem is something wrong with work already in the job. Something new is a thing you found that was never in the job. Skip files it without a section.";
  }
  // Only the mechanics of what the client sees. "The owner said to change
  // the colour, is that ok" names the client and is a person's question.
  if (/\b(?:see this|sees this|see it|see the (?:photo|photos|report|update)|what happens|happens now|happens next|next step|(?:does|will|can) the (?:client|customer|owner) (?:see|get|know|hear))\b/.test(t)) {
    return "What happens next: your update is written up as a short report, you are shown it and reply 1 to send it, or send your own words instead. Then the client sees it. Nothing goes to them until you have confirmed it.";
  }
  if (/\b(?:paid|pay|payment|money|cash|wage|when .* get paid|transfer)\b/.test(t)) {
    return "Paid by Yaadly, not by the client, within 7 days of a named person at Yaadly signing the stage off, by bank transfer. Yaadly does not pay in cash. If you have a question about a specific payment, say so and a person will answer it.";
  }
  return null;
}

// ── the client's fixed answers, on the worker's side ──────────────────────
//
// Founder, 1 Oct 2026: "these fixed answers should be on the worker sides
// also." The client can ask where the job stands, how approval works, where
// to see things, how to complain and how to stop the messages, and gets a
// fixed answer each time (client-lane.ts). These are the worker's half,
// answering from the worker's side of the same facts. Fixed strings, no
// amount, no date. Pay is still answered by PAY_REQUEST_ANSWER and the pay
// sentence above, unchanged.

export type WorkerJob = { id: string; title: string; status: string; stagePaid: boolean };

const WORKER_PORTAL = "https://app.yaadly.co.uk/portal/jobs/";

/** Where the job stands, from the worker's side, and what is wanted from
 *  them. The same statuses whereItStands() reads for the client. */
export function workerWhereItStands(job: WorkerJob): string {
  const name = `${job.title || "Your job"} (${job.id})`;
  switch (job.status) {
    case "awaiting_payment":
      return `${name} is booked. Do not start yet: the client pays Yaadly first, and you get a message here when they have.`;
    case "in_progress":
      return job.stagePaid
        ? `${name} is live. Send photos and videos as you go, and say what each one shows. Nothing else is waiting on you.`
        : `${name} is live, but this stage starts once the client has paid for it. Do not start it yet: you get a message here when they have.`;
    case "evidence":
      return `${name} has work waiting for the client's approval. If a draft report is waiting on you, reply 1 to send it. Otherwise nothing is needed from you, and you hear here when the client decides.`;
    case "disputed":
      return `${name} has a problem open from the client. Reply here with what you will do and when, within 48 hours of it being raised, or Yaadly steps in. If you have replied, nothing more is needed until the client answers. Nothing is approved until it is sorted.`;
    case "complete":
      return `${name} is signed off. Yaadly pays you for the last stage by bank transfer within 7 days. Never cash.`;
    default:
      return `${name} is on record with Yaadly. Nothing is needed from you right now.`;
  }
}

/** The worker's fixed answers that need the job. Null means none fits, and
 *  the caller goes on to answerWorkerQuestion(), the facts, then a person. */
export function answerWorkerJobQuestion(text: string, job: WorkerJob | null): string | null {
  const t = String(text ?? "").toLowerCase();
  if (asksForPayment(t)) return null;
  const link = job ? `${WORKER_PORTAL}${job.id}` : "https://app.yaadly.co.uk/portal";
  if (/\b(?:where (?:are we|is it|is the job|is my job|we deh)|status|any (?:news|update)|what(?:'s| is) next|what happens (?:now|next)|next step|what (?:do|should) (?:i|mi) (?:do|need to do)|(?:can|should|shall) (?:i|mi) start|mi fi start|start (?:now|yet))\b/.test(t)) {
    return job ? workerWhereItStands(job) : null;
  }
  if (/\b(?:how (?:do|does|will|is) .{0,20}(?:approv|sign(?:ed)? off)|who approves|when .{0,20}approv|approval|sign ?off)\b/.test(t)) {
    return "The client approves each stage from your report and photographs, on WhatsApp or in their portal. Nothing you send reaches them until you confirm the draft. Once a stage is approved, a named person at Yaadly signs it off and you are paid by bank transfer within 7 days. Never cash.";
  }
  if (/\b(?:see|view|find|open|where (?:is|are)) (?:the |my |di )?(?:job|report|reports|photos?|pictures?|evidence|kickoff pack|pack|agreement|scope)\b/.test(t)) {
    return `Everything on the job is in your portal: the scope, the Kickoff Pack, your photographs and reports: ${link}`;
  }
  if (/\b(?:something (?:is )?wrong|problem on site|raise (?:a |an )?(?:problem|issue|complaint)|make a complaint|not (?:what|as) (?:was )?(?:described|said|agreed)|site (?:is )?different|(?:client|customer|owner) (?:is )?(?:complaining|unhappy|vex))\b/.test(t)) {
    return "If the client has raised a problem with you, reply here with what you will do and when, within 48 hours, or Yaadly steps in. For anything else that is wrong, including a site that is not what the job described, say \"talk to a person\" and then say what it is. A person at Yaadly picks it up.";
  }
  if (/\b(?:stop|change|update|new) (?:these |the |my |mi )?(?:whatsapp|messages|number|phone)\b/.test(t)) {
    return "WhatsApp is how Yaadly reaches you about your jobs. To change the number, say \"talk to a person\" and someone at Yaadly updates it with you.";
  }
  return null;
}
