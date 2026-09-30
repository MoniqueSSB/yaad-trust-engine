/** Reaching a worker who has not written to Yaadly in the last 24 hours.
 *
 *  WhatsApp only delivers ordinary text inside 24 hours of the person's own
 *  last message. Outside it, Twilio accepts the send and it fails later as
 *  63016, after this function has already returned, so the "retry with a
 *  template on 63016" fallback never saw it. Every worker message on the
 *  delivery log that failed this way failed silently.
 *
 *  So the window is read BEFORE sending, off wa_inbound_seen, and a worker
 *  outside it gets the approved template yaadly_worker_job_update_v1 instead:
 *  one short true sentence about what happened, and the link to the job where
 *  the whole message is. Founder, 17 Sep 2026: "fix this".
 *
 *  Pure, so the words and the window rule are tested without a webhook. */

export const WORKER_UPDATE_TEMPLATE_NAME = "yaadly_worker_job_update_v1";

/** The body Meta approves, word for word. Kept here, not only in the setup
 *  function, so the test can hold the summaries to the sentence they sit in. */
export const WORKER_UPDATE_BODY =
  "Yaadly update on your job {{1}}: {{2}}. The full details are on the job in your Yaadly portal: {{3}} Reply here if you have a question.";

/** One line per worker kind, completing "Yaadly update on your job X: ...".
 *  Each says what happened and nothing it cannot know. Null means the kind is
 *  NOT sent as a template, because its message only works in full: a drafted
 *  report the worker must read before replying 1 cannot be summarised into a
 *  sentence without asking them to approve words they have not seen. */
const SUMMARY: Record<string, string | null> = {
  booked_worker: "the client has accepted your price and you are booked. Do not start until Yaadly tells you the job is live",
  job_live_worker: "the client has paid, so the job is live and you can start. When you arrive on site, send your location in this chat to check in",
  evidence_comment: "the client has left a note on your evidence",
  evidence_landed: null,
  kickoff_pack_ready: "your Kickoff Pack is ready to read and confirm",
  quote_not_selected: "another tradesperson was booked for this one, so it is closed for you",
  stage_released_worker: "the client has signed off the work. Yaadly pays you for the last stage by bank transfer within 7 days",
  stage_signed_off_worker: "the client has signed off a stage. You are paid for it by bank transfer within 7 days. The next stage is on the job",
  worker_requested: "a client has asked for you by name",
  dispute_raised_worker: "the client has raised something about the work",
  materials_sent_worker: "Yaadly has sent you the materials money",
  worker_paid: "Yaadly has sent you a payment",
  walkthrough_requested: "the client has asked for a video walkthrough",
  walkthrough_accepted_worker: "the client accepted your time for the video walkthrough",
  completion_report_worker: "your Completion Report is ready. Open the link below, no login needed, to sign it, change your words or raise an issue",
  addon_for_worker: "the client has asked for extra work. Accept it, change it or turn it down on the Extra work tab",
  addon_agreed_worker: "the extra work is agreed. Do not start it until Yaadly tells you it is paid",
  addon_paid_worker: "the client has paid for the extra work, so you can start it. File photos of it on the Extra work tab",
  addon_closed_worker: "the extra work is not going ahead, and nothing has been booked",
};

/** Whether a kind has been decided on at all. A new worker kind added to the
 *  routing without a line here fails the test rather than quietly failing
 *  outside the window. */
export function hasWorkerTemplateDecision(kind: string): boolean {
  return Object.prototype.hasOwnProperty.call(SUMMARY, kind);
}

export function workerTemplateSummary(kind: string): string | null {
  return SUMMARY[kind] ?? null;
}

// The window rule now lives in wa-window.ts, shared with yaad-job-health, so
// both read it the same way. Re-exported so nothing that imports it from here
// changes.
export { insideWindow, samePhoneDigits, WINDOW_MS } from "./wa-window.ts";

/** Twilio's variables must not be empty, carry a newline, or run long. */
export function templateVar(s: string, max = 200): string {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return (t.length > max ? t.slice(0, max - 1).trimEnd() + "…" : t) || "-";
}
