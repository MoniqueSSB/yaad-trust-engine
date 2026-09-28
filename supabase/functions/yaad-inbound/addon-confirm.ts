/** A client accepting an add-on on WhatsApp (20260928235000).
 *
 *  The message that carries a changed add-on ends "To accept this version,
 *  reply: CONFIRM <code>". Only that exact shape is read as an acceptance:
 *  the whole message, the word CONFIRM and a six-character code, in any case,
 *  with at most a full stop or an exclamation mark after it. Anything else
 *  falls through to the other lanes untouched. The code never contains the
 *  job id, so a reply here can never be taken for a stage approval later.
 *  Pure, so it is tested without a webhook. */
export function parseAddonConfirm(text: string): string | null {
  const m = String(text ?? "").trim().match(/^confirm\s+([0-9a-f]{6})\s*[.!]?$/i);
  return m ? m[1].toUpperCase() : null;
}
