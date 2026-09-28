import * as guardrails from "./guardrails.ts";

/* The automatic screen on a signed Completion Report (yaad-completion-flow).
 * It finds; it never changes a word. Anything it finds holds the report for
 * Monique rather than sending it to the client. */

// Money in any form, the same shape yaad-completion has screened with since
// August. A worker's account that states what was paid would put a figure on
// a document the owner forwards to family and buyers, which she ruled out.
const MONEY = [
  /(?:J?\$|£|€|USD|JMD|GBP|CAD)\s?[\d,]+(?:\.\d+)?/gi,
  /\b[\d,]+(?:\.\d+)?\s?(?:dollars|pounds|jmd|usd|gbp|cad)\b/gi,
  /\b(?:paid|payment of|cost|price|charged?)\b[^.\n]{0,40}\d/gi,
];

export type ScreenFinding = { kind: "money" | "wording"; text: string };

export function screenWords(notes: string[], account: string | null): ScreenFinding[] {
  const blob = [...notes, account ?? ""].join("\n");
  const out: ScreenFinding[] = [];
  for (const re of MONEY) for (const m of blob.match(re) ?? []) out.push({ kind: "money", text: "money: " + m.trim() });
  for (const f of guardrails.scan(blob)) out.push({ kind: "wording", text: "wording: " + f.term });
  const seen = new Set<string>();
  return out.filter((f) => (seen.has(f.text) ? false : (seen.add(f.text), true)));
}
