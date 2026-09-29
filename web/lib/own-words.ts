/**
 * The worker's own words, screened before they reach a client.
 *
 * The app's copy of supabase/functions/_shared/own-words.ts, and
 * lib/guardrails.ts beside it is a byte for byte copy of the shared banned
 * list. tests/own-words.test.mjs fails if either drifts, because a rule that
 * is true in one runtime and not another reads as covered and is not.
 *
 * Same behaviour: the banned list and nothing else, nothing rewritten, and he
 * is told which words so he can fix it without guessing.
 */
import { scan } from "./guardrails";

export type OwnWordsResult = { ok: true } | { ok: false; terms: string[]; message: string };

export function screenOwnWords(text: unknown): OwnWordsResult {
  const findings = scan(String(text ?? ""));
  if (!findings.length) return { ok: true };
  const terms = [...new Set(findings.map((f) => f.term.trim().toLowerCase()))];
  const quoted = terms.map((t) => `"${t}"`).join(", ");
  return {
    ok: false,
    terms,
    message: `Not sent. Your message says ${quoted}, which Yaadly does not say to a client. ${findings[0].guidance} `
      + "Send it again without that. Nothing has gone to the client.",
  };
}
