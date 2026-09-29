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
