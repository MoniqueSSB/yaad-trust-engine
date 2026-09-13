/* ── job-file-lane.ts ─────────────────────────────────────────────────────
 *
 * The pure half of the WhatsApp document lane (10 Sep 2026): what counts as
 * a document, what to call it, and which kind to guess from the caption.
 * Pulled out of index.ts for the same reason as job-match.ts: index.ts
 * starts a live server at module load, so this is the part a permanent
 * test can import.
 *
 * A document sent over WhatsApp lands in job_files (20260910120000), never
 * in evidence. Photos and videos keep going to the evidence lane exactly as
 * before; this only ever looks at the three document types the job-files
 * bucket accepts.
 */

/** MIME type to extension, exactly the job-files bucket's document types.
 *  Images are deliberately absent: an image over WhatsApp is evidence. */
export const DOC_EXT_BY_MIME: Record<string, string> = {
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
};

export function docExt(mime: string): string | null {
  return DOC_EXT_BY_MIME[(mime || "").split(";")[0].trim().toLowerCase()] ?? null;
}

export function isDocMime(mime: string): boolean {
  return docExt(mime) !== null;
}

export type FileKind = "receipt" | "quote" | "permit" | "plan" | "certificate" | "other";

/** A caption that plainly names what the document is decides its kind.
 *  Anything else is 'other', which the desk or the sender can read for
 *  themselves; guessing harder would file a permit as a plan. */
export function guessFileKind(caption: string): FileKind {
  const t = (caption || "").toLowerCase();
  if (/\b(receipt|invoice|bill|paid|hardware|lumber)\b/.test(t)) return "receipt";
  if (/\b(quote|quotation|estimate)\b/.test(t)) return "quote";
  if (/\b(permit|approval|approved|kspa|nepa|parish council|licen[cs]e)\b/.test(t)) return "permit";
  if (/\b(plan|drawing|sketch|layout|blueprint)\b/.test(t)) return "plan";
  if (/\b(certificate|cert|warranty|guarantee)\b/.test(t)) return "certificate";
  return "other";
}

/** The label a file gets: the sender's own words if they wrote any, else
 *  where it came from. Never invented. */
export function fileLabel(caption: string, channel = "whatsapp"): string {
  const trimmed = (caption || "").trim();
  if (trimmed) return trimmed.slice(0, 140);
  return channel === "whatsapp" ? "Sent on WhatsApp" : "Sent in a message";
}

/** Every job a person could be filing a document against: anything not
 *  finished, cancelled or still a draft. Wider than the evidence lane's
 *  list on purpose, because a quote or a permit belongs on a job before
 *  any work stage exists. */
export const FILEABLE_STATUSES = [
  "open_for_quotes", "quoted", "awaiting_payment", "in_progress", "evidence", "disputed",
] as const;

export function isFileableStatus(status: string | null | undefined): boolean {
  return (FILEABLE_STATUSES as readonly string[]).includes(status ?? "");
}
