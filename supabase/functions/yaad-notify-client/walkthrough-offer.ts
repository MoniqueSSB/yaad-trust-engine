// The video walkthrough, arranged through Yaadly and never between the two
// phones. 30 Sep 2026.
//
// Founder, on the worker's message: "they dont have their whatsapp to
// arrange the call", then "i dont confirm not with the client, the client
// accept the info is sent by yaadly". So the worker offers a day and time,
// Yaadly sends it to the client, the client accepts. Nobody's number moves
// and no person relays. This file is the pure part: what counts as a time
// offer, what counts as an acceptance, and the words each side gets.

/** Does a worker's reply read as a day and time rather than a work update?
 *  A worker with a walkthrough waiting was asked for one, but they may also
 *  be sending an ordinary update on the same job. Only words about when go
 *  to the client. */
export function looksLikeATime(text: string): boolean {
  const t = (text ?? "").trim();
  if (!t || t.length > 300) return false;
  return /\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*\b|\b(today|tomorrow|tonight|weekend|morning|afternoon|evening|midday|noon)\b|\b\d{1,2}(:\d{2})?\s*(am|pm)\b|\bo'?clock\b|\b\d{1,2}(st|nd|rd|th)\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i.test(t);
}

/** A link in the offer, if the worker pasted one (Meet or Zoom). */
export function linkIn(text: string): string | null {
  const m = /(https?:\/\/[^\s]+)/i.exec(text ?? "");
  return m ? m[1] : null;
}

/** The client's acceptance: the button's id, or the words. Carries the job
 *  code, so a tap on an old message cannot accept a different job's time. */
export const WALK_ACCEPT_TAP = "WALKOK";

export function readWalkAccept(text: string): string | null {
  const m = /^(?:WALKOK|accept|accepted|yes accept|ok accept)\s+(\S+)$/i.exec((text ?? "").trim());
  return m ? m[1] : null;
}

/** What the worker is told once their offer has gone. */
export function offerSent(offer: string): string {
  return `Sent to the client:\n"${offer}"\n\nYou hear here when they accept.`;
}

/** What the client is told. Platform is the one they chose. */
export function offerForClient(jobId: string, title: string, offer: string, platformLabel: string, portalLink: string): string {
  return [
    `Your tradesperson can do the walkthrough on ${title} (${jobId}):`,
    `"${offer}"`,
    `On ${platformLabel}.`,
    ``,
    `Reply ACCEPT ${jobId} to accept it.`,
    `Or reply with another time. It goes to Yaadly.`,
    `Or accept in your portal: ${portalLink}`,
  ].join("\n");
}

export const PLATFORM_LABEL: Record<string, string> = { whatsapp: "WhatsApp video", google_meet: "Google Meet", zoom: "Zoom" };

/** The call link is made by Yaadly the moment the time is agreed
 *  (walkthrough_room_link, 20260930120000), so both sides get it here. */
export function acceptedForClient(offer: string, platformLabel: string, link: string | null): string {
  return [
    `Accepted: "${offer}".`,
    `Your tradesperson has been told.`,
    link ? `Join here at that time: ${link}` : `The call link is on your job.`,
  ].join("\n");
}

export function acceptedForWorker(jobId: string, title: string, offer: string, platformLabel: string, link: string | null, portalLink: string): string {
  return [
    `The client accepted: "${offer}".`,
    `${title} (${jobId}).`,
    ``,
    link ? `Join here at that time: ${link}` : `The call link is on the job: ${portalLink}`,
    `After the call, write the notes on the job. The client confirms them.`,
  ].join("\n");
}
