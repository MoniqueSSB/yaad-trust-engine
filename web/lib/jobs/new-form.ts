/* ── The rules behind the "Post a job" form ────────────────────────────────
 *
 * Pulled out of the component on 3 Sep 2026, when the form went from three
 * screens to six. Two reasons, and the second is the real one.
 *
 * The first is that a form with six stages needs an answer to "may this
 * person move on yet", and that answer was three inline boolean expressions
 * in the middle of the JSX where nothing could test it.
 *
 * The second is ACCESS, below. Two of those four sentences are read by a
 * Postgres trigger that decides which workers may quote the job, so the exact
 * words are load bearing and a well-meaning copy edit could open a gate
 * nobody meant to open. There is no way to test that from inside a React
 * component, and it is the kind of thing that has to be tested.
 *
 * Nothing in here talks to Supabase or to the browser. The storage helpers
 * take the raw string and hand back a value, so a saved draft can be tested
 * without a localStorage to put it in.
 */

/* ── validation, carried over exactly ─────────────────────────────────────
   These two were inline in PostJob.tsx and are unchanged, deliberately. The
   phone one is loose (any seven digits) because a Jamaican mobile, a UK
   landline and a US number with a country code all have to pass, and a
   person who mistypes their own number is a problem a reply cannot fix but
   a stricter regex cannot either. */
export const looksLikeEmail = (v: string) => /^[^\s@]+@[^\s@.]+\.[^\s@]{2,}$/.test(v.trim());
export const looksLikePhone = (v: string) => v.replace(/\D/g, "").length >= 7;

/** The description floor, as it was: more than ten characters once trimmed.
 *  Low on purpose. "Roof leaking bad" is eleven and is a real job. */
export const MIN_DESC = 11;

/* ── how urgent is it ─────────────────────────────────────────────────────
 *
 * The wording is not new. It was settled in preview/index.html, which is
 * where product decisions get made before they are built, and it is the
 * vocabulary the marketplace board already prints.
 *
 * The first one has to keep the word "urgent" in it. The admin desk chips
 * urgency red on /urgent|emergency/i, so that word is what makes a job stand
 * out in the list Monique reads down. Asserted in the tests.
 *
 * jobs.urgency has no CHECK constraint, so nothing in Postgres would stop a
 * fourth option being added. That is exactly why the list lives in one place.
 */
export const URGENCY = [
  {
    value: "Urgent, within 48 hours",
    note: "It is getting worse, or the property is not safe to leave as it is",
  },
  {
    value: "Within the next two weeks",
    note: "Soon, but I can wait for the right person",
  },
  {
    value: "Flexible, or pricing it up for later",
    note: "Planning ahead, no date on it yet",
  },
] as const;

/* ── who can let a worker in ──────────────────────────────────────────────
 *
 * READ THIS BEFORE CHANGING A WORD OF THE FOUR SENTENCES BELOW.
 *
 * This answer is written to jobs.access_type, and enforce_vetted_worker_on_quote
 * (migration 20260831d) reads that column when a worker submits a quote. A
 * worker still in Probation, meaning the police check and the telephoned
 * references have not cleared, is REFUSED the job when access_type matches
 * either of these:
 *
 *     /(key|keys)/i                          they would be holding keys
 *     /(on site|occupied|lives there|at home)/i   inside an occupied home
 *
 * So the words carry the gate. "A key is held locally" blocks probation
 * because of one word in it. Take that word out and a worker whose police
 * check has not come back can quote a job where somebody hands them a key to
 * an empty house.
 *
 * Until now this form never asked, so access_type was null on every job
 * posted from the web and the gate was skipped every time. Asking the
 * question is what switches it on. Founder decision, 3 Sep 2026.
 *
 * The fourth option matches neither pattern, which is the same outcome as the
 * null this form used to write. It is offered anyway because "still to be
 * arranged" is a real answer, and a desk that reads it is better off than a
 * desk reading "not said".
 *
 * ONE MORE THING ABOUT THE WORDING. open_jobs is granted to anon, and it
 * selects access_type, so these sentences are readable by anybody on the
 * internet who opens the marketplace. None of them says a house is empty.
 * "A key is held locally" carries the gate signal a worker needs without
 * publishing that nobody is home, and that is the reason it is phrased that
 * way rather than the more obvious way round.
 */
export const ACCESS = [
  {
    value: "Somebody lives there and is at home day to day",
    note: "The work happens around whoever is in the house",
  },
  {
    value: "A key is held locally, by family or a neighbour",
    note: "Nobody is in the house all day, but somebody nearby can open up",
  },
  {
    value: "No inside access needed, outside work only",
    note: "Roof, yard, fence, gate, exterior walls",
  },
  {
    value: "Still to be arranged, I will sort it out with Yaadly",
    note: "Say so and we work it out when we reply",
  },
] as const;

/* ── who buys the materials ───────────────────────────────────────────────
 * Step 2 of specs/MATERIALS-ROUTE-FLOW-SPEC.md. Two answers and no others,
 * mapped to jobs.materials_by ('yaadly' or 'client') server side in
 * yaad-post-job, never posted as a code from here.
 *
 * WHY IT IS ASKED HERE AND NOT LATER. Before this, nobody asked the client at
 * all: the route was decided by whether the WORKER typed a number into
 * materials_jmd on his quote. Who buys the materials decides who carries the
 * risk on the goods, which is the client's call, and it has to be made before
 * anybody prices anything. Ask it after quotes are in and every quote on the
 * job was priced against a guess.
 *
 * WHY THERE IS NO "NOT SURE" OPTION. The clickable prototype offered four,
 * including "Not sure, worker to advise" and "Split, agree item by item".
 * Both are gone. A split job cannot say who is answerable when a wall fails,
 * because the workmanship obligation and the risk on the goods have to sit
 * with the same party. "Not sure" leaves it open at the exact moment quoting
 * starts, which is the thing being fixed. Somebody who genuinely does not
 * know wants the first option, which is why it is first and why it says so.
 *
 * The second option carries what it costs, ON the option, not on the terms
 * page. It moves materials risk, programme risk and part of the guarantee
 * onto the client, and a client who picks it to save money without knowing
 * that will be angry later with good reason.
 */
export const MATERIALS = [
  {
    value: "Yaadly buys the materials",
    note: "They are part of the price and they are the first payment on the job. You see the receipt and photographs of them on your property before any labour is paid for.",
  },
  {
    value: "I am supplying the materials myself",
    note: "You buy and deliver them, and Yaadly is engaged for the labour only. The tradesperson tells you what the job needs. He is not answerable for materials being short, late or wrong, dates move if they are not there, and the guarantee covers his work and not your materials.",
  },
] as const;

/** True when the client is supplying the materials, so the job is labour only
 *  and no quote on it may carry a materials figure. Postgres is the real gate
 *  (quote_materials_match_route, 20260905d); this is for the form. */
export const clientSuppliesMaterials = (materialsBy: string) =>
  materialsBy === MATERIALS[1].value;

/** The two patterns from 20260831d, restated so the tests can prove the four
 *  sentences above still land on the right side of them. Kept here rather
 *  than in the test file so that anybody editing ACCESS sees them. */
export const PROBATION_KEYS = /(key|keys)/i;
export const PROBATION_OCCUPIED = /(on site|occupied|lives there|at home)/i;

/** True when a worker still in Probation would be refused this job. */
export const blocksProbation = (accessType: string) =>
  PROBATION_KEYS.test(accessType) || PROBATION_OCCUPIED.test(accessType);

/* ── the six stages ───────────────────────────────────────────────────────
 * One question per stage, in the order somebody actually thinks about a
 * problem with a building: what is wrong, where it is, how soon, what you can
 * show us, how to reach you, then a look at the whole thing before it goes.
 * Nothing personal is asked before stage five.
 */
export type StageKey = "work" | "property" | "urgency" | "evidence" | "reach" | "review";

export const STAGES: { key: StageKey; label: string; short: string }[] = [
  { key: "work",     label: "What needs doing",   short: "The work" },
  { key: "property", label: "Where the property is", short: "Property" },
  { key: "urgency",  label: "How urgent it is",   short: "Urgency" },
  { key: "evidence", label: "Photos and evidence", short: "Photos" },
  { key: "reach",    label: "How to reach you",   short: "Contact" },
  { key: "review",   label: "Check it and send",  short: "Review" },
];

export type Fields = {
  trade: string;
  parish: string;
  desc: string;
  urgency: string;
  accessType: string;
  materialsBy: string;
  name: string;
  contact: string;
};

export const EMPTY_FIELDS: Fields = {
  trade: "", parish: "", desc: "", urgency: "", accessType: "", materialsBy: "",
  name: "", contact: "",
};

/** Whether a stage has enough on it to move forward.
 *
 *  Urgency and access are REQUIRED. That is a change: the form used to ask
 *  neither. They are required rather than optional because an optional
 *  question on a form is a question most people skip, and a job with no
 *  urgency and no access answer is the job that needs a phone call before
 *  anybody can quote it, which is the whole thing this is trying to avoid.
 *
 *  Who buys the materials is required for a harder reason, and it is why it
 *  sits on the FIRST stage rather than being tucked in later. It decides what
 *  the worker quotes: labour and materials, or labour alone. An unanswered
 *  one does not produce a job needing a phone call, it produces a job where
 *  every quote was priced against a guess about who is buying, and a client
 *  accepting a number that should never have been on the page. Somebody who
 *  does not know wants the first option, which is the managed job and the
 *  normal answer, so there is no honest case for an escape hatch here.
 *
 *  The photos stage takes no input at all, so it is always complete. It is a
 *  stage rather than a paragraph because what to photograph is worth its own
 *  screen, and because a step somebody reads is a step they remember. */
export function stageComplete(key: StageKey, f: Fields): boolean {
  switch (key) {
    case "work":     return f.trade !== "" && f.desc.trim().length >= MIN_DESC
                         && f.materialsBy !== "";
    case "property": return f.parish !== "" && f.accessType !== "";
    case "urgency":  return f.urgency !== "";
    case "evidence": return true;
    case "reach":    return f.name.trim().length > 1 && (looksLikeEmail(f.contact) || looksLikePhone(f.contact));
    case "review":   return STAGES.slice(0, 5).every((s) => stageComplete(s.key, f));
  }
}

/** The first stage still missing something, or null when the whole form is
 *  ready. What the review screen uses to decide whether Send is live, and
 *  where to send somebody who presses it too early. */
export function firstIncomplete(f: Fields): StageKey | null {
  for (const s of STAGES) {
    if (s.key === "review") continue;
    if (!stageComplete(s.key, f)) return s.key;
  }
  return null;
}

/* ── not losing somebody's work ───────────────────────────────────────────
 *
 * The draft was already saved server-side before anything personal was
 * asked, and the comment at the top of the old component said so. What it
 * did not say is that the job reference lived in React state and nowhere
 * else, so closing the tab left a job on file that the person could never
 * reach again, and lost them the code that opens it. That is worse than no
 * draft, because it reads as covered.
 *
 * So the reference and the answers are kept in the browser too.
 *
 * WHAT IS DELIBERATELY NOT KEPT: the name, the contact detail and the portal
 * code. The first two because this form is filled in on shared family
 * phones and a name and a number left in local storage is personal data
 * nobody asked us to keep. The portal code because it is a credential: job
 * id plus code opens the job. It comes back from the server on the next
 * draft save anyway, so storing it buys nothing and risks something.
 */
export const DRAFT_KEY = "yaadly.job.new.v1";

/** A week. Long enough for somebody who got interrupted on a Friday, short
 *  enough that a stranger on the same phone next month sees a clean form. */
export const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type DraftFields =
  Pick<Fields, "trade" | "parish" | "desc" | "urgency" | "accessType" | "materialsBy">;

export type StoredDraft = { v: 1; jobId: string; at: number; fields: DraftFields };

export function draftFields(f: Fields): DraftFields {
  return {
    trade: f.trade, parish: f.parish, desc: f.desc, urgency: f.urgency,
    accessType: f.accessType, materialsBy: f.materialsBy,
  };
}

/** Something worth bringing back. A trade tapped by accident is not. */
export function worthKeeping(f: DraftFields): boolean {
  return f.desc.trim().length > 0 || f.trade !== "" || f.parish !== "";
}

export function serialiseDraft(jobId: string, f: Fields, now: number): string {
  return JSON.stringify({ v: 1, jobId, at: now, fields: draftFields(f) } satisfies StoredDraft);
}

/** Anything unreadable, from another version, expired, or with nothing on it
 *  comes back as null rather than throwing. A saved draft is a convenience,
 *  and a convenience must never be able to stop the form loading. */
export function parseDraft(raw: string | null, now: number): StoredDraft | null {
  if (!raw) return null;
  let j: unknown;
  try { j = JSON.parse(raw); } catch { return null; }
  if (!j || typeof j !== "object") return null;
  const d = j as Record<string, unknown>;
  if (d.v !== 1) return null;
  const at = typeof d.at === "number" ? d.at : 0;
  if (!at || now - at > DRAFT_TTL_MS) return null;
  const src = (d.fields ?? {}) as Record<string, unknown>;
  const str = (k: string) => (typeof src[k] === "string" ? (src[k] as string) : "");
  const fields: DraftFields = {
    trade: str("trade"), parish: str("parish"), desc: str("desc"),
    urgency: str("urgency"), accessType: str("accessType"),
    materialsBy: str("materialsBy"),
  };
  if (!worthKeeping(fields)) return null;
  return { v: 1, jobId: typeof d.jobId === "string" ? d.jobId : "", at, fields };
}

/** Only values the current lists still offer are restored. A trade removed
 *  from the taxonomy since the draft was written comes back blank and gets
 *  asked again, rather than being posted as a trade no worker can carry. */
export function restoreFields(
  d: StoredDraft,
  lists: { trades: readonly string[]; parishes: readonly string[] },
): DraftFields {
  const inList = (v: string, l: readonly string[]) => (l.includes(v) ? v : "");
  return {
    trade: inList(d.fields.trade, lists.trades),
    parish: inList(d.fields.parish, lists.parishes),
    desc: d.fields.desc,
    urgency: inList(d.fields.urgency, URGENCY.map((u) => u.value)),
    accessType: inList(d.fields.accessType, ACCESS.map((a) => a.value)),
    materialsBy: inList(d.fields.materialsBy, MATERIALS.map((m) => m.value)),
  };
}
