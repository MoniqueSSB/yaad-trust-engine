// What stands between the reporting model and a worker's thumb.
//
// ── Why this file exists ──
//
// On 29 September 2026 the founder tested a stage for real. The captions on
// file were "1", "fixing beam in place", "changing focus" and "the work is
// done for this stage". The draft offered to the worker read: "The carpentry
// team has completed the beam installation stage. The carpenter has secured
// the beam in its designated position and completed all tasks required for
// this phase of work. Next: the team will move on to the subsequent stage."
//
// The beam was the worker's. Everything else was the model's: a team where
// there was one man, "secured" where he said "fixing", "all tasks required"
// where he said the work was done for the stage, and a next step nobody
// named, which then created a follow-up on the job. The instruction it was
// given already said to report only what the worker said. It broke that in
// polite language, and the banned-terms screen saw nothing because no banned
// word appears.
//
// An instruction to a model is a request. This file is the check. It is
// deterministic, it calls nothing, and it decides nothing about the work: it
// only refuses to put words in a worker's mouth that he did not use. When a
// draft fails, what the worker is offered instead is his own words, plainly.
//
// The worker still chooses. Nothing here sends anything to a client.

/** A caption that carries no description of the work: a bare menu reply such
 *  as "1", a lone character, or nothing. "1" reached the model as if it were
 *  an account of the job. */
export function isUsableCaption(label: unknown): boolean {
  const t = String(label ?? "").trim();
  if (t.length < 3) return false;
  if (/^[\d\s.,#]+$/.test(t)) return false;
  return /[a-z]/i.test(t);
}

/** The captions worth showing anybody, in the order filed, without repeats. */
export function usableCaptions(labels: unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const l of labels ?? []) {
    if (!isUsableCaption(l)) continue;
    const t = String(l).trim().replace(/\s+/g, " ");
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

/** Claims a report may only make when the worker made them. Each entry is the
 *  pattern looked for in the draft and the pattern that, found in the worker's
 *  own words, earns it. Kept short on purpose: these are the words that turn
 *  "I was fixing it" into "it is fixed". */
const CLAIMS: { name: string; draft: RegExp; earnedBy: RegExp }[] = [
  { name: "completed", draft: /\bcomplet(?:e|ed|es|ion)\b/i, earnedBy: /\bcomplet/i },
  { name: "finished", draft: /\bfinish(?:ed|es)?\b/i, earnedBy: /\bfinish/i },
  { name: "secured", draft: /\bsecur(?:e|ed|ely)\b/i, earnedBy: /\bsecur/i },
  { name: "installed", draft: /\binstall(?:ed|ation)\b/i, earnedBy: /\binstall/i },
  { name: "all tasks", draft: /\ball (?:the )?(?:tasks|work|works|items|requirements)\b/i, earnedBy: /\ball (?:the )?(?:tasks|work|works|items|requirements)\b/i },
  { name: "fully", draft: /\b(?:fully|successfully|entirely|properly|correctly)\b/i, earnedBy: /\b(?:fully|successfully|entirely|properly|correctly)\b/i },
  { name: "team", draft: /\b(?:team|crew)\b/i, earnedBy: /\b(?:team|crew|we|us|our)\b/i },
  { name: "designated", draft: /\b(?:designated|required|specified|intended) (?:position|place|location|standard)\b/i, earnedBy: /\b(?:designated|required|specified|intended)\b/i },
];

/** The claims in a draft that the worker's own words do not earn. Empty
 *  means the draft says nothing stronger than he did. */
export function unearnedClaims(draft: string, captions: string[]): string[] {
  const said = captions.join("\n");
  return CLAIMS.filter((c) => c.draft.test(draft) && !c.earnedBy.test(said)).map((c) => c.name);
}

/** A next step only counts when the worker pointed forward himself. A model
 *  asked for a next step will always supply one, and a supplied one creates a
 *  follow-up on the job, so filler here is not harmless. */
const LOOKS_FORWARD = /\b(?:next|tomorrow|then|after that|will|going to|gonna|coming back|come back|return|returning|monday|tuesday|wednesday|thursday|friday|saturday|sunday|waiting (?:on|for)|need(?:s)? to|still to|left to)\b/i;

export function namedNextStep(next: unknown, captions: string[]): string {
  const t = String(next ?? "").trim();
  if (!t || /^(?:nothing|none|n\/a|not given|not stated)\b/i.test(t)) return "";
  return LOOKS_FORWARD.test(captions.join("\n")) ? t : "";
}

/** The draft offered when the model's own will not do: the worker's words,
 *  quoted, and nothing added. */
export function plainDraft(stageLabel: string, captions: string[]): string {
  if (!captions.length) return `Photos have come in for ${stageLabel}, with no description from you yet.`;
  const quoted = captions.map((c) => `"${c}"`).join(", ");
  return `Update on ${stageLabel}, in the tradesperson's own words: ${quoted}.`;
}

/** Shown under the draft so the words and what they came from are on the
 *  screen together at the moment of the tap. */
export function captionsLine(captions: string[]): string | null {
  if (!captions.length) return null;
  return `From what you sent: ${captions.map((c) => `"${c}"`).join(", ")}`;
}
