// A problem with the work goes to the worker first. 30 Sep 2026.
//
// Founder: "when a client raises an issues it goes to the worker to solve,
// only when there is no resolve then it comes to me to intervene". This
// reverses 28 September ("you raise this with Yaadly"), and restores the
// shape the disputes table always had: a dispute opens 'direct', the worker
// replies once, the client closes it ('resolved') or brings Yaadly in
// ('escalated'). New today: it works on WhatsApp on both sides, and a
// dispute with no reply after two days escalates on its own
// (escalate_stale_disputes, 20260930130000).
//
// Nothing here approves, releases or rules. A dispute open in any state
// still stops approval on the job, exactly as before. Pure, so the words
// and the reading are tested without a webhook.

/** The client closing or escalating from WhatsApp: SORTED <code> or
 *  NOT FIXED <code>, whole message. The code keeps it off every other lane. */
export function readDisputeClose(text: string): { jobId: string; state: "resolved" | "escalated" } | null {
  const t = (text ?? "").trim();
  let m = /^(?:sorted|fixed|resolved|that sorts it)\s+([A-Za-z0-9-]+)[.!]*$/i.exec(t);
  if (m) return { jobId: m[1], state: "resolved" };
  m = /^(?:not fixed|not sorted|still not fixed|still not sorted|escalate|yaadly)\s+([A-Za-z0-9-]+)[.!]*$/i.exec(t);
  if (m) return { jobId: m[1], state: "escalated" };
  return null;
}

// Founder, 1 Oct 2026: "the check should say 48 hours and be 48 hours."
// The words say hours, the timer counts hours (20261001120000), and the
// check runs every five minutes so 48 means 48.
export const DISPUTE_HOURS = 48;
/** Kept for the 30 Sep migration's own test, which reads '2 days'. */
export const DISPUTE_DAYS = DISPUTE_HOURS / 24;

/** To the client, once their words have gone to the worker. */
export function problemSent(jobId: string, body: string): string {
  return [
    `Sent to your tradesperson:`,
    `"${body.slice(0, 300)}"`,
    ``,
    `They reply here within ${DISPUTE_HOURS} hours.`,
    `Sorted? Reply SORTED ${jobId}.`,
    `Not fixed? Reply NOT FIXED ${jobId} and Yaadly steps in.`,
    `Nothing on the job is approved until it is sorted.`,
  ].join("\n");
}

/** To the worker, at once. */
export function problemForWorker(jobId: string, title: string, body: string, portalLink: string): string {
  return [
    `On ${title} (${jobId}), the client says:`,
    `"${body.slice(0, 1000)}"`,
    ``,
    `This is yours to sort first.`,
    `Reply here with what you will do and when. It goes to the client.`,
    `Or reply on the job: ${portalLink}`,
    `Reply within ${DISPUTE_HOURS} hours, or Yaadly steps in.`,
    ``,
    `Nothing is approved until it is sorted.`,
    `Nothing is taken off you in the meantime.`,
  ].join("\n");
}

/** To the worker, once their reply has gone. */
export function replySent(reply: string): string {
  return `Sent to the client:\n"${reply.slice(0, 300)}"\n\nThey say here if it is sorted. If they do not, Yaadly follows it up with them.`;
}

/** To the client, carrying the worker's reply. */
export function replyForClient(jobId: string, title: string, reply: string, portalLink: string): string {
  return [
    `Your tradesperson replied on ${title} (${jobId}):`,
    `"${reply.slice(0, 1000)}"`,
    ``,
    `Sorted? Reply SORTED ${jobId}.`,
    `Not fixed? Reply NOT FIXED ${jobId} and Yaadly steps in.`,
    `Or answer on the job: ${portalLink}`,
  ].join("\n");
}

export function closedReply(state: "resolved" | "escalated"): string {
  return state === "resolved"
    ? "Sorted. Thank you. The job can be approved again."
    : "Yaadly is stepping in. A person looks at what was raised and the reply, against the agreed scope and the evidence.\nNothing on the job is approved until it is sorted.";
}

// ── when nobody moves, 1 Oct 2026 ─────────────────────────────────────────
//
// Founder: "fix this", on four gaps found reviewing the client lane:
//   1. a dispute the worker left unanswered moved to Yaadly and neither side
//      was told, after the client had been promised a reply in two days;
//   2. the desk alert said the client had escalated when the timer had;
//   3. the check ran once a day, so two days meant two to three;
//   4. a dispute the worker had answered and the client never closed stayed
//      open for good, blocking approval, with nobody following it up.
// The timer and the chase live in escalate_stale_disputes()
// (20261001120000). These are the words. None of them approves, rules or
// moves money, and none says when a person will answer.

export type SteppedInWhy = "no_reply" | "client_silent";

/** To the client, when Yaadly steps in on its own. */
export function steppedInForClient(jobId: string, title: string, why: SteppedInWhy, portalLink: string): string {
  return [
    why === "no_reply"
      ? `Your tradesperson has not replied on ${title} (${jobId}) in ${DISPUTE_HOURS} hours, so Yaadly has stepped in.`
      : `You have not said whether the problem on ${title} (${jobId}) is sorted, so Yaadly has picked it up with you.`,
    `A person looks at what you raised${why === "client_silent" ? " and your tradesperson's reply" : ""}, against the agreed scope and the evidence, and comes back to you here.`,
    `Nothing on the job is approved until it is sorted.`,
    ``,
    `Next: nothing is needed from you. To add anything, reply here or write on the job: ${portalLink}`,
  ].join("\n");
}

/** To the worker, at the same moment. */
export function steppedInForWorker(jobId: string, title: string, why: SteppedInWhy, portalLink: string): string {
  return [
    why === "no_reply"
      ? `On ${title} (${jobId}), the client's problem had no reply from you in ${DISPUTE_HOURS} hours, so Yaadly has stepped in.`
      : `On ${title} (${jobId}), the client has not said whether your reply sorted it, so Yaadly has picked it up.`,
    `A person looks at it with you, against the agreed scope and the evidence.`,
    `Give your side here: ${portalLink}`,
    ``,
    `Nothing is approved until it is sorted.`,
    `Nothing is taken off you in the meantime.`,
  ].join("\n");
}

/** To the client, once, when the worker has replied and the client has said
 *  nothing for DISPUTE_HOURS. */
export function chaseClient(jobId: string, title: string, portalLink: string): string {
  return [
    `Your tradesperson replied on ${title} (${jobId}) ${DISPUTE_HOURS} hours ago. Is it sorted?`,
    ``,
    `Sorted? Reply SORTED ${jobId}.`,
    `Not fixed? Reply NOT FIXED ${jobId} and Yaadly steps in.`,
    `Their reply is on the job: ${portalLink}`,
    ``,
    `If we do not hear from you in ${DISPUTE_HOURS} more hours, a person at Yaadly picks it up with you.`,
    `Nothing on the job is approved until it is sorted.`,
  ].join("\n");
}
