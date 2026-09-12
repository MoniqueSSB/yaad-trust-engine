/**
 * Files on a job: what is accepted, what it is called, and who may take one
 * back. Pure, so it can be tested without a browser or a database.
 *
 * The rules here mirror the job_files policies in 20260910120000. Postgres
 * is the gate; this module exists so the form never offers what the database
 * will refuse, and so the reason for a refusal is a sentence rather than a
 * status code. If a test here has to change to pass, the screen and the
 * database have stopped agreeing. Fix the code, never the assertion.
 */

export const FILE_KINDS = [
  ["receipt", "Receipt"],
  ["quote", "Quote or estimate"],
  ["permit", "Permit or approval"],
  ["plan", "Plan or drawing"],
  ["certificate", "Certificate or warranty"],
  ["other", "Something else"],
] as const;

export type FileKind = (typeof FILE_KINDS)[number][0];

export function isFileKind(x: unknown): x is FileKind {
  return FILE_KINDS.some(([k]) => k === x);
}

export function fileKindLabel(kind: string | null | undefined): string {
  return FILE_KINDS.find(([k]) => k === kind)?.[1] ?? "File";
}

/** MIME type to file extension. Exactly the bucket's allowed_mime_types. */
export const ACCEPTED_MIMES: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
};

/** Under the bucket's 26214400 (25 MiB) and the Server Action body limit. */
export const MAX_FILE_BYTES = 25_000_000;

export function acceptAttr(): string {
  return Object.keys(ACCEPTED_MIMES).join(",");
}

export function extFor(mime: string | null | undefined): string | null {
  return mime ? (ACCEPTED_MIMES[mime.toLowerCase()] ?? null) : null;
}

/** Null when the file is acceptable, otherwise the sentence to show. */
export function fileProblem(mime: string | null | undefined, bytes: number): string | null {
  if (!bytes || bytes <= 0) return "no file chosen";
  if (!extFor(mime)) return "send it as a PDF, a JPEG, PNG or WebP picture, or a Word document";
  if (bytes > MAX_FILE_BYTES) {
    return `too large at ${(bytes / 1_000_000).toFixed(1)}MB: keep files under about ${MAX_FILE_BYTES / 1_000_000}MB`;
  }
  return null;
}

export function humanBytes(n: number | null | undefined): string {
  if (!n || n <= 0) return "";
  if (n < 1_000_000) return Math.max(1, Math.round(n / 1000)) + " KB";
  return (n / 1_000_000).toFixed(1) + " MB";
}

/** Same test as the insert policy: the job is still open. */
export function canAddFile(jobStatus: string | null | undefined): boolean {
  return jobStatus !== "complete" && jobStatus !== "cancelled";
}

/** Same test as the delete policy: your own file, and the job is not complete. */
export function canRemoveFile(input: {
  uploadedBy: string | null | undefined;
  viewerEmail: string | null | undefined;
  jobStatus: string | null | undefined;
}): boolean {
  const a = (input.uploadedBy ?? "").trim().toLowerCase();
  const b = (input.viewerEmail ?? "").trim().toLowerCase();
  return !!a && a === b && input.jobStatus !== "complete";
}
