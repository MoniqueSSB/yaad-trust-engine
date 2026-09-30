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

export const DISPUTE_DAYS = 2;

/** To the client, once their words have gone to the worker. */
export function problemSent(jobId: string, body: string): string {
  return [
    `Sent to your tradesperson:`,
    `"${body.slice(0, 300)}"`,
    ``,
    `They reply here within ${DISPUTE_DAYS} days.`,
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
    `Not sorted in ${DISPUTE_DAYS} days? Yaadly steps in.`,
    ``,
    `Nothing is approved until it is sorted.`,
    `Stages already signed off stay signed off.`,
  ].join("\n");
}

/** To the worker, once their reply has gone. */
export function replySent(reply: string): string {
  return `Sent to the client:\n"${reply.slice(0, 300)}"\n\nThey say here if it is sorted.`;
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
