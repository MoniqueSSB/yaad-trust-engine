/** Worker-facing words that are worth testing on their own. 30 Sep 2026.
 *
 *  Kept out of index.ts so the wording can be run, not only read, and kept
 *  out of evidence-checks.ts because that file is a copy of _shared and its
 *  details are written for the desk pack as much as for a worker. What a
 *  worker on a phone mid-job reads is decided here.
 *
 *  Pure: no database, no network. */

import type { Check } from "./evidence-checks.ts";

/** How to share a location in a WhatsApp chat, said the same way everywhere. */
const SHARE_STEPS = "Tap the plus sign (or the paperclip) in this chat, choose Location, then Send your current location.";

/** What a worker is told after filing evidence: what is still missing, and
 *  any tips, kept apart.
 *
 *  The check-in is NEVER under "Still missing". Founder, 29 Sep 2026: the
 *  arrival check-in asks, it never gates, and it can be skipped. So a missing
 *  check-in, and a missing location, become one soft tip. The video stays
 *  under "Still missing", because the founder's own wording is that videos
 *  are needed. Plain words throughout: video, not clip; no "pack". */
export function workerEvidenceLines(checks: Check[]): { missing: string[]; tips: string[] } {
  const failed = checks.filter((c) => c.audience === "worker" && !c.passed);
  const missing: string[] = [];
  const tips: string[] = [];
  let arrivalMissing = false;
  let pinMissing = false;
  for (const c of failed) {
    if (c.name === "Arrival") { arrivalMissing = true; continue; }
    if (c.name === "Location pin") { pinMissing = true; continue; }
    if (c.name === "Clip") {
      missing.push("A video of this stage. Photos only so far, and a short walk-through video shows things a photo cannot.");
      continue;
    }
    if (c.severity === "gap") missing.push(c.detail);
    else tips.push(c.detail);
  }
  if (arrivalMissing) {
    tips.unshift(`Tip: check in with your location when you arrive. ${SHARE_STEPS} It shows you were on site.`);
  } else if (pinMissing) {
    tips.unshift(`Tip: share your location before you leave site today. ${SHARE_STEPS} It shows you were on site.`);
  }
  return { missing, tips };
}

/** The pay line on booked_worker, or null when there is no accepted quote to
 *  read it from. A worker is never shown J$0 as their pay because a row was
 *  not found: no figure is better than a wrong one. */
export function bookedPayLine(
  quote: { labour_jmd?: number | null; materials_jmd?: number | null } | null | undefined,
  money: (n: number) => string,
): string | null {
  if (!quote) return null;
  const l = Math.round(Number(quote.labour_jmd ?? 0));
  const m = Math.round(Number(quote.materials_jmd ?? 0));
  if (!(l > 0) && !(m > 0)) return null;
  const labourPay = l - Math.round(l * 0.07); // 7% from 4 Oct 2026 (was 5%)
  return `Your pay: ${money(labourPay)} for labour.${m ? ` Materials ${money(m)} at cost.` : ""} Total ${money(labourPay + m)}.`;
}

/** The worker hears that the client has paid for the stage being worked, on
 *  a job billed by stage. Sent only after a person has marked that bill paid. */
export function stagePaidWorkerText(jobId: string, title: string, stage: string, link: string): string {
  return [
    `${jobId} (${title}): the client has paid for ${stage}. You can start it now.`,
    `Send photos and videos as you go, here or on the job: ${link}`,
    `Say what each one shows, in a line or a voice note.`,
  ].join("\n");
}

/** The Completion Report message to the worker.
 *
 *  `line` goes wherever no buttons arrive (a text message, an email, Meta's
 *  API, a template fallback), so it names the three choices on the page.
 *  `waLine` is the WhatsApp free text that the three buttons follow, so it
 *  does not name them a second time. With no buttons, waLine is "" and the
 *  send path uses `line`. */
export function completionReportWorkerCopy(o: {
  title: string; jobId: string; signLink: string; returnReason?: string | null; buttons: boolean;
  clip: (s: string, n: number) => string;
}): { line: string; waLine: string } {
  const choices = "On that page: sign it if it is right, change the words to say it your way, or raise an issue if something is wrong.";
  const reason = String(o.returnReason ?? "").trim();
  const head = reason
    ? [`Yaadly sent the Completion Report for ${o.title} back to you:`, ``, `"${o.clip(reason, 600)}"`, ``, `It is your document.`]
    : [`Your Completion Report for ${o.title} (${o.jobId}) is ready.`, `It is your document.`];
  const tail = `It goes to the client only when you sign.`;
  const line = [...head, `Open it here, no login: ${o.signLink}`, ``, choices, ``, tail].join("\n");
  const waLine = o.buttons
    ? [...head, `Use the buttons below, or open it here, no login: ${o.signLink}`, ``, tail].join("\n")
    : "";
  return { line, waLine };
}
