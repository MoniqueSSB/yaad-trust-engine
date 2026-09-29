// The taps a worker can make on a report draft and on the daily check-in.
//
// A button on WhatsApp reaches this function as text: the button's id. So a
// tap is a way of typing, never a new authority, and each one is read here and
// handed to the same lane a typed reply has always gone through.
//
// The ids are held word for word against yaad-twilio-setup/content.ts by the
// test next to this file. Change one there and the tap stops matching.
//
// Every id carries the job's code. A button stays on the screen for as long as
// the message does, so a tap can arrive days later, after the draft it sat
// under has been sent or replaced. The code is what lets this function tell a
// tap on the draft that is waiting from a tap on one that is not.

export type DraftTap = { kind: "send" | "edit" | "own"; jobId: string };

const DRAFT_KINDS: Record<string, DraftTap["kind"]> = { DRAFTSEND: "send", DRAFTEDIT: "edit", DRAFTOWN: "own" };

export function readDraftTap(text: unknown): DraftTap | null {
  const m = /^(DRAFTSEND|DRAFTEDIT|DRAFTOWN)\s+(\S+)$/i.exec(String(text ?? "").trim());
  if (!m) return null;
  return { kind: DRAFT_KINDS[m[1].toUpperCase()], jobId: m[2] };
}

/** "I am on site", tapped on the daily check-in. */
export function readOnSiteTap(text: unknown): string | null {
  const m = /^ONSITE\s+(\S+)$/i.exec(String(text ?? "").trim());
  return m ? m[1] : null;
}

/** Whether a tap belongs to the draft that is actually waiting. */
export function tapMatchesDraft(tap: DraftTap, waitingJobId: unknown): boolean {
  const w = String(waitingJobId ?? "").trim();
  return w !== "" && w.toLowerCase() === tap.jobId.toLowerCase();
}
