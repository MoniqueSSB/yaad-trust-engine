// The worker's own words, screened before they reach a client.
//
// ── Why this file exists ──
//
// Since 31 August 2026 a worker has been able to set the draft aside and
// send his own version of a report. Those words went to the client exactly as
// typed. Everything a model writes is screened by guardrails.ts; the one thing
// a person typed was not, so the single word this company has a standing rule
// never to use could reach a client as long as a worker, and not a model, was
// the one who wrote it. Found 29 September 2026 while building the edit page,
// and closed the same day on the founder's instruction.
//
// ── What it does, and what it deliberately does not ──
//
// It checks the same banned list and nothing else. It does not rewrite his
// words: a report that goes out under a worker's name says what he said or it
// does not go. When something is caught he is told which words and why, and
// the draft stays waiting for him to send it again.
//
// It does NOT screen for promises. promises.ts exists to stop a MODEL
// committing Yaadly to a date. A worker saying "I am back Tuesday to hang the
// door" is telling the client his own plan, which is his to tell.
//
// It decides nothing about the work. It approves nothing and blocks no stage.

import { scan } from "./guardrails.ts";

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
