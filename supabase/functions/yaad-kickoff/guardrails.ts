// The banned-language screen, on the live side.
//
// ── Why this file exists ──
//
// `yaad/guardrails.py` screens every line the Python engine emits, and the
// tests in `tests/test_engine.py` prove it. CLAUDE.md calls that the product.
//
// It was never true of the thing that actually talks to clients. `yaad-inbound`
// composes a WhatsApp or SMS reply with a model, strips forward-looking
// promises and strips dashes, and sends it to a real person. Nothing checked
// whether it had said "escrow", and escrow is the single word this company has
// a standing rule never to use. Found and closed 30 August 2026.
//
// ── Keep this list identical to the Python one ──
//
// Two copies of a rule drift, and a rule that is true in one runtime and not
// the other is worse than no rule, because it reads as covered. The patterns
// below are a direct port of BANNED_TERMS in `yaad/guardrails.py`. Change one,
// change both, in the same commit. `guardrails_test.ts` and the Python tests
// both assert the same phrases, which is what makes the drift visible.

export type Finding = { term: string; guidance: string };

const BANNED: [RegExp, string][] = [
  [/\bescrow(ed|s)?\b/gi, "Use 'held safely with a licensed payment provider', never 'escrow'."],
  [/\b100\s?%/gi, "No absolute claims. Give the real figure or drop the claim."],
  [/\bzero (fraud|risk|conflicts?)\b/gi, "No absolute claims."],
  [/\bremoves? all fraud\b/gi, "No absolute claims."],
  [/\bguarantee[sd]? (?:no|zero) \w+/gi, "No absolute claims."],
  [/\bfully covered\b/gi, "Say 'protected up to the guarantee limit', not 'fully covered'."],
  [/\bwe hold (?:your |the )?(?:money|funds)\b/gi, "Yaadly orchestrates the flow, it does not hold funds itself."],
  // Added 4 September 2026. The line above catches the active voice and only
  // the active voice, and the passive is the form a model actually reaches for:
  // "money is held and released stage by stage". That exact sentence was sitting
  // in the WhatsApp assistant's own list of approved facts, so the one phrase
  // the screen exists to stop was the phrase the instructions supplied.
  //
  // Deliberately narrow. It bans the claim that THE CLIENT'S money is sitting
  // with Yaadly awaiting release, which is the escrow reading and is wrong under
  // the principal structure settled on 3 September: the client buys the job from
  // Yaadly outright. It does not touch "held safely with a licensed payment
  // provider", which CLAUDE.md section 8 prescribes by name and which is not
  // this session's to retire.
  [/\b(?:your|the client'?s?|their)\s+(?:money|funds?)\s+(?:is|are|was|were|will be)\s+(?:being\s+)?held\b/gi,
   "Yaadly is principal: the client buys the job from Yaadly. Never describe the client's money as held."],
  [/\bwe(?:'re|\s+are)\s+holding\s+(?:your|the|their)\s+(?:money|funds?)\b/gi,
   "Yaadly is principal: the client buys the job from Yaadly. Never say Yaadly is holding money."],
];

/** Every banned-language hit in a block of outbound text. */
export function scan(text: string): Finding[] {
  const found: Finding[] = [];
  for (const [pattern, guidance] of BANNED) {
    // Fresh lastIndex each time: these are module-level /g regexes and a
    // leftover lastIndex from the previous call silently skips the first hit.
    pattern.lastIndex = 0;
    for (const m of String(text ?? "").matchAll(pattern)) found.push({ term: m[0], guidance });
  }
  return found;
}

export function isClean(text: string): boolean {
  return scan(text).length === 0;
}

/**
 * What a client gets instead of a reply that failed the screen.
 *
 * The Python engine raises on a hit, which is right for a batch job and wrong
 * here: raising means somebody who messaged about their roof gets silence, and
 * from their side silence is indistinguishable from the message vanishing.
 *
 * So the machine refuses to send it and hands it to a person, which is the
 * governing rule doing exactly what it is for. Deliberately says nothing about
 * money, timing or what will happen to their job, because the draft that
 * triggered this is not trustworthy and neither is a guess at what it meant.
 */
export const SAFE_FALLBACK =
  "Thanks for your message, I have got it. Let me pass this one to a person at Yaadly "
  + "rather than answer it myself, and somebody will come back to you on this number.";

/** Bounded span attributes for a screened message. Never the text itself. */
export function screenAttrs(findings: Finding[]): Record<string, string | number> {
  return {
    "yaadly.guardrail.blocked": findings.length > 0 ? 1 : 0,
    // The matched excerpt can carry fragments of whatever was screened, so only
    // the closed set of guidance strings goes to telemetry. Same reasoning as
    // record_guardrail_event in the Python side.
    "yaadly.guardrail.terms": [...new Set(findings.map((f) => f.guidance))].sort().join(","),
  };
}
