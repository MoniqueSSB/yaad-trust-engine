/* ── client-template.ts ───────────────────────────────────────────────────
 *
 * The client's stage report, when WhatsApp will not take free text.
 *
 * Founder, 29 September 2026: "the client should be informed on whatsapp of
 * the job update." On that day no job in the database carried a client phone
 * number and no stage report had ever reached a client on WhatsApp.
 *
 * WHY A TEMPLATE. WhatsApp lets a business send free text only to somebody
 * who has written to it within 24 hours. The client is the person least
 * likely to have: they booked last week from London and have had no reason
 * to message since. Without an approved template the report is refused, and
 * they hear by email alone.
 *
 * THE FREE TEXT STILL GOES FIRST. Inside the window the client gets the rich
 * message, with the photographs attached and the approve button after it.
 * This is what goes when that is refused for being outside the window, and
 * only then, which is the rule yaad-notify-client's header sets for every
 * template: a plainer message that arrives beats a richer one that does not,
 * and never replaces it when it could have been sent.
 *
 * WHAT IT CARRIES. The job, the tradesperson's own confirmed words, and the
 * link to the job where the photographs are. No approve button: a template
 * cannot show the photographs, and asking somebody to approve work they have
 * not been shown is the thing the button's own comment forbids.
 *
 * The body is held word for word against yaad-twilio-setup/content.ts by the
 * test next to that file.
 */

export const CLIENT_UPDATE_NAME = "yaadly_client_job_update_v1";

export const CLIENT_UPDATE_BODY =
  "Yaadly update on your job {{1}}. Your tradesperson reports: {{2}} The photographs and the full report are on the job in your Yaadly portal, where you can approve the work or ask for a change: {{3}} Reply here if you have a question.";

/** Twilio's variables must not be empty, carry a newline, or run long. The
 *  same rule as worker-template.ts, kept here so this file stands alone. */
function oneLine(s: string, max: number): string {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return (t.length > max ? t.slice(0, max - 1).trimEnd() + "…" : t) || "-";
}

/** The three variables. The words are the worker's, already confirmed and
 *  already screened by the time they reach here. They end on a full stop so
 *  the sentence after them in the body reads as a new one. */
export function clientUpdateVars(jobTitle: string, jobId: string, words: string, link: string): Record<string, string> {
  let said = oneLine(words, 400);
  if (!/[.!?…]$/.test(said)) said += ".";
  return {
    "1": oneLine(`${jobTitle || "your job"} (${jobId})`, 120),
    "2": said,
    "3": link,
  };
}

// ── every other update to a client, outside the window ────────────────────
//
// Founder, 29 September 2026: "the whatsapp should work well for the client
// also for the entire project not only the worker."
//
// Sixteen kinds of message go to a client. Until that day two had a template
// behind them and neither could fire: both waited for the free text to fail
// with 63016, and worker-template.ts had already recorded, on 17 September,
// that Twilio accepts such a send and fails it after this function has
// returned. So a client who had not written in for a day got email and
// nothing on WhatsApp, for every kind, and nothing said so.
//
// The fix is the one the worker side was given: read the window BEFORE
// sending, and outside it send an approved template.
//
// WHICH TEMPLATE. yaadly_worker_job_update_v1, already approved by Meta. Its
// body names no role: "Yaadly update on your job {{1}}: {{2}}. The full
// details are on the job in your Yaadly portal: {{3}} Reply here if you have
// a question." That sentence is as true to a client as to a worker, so this
// is the template sending the sentence it was approved for, and no client
// waits on a second approval to hear anything at all. The stage report has
// its own template above, which carries the tradesperson's words, and uses
// this one only until that is approved.
//
// One line per kind, completing "Yaadly update on your job X: ...". Each
// says what happened and nothing it cannot know. No amount, no date, and
// nothing about money having moved. A kind that is not here is not sent as
// a template and goes by email, as it did before.
const CLIENT_SUMMARY: Record<string, string> = {
  quote_arrived: "a price has come in for you to look at. Accept it, ask the tradesperson for a change, or review it in full on your job. Nothing is booked and nothing is charged until you accept",
  quote_recommended: "Yaadly has chosen a tradesperson and a price for you to look at. Nothing is booked until you accept",
  quote_accepted: "your tradesperson is booked. Your invoice from Yaadly, with its fee shown, is on the Money tab of your job, and the job goes live once the first payment is made as your terms set out",
  request_declined: "the tradesperson you asked for cannot take it on, so it has gone out to the rest of the vetted network",
  evidence_report_confirmed: "your tradesperson has sent a report on the work, with photographs, for you to look at",
  stage_released: "your approval of the stage is recorded",
  worker_on_site: "your tradesperson checked in on site today",
  walkthrough_notes_ready: "the notes from your video walkthrough are ready to read",
  dispute_raised: "your message has gone to your tradesperson to sort first. Nothing on the job can be approved while it is open",
  dispute_replied: "your tradesperson has replied to what you raised. Say on the job whether it is sorted, or bring Yaadly in",
  completion_report_issued: "your Completion Report is ready to read and keep",
  job_delayed: "there has been no update for a few days, so Yaadly is checking in with your tradesperson",
  addon_for_client: "your tradesperson has changed the extra work, and the new version is waiting for your answer",
  addon_agreed: "the extra work is agreed. Yaadly will send its invoice, and the extra work starts once that is paid",
  addon_closed: "the extra work is not going ahead. Nothing has been booked or charged for it",
  walkthrough_offered: "your tradesperson has offered a day and time for the video walkthrough. Accept it in your portal, or reply here with another time",
  walkthrough_accepted: "the video walkthrough time is accepted and your tradesperson has been told",
};

export function clientTemplateSummary(kind: string): string | null {
  return CLIENT_SUMMARY[kind] ?? null;
}

export function clientSummaryKinds(): string[] {
  return Object.keys(CLIENT_SUMMARY);
}

/** The variables for the shared update template, for a client. */
export function clientSummaryVars(jobTitle: string, jobId: string, summary: string, link: string): Record<string, string> {
  return {
    "1": oneLine(`${jobTitle || "your job"} (${jobId})`, 120),
    "2": oneLine(summary, 300),
    "3": link,
  };
}

// ── the price message: three choices, named ───────────────────────────────
//
// Founder, 1 October 2026: the price message has to state that the client
// can accept, go back or review the price. Until then it said "reply to
// accept, or see it here", which read as one choice.
//
// Each choice says where it is done. Accepting by reply needs a phone on the
// job; asking for a change is the "Ask for a change" link on the job in the
// portal (AskForChange.tsx), which goes to the tradesperson and changes
// nothing until they answer. There is no WhatsApp door for a change request,
// so this does not promise one.
export function quoteChoices(jobId: string, workerName: string, hasPhone: boolean, priceLink: string, jobLink: string): string {
  return [
    `What you can do:`,
    hasPhone
      ? `1. Accept: reply ${jobId} to accept this price and book ${workerName}.`
      : `1. Accept: on the price page: ${priceLink}`,
    `2. Go back to ${workerName}: ask for a change before you accept, with "Ask for a change" on your job: ${jobLink}`,
    `3. Review: the full price, the breakdown and what they propose: ${priceLink}`,
    ``,
    `Nothing is booked and nothing is charged until you accept.`,
  ].join("\n");
}

// ── the booked message: the fee, the invoice, and what starts the job ─────
//
// Founder, 1 October 2026: the booked message has to show the overall fee,
// send the client to the full invoice, and say the job goes live once
// Yaadly's fee and the first payment are made as the terms set out.
//
// Two billing modes exist (raise_job_client_invoice, 20260929100000):
//   in_full:  one invoice for the whole price; the job goes live when it is paid.
//   by_stage: a start bill (the whole 15% fee, never split, plus materials at
//             cost) makes the job live; each stage, the first included, is
//             billed before it starts.
// Amounts are passed in already formatted. No date is promised.
export function bookedPaymentLines(
  byStage: boolean, feeText: string, materialsText: string | null, moneyLink: string,
): string {
  const start = byStage
    ? `The job goes live once the first bill is paid: Yaadly's Guarantee & Support fee of ${feeText}${materialsText ? ` and the materials at cost, ${materialsText}` : ""}. ` +
      `The work is then billed stage by stage, and each stage, the first included, is paid before it starts, as your terms set out.`
    : `The job goes live once your invoice is paid in full, as your terms set out. It is one price covering the work, ${materialsText ? "materials at cost and " : ""}Yaadly's Guarantee & Support fee of ${feeText}.`;
  return `${start}\n\nTap to review the full invoice on the Money tab of your job: ${moneyLink}`;
}
