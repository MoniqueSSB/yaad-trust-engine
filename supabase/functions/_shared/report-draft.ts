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

/** A note about the photograph, not about the work: "changing focus",
 *  "retake", "bad lighting". On 29 September 2026 "changing focus" reached the
 *  model as if it were an account of the job.
 *
 *  Narrow on purpose, because reading meaning out of a caption is the move the
 *  dropped before-and-after check made and got wrong. It fires only on a
 *  caption of four words or fewer that uses camera vocabulary and names no
 *  work. "focus" alone in a longer sentence is left alone. What it drops is
 *  dropped from the DRAFT only: the caption stays on the evidence, where the
 *  desk and the client still see it exactly as typed. */
const CAMERA_WORDS = /\b(?:focus|refocus|refocusing|camera|lens|zoom|zoomed|blurry|blurred|blur|retake|retaking|flash|lighting|angle|selfie)\b/i;

export function isCameraNote(label: unknown): boolean {
  const t = String(label ?? "").trim();
  if (!t) return false;
  return t.split(/\s+/).length <= 4 && CAMERA_WORDS.test(t);
}

/** Whether a reply can stand as a description of a photograph. Used by
 *  yaad-inbound at the moment a worker is asked what his photos show, so a
 *  stray "1" is asked about again and never filed as the caption. */
export function canBeACaption(text: unknown): boolean {
  return isUsableCaption(text);
}

/** The captions worth showing anybody, in the order filed, without repeats. */
export function usableCaptions(labels: unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const l of labels ?? []) {
    if (!isUsableCaption(l) || isCameraNote(l)) continue;
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
 *  quoted, and nothing added.
 *
 *  It is the CLIENT's text. A worker who taps "Send as written" sends exactly
 *  this, so it is written to the client. Until 30 Sep 2026 the no-caption
 *  version said "with no description from you yet", which read to the client
 *  as if they owed the description. What the worker is told about the missing
 *  words is noCaptionPrompt(), shown to him beside the draft, never in it. */
export function plainDraft(stageLabel: string, captions: string[]): string {
  if (!captions.length) return `Photos have come in for ${stageLabel}. They came with no description of the work.`;
  const quoted = captions.map((c) => `"${c}"`).join(", ");
  return `Update on ${stageLabel}, in the tradesperson's own words: ${quoted}.`;
}

/** For the worker only, beside a draft built with none of his words. Says
 *  what the client would get and how to add a line, and leaves the choice his. */
export function noCaptionPrompt(): string {
  return "You have not said what the photos show, so the draft only tells the client that photos came in. Better: type your own line on what they show, and that goes to the client instead. Or send it as it is.";
}

/** Shown under the draft so the words and what they came from are on the
 *  screen together at the moment of the tap. */
export function captionsLine(captions: string[]): string | null {
  if (!captions.length) return null;
  return `From what you sent: ${captions.map((c) => `"${c}"`).join(", ")}`;
}

/** What the worker is told on WhatsApp once a report sent from the edit page
 *  has gone.
 *
 *  Founder, 29 September 2026. She edited a draft on the page, pressed Send,
 *  and then said "but whatsapp hasnt updated". The page said it was sent.
 *  The chat, which is where a worker actually is, said nothing, and still
 *  showed three live buttons for a draft that had already gone. A reply of 1
 *  on WhatsApp has always been answered there; the page never was.
 *
 *  `reached` is whether the client was actually told, by email or WhatsApp.
 *  When they were not, the worker is told that and not that it was sent: the
 *  report is saved either way, and a person at Yaadly is alerted.
 *
 *  Says what happens next and what the worker has to do, which is nothing.
 *  No day, no hour, nothing about pay or what the client will decide. */
export function reportSentReceipt(jobId: string, title: string, reached: boolean): string {
  const what = `${jobId}${title ? ` (${title})` : ""}`;
  return reached
    ? `Sent to the client, in your words, for ${what}. The buttons on the draft above are finished with. Next: the client reads it, looks at your photographs and decides. You hear here when they do. Nothing more is needed from you on this update.`
    : `Your report for ${what} is saved, but it has not reached the client yet. A person at Yaadly has been told and is looking at why. Nothing more is needed from you on this update.`;
}
