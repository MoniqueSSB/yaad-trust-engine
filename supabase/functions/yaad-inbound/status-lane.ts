// "Where is my application?" over WhatsApp. 25 October 2026.
//
// A tradesperson who applied, on the site or through the six questions, has
// one way to find out what happened to it: wait to be told. Until this lane
// the word STATUS, their reference, or a plain "did you get my application"
// fell through to the client intake and was answered as if they had a leaking
// roof. Three real people sat at status started for weeks that month with
// nobody saying so (migration 20261025150000), and a worker asking after their
// application is the cheapest signal there is that somebody is waiting.
//
// What it does. Reads one row in public.applications, by reference if one was
// sent, otherwise by the sending number, and answers with ONE fixed sentence
// set per status. Every reply says what happens next. Nothing in a reply is
// written by a model: the strings below are the whole vocabulary.
//
// What it never does. It never names the document a gap is waiting on (that is
// the desk's message to send, with the detail in front of a person). It never
// says why an application was blocked. It never decides anything: a blocked
// applicant and a number that cannot be matched twice are handed to a person,
// the way other lanes hand over, and the row is not touched. It is read only.
//
// Pure on purpose, so the wording and the matching are tested without a
// database. index.ts does the reads and the escalation.

import { continueLink } from "./join-lane.ts";
import { samePhone } from "./phone.ts";

/** The reference the join lane and the site both mint: APP- and six characters.
 *  Read anywhere in the message, case insensitive, because people paste it
 *  into a sentence ("my ref is app-4c9f2a") as often as they send it alone. */
const REFERENCE = /\bAPP-([A-Z0-9]{6})\b/i;

/** The bare word, with or without punctuation. */
const STATUS_WORD = /^(?:status|application status|my application|my application status)[.!?]*$/i;

/** A plain question about an application. Anchored on the word application
 *  (or "applied to", "applied last week", "applied" ending the sentence) AND
 *  on an asking word, so a worker's update ("applied two coats of primer") and
 *  a client's job description cannot land here. Patois asking words are in:
 *  "wha happen to mi application", "weh mi application deh", "unnu get mi
 *  application". */
const APPLICATION = /\bapplication\b|\bapplied\s+(?:to|with|for|last|on|in|through|via|yesterday|already|weeks?|days?|ago)\b|\bapplied[.!?]*$/i;
const ASKING =
  /\b(?:what|wha|whats|what's|where|weh|wey|when|wen|did|do|does|have|has|any|update|status|news|happen(?:ed|ing)?|heard?|hear back|progress|got|get|receive[d]?|check(?:ed|ing)?|how far|how long|still|yet|waiting|look(?:ed|ing)? at|seen|see|sent|send|unnu|yuh|you)\b/i;

export function parseReference(text: string): string | null {
  const m = REFERENCE.exec(String(text ?? ""));
  return m ? `APP-${m[1].toUpperCase()}` : null;
}

/** Is this somebody asking where their application is? A reference on its own
 *  counts. "done", "1", "A", a job update and a job description do not. */
export function isStatusAsk(text: string): boolean {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!t) return false;
  if (parseReference(t)) return true;
  if (STATUS_WORD.test(t)) return true;
  if (t.length > 240) return false;
  return APPLICATION.test(t) && ASKING.test(t);
}

/** The statuses applications.status carries today. "test" is treated as not
 *  found, because a test row is nobody's application. */
export type ApplicationStatus = "started" | "received" | "gap" | "passed" | "blocked" | "test";

export type ApplicationRow = {
  id: string;
  app_id: string;
  name: string | null;
  phone: string | null;
  status: string;
  created_at: string | null;
  submitted_at: string | null;
  upload_token: string | null;
};

export type ProfileRow = { active: boolean | null } | null;

export type StatusOutcome =
  | "started" | "received" | "gap" | "passed" | "published" | "blocked" | "not_found";

export type StatusReply = {
  text: string;
  outcome: StatusOutcome;
  /** True when a person has to be told: a blocked applicant, or a number
   *  that could not be matched twice. index.ts does the telling. */
  escalate: boolean;
};

/** A date the way it is said in Jamaica and in London: 25 October 2026.
 *  Jamaica's clock, because that is where the worker is reading it. */
export function sayDate(iso: string | null | undefined): string {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return "a date I could not read";
  try {
    return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "America/Jamaica" }).format(d);
  } catch (_) {
    const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
    return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  }
}

export function firstNameOf(name: string | null | undefined): string {
  return String(name ?? "").trim().split(/\s+/)[0] ?? "";
}

/** The fixed strings. Kept here, in one place, so a test reads them all. */
export const NOT_FOUND_FIRST =
  "I could not find an application on this number. Reply with your reference, it starts APP-, and I will check.";
export const NOT_FOUND_AGAIN =
  "I still cannot find it. A person at Yaadly will pick this up.";
export const BLOCKED =
  "Thank you for applying. A person at Yaadly will be in touch with you directly.";

export function notFoundWithReference(ref: string): string {
  return `I could not find an application ${ref} on this number. Check the reference and reply with it again, and I will look once more.`;
}

/** The reply for one application row.
 *
 *  opts.appBase builds the finish link for a started application. opts.misses
 *  is how many times in a row this number has already been told "not found";
 *  the second miss hands over to a person. opts.senderMatchesRow is whether
 *  the sending number is the one on the row: a started application's link
 *  carries the upload token, and RUNBOOK §77 says the link only ever goes to
 *  the contact given when they applied, so a reference sent from a different
 *  number finds nothing. */
export function statusReply(
  row: ApplicationRow | null,
  profile: ProfileRow,
  opts: { appBase: string; misses?: number; referenceGiven?: string | null; senderMatchesRow?: boolean },
): StatusReply {
  const misses = Number(opts.misses ?? 0);
  const found = row && row.status !== "test" && opts.senderMatchesRow !== false;

  if (!found) {
    if (misses >= 1) return { text: NOT_FOUND_AGAIN, outcome: "not_found", escalate: true };
    const text = opts.referenceGiven ? notFoundWithReference(opts.referenceGiven) : NOT_FOUND_FIRST;
    return { text, outcome: "not_found", escalate: false };
  }

  const ref = String(row.app_id ?? "").toUpperCase();
  const first = firstNameOf(row.name);
  const published = profile?.active === true;

  switch (row.status) {
    case "started": {
      const link = continueLink(opts.appBase, String(row.id), String(row.upload_token ?? ""), ref);
      return {
        outcome: "started", escalate: false,
        text: `You opened an application with Yaadly on ${sayDate(row.created_at)} but it was never sent, so nobody has seen it yet. Here is your link to finish it: ${link}. Reply here if the link does not work.`,
      };
    }
    case "received":
      return {
        outcome: "received", escalate: false,
        text: `Yaadly has your application ${ref}, sent on ${sayDate(row.submitted_at ?? row.created_at)}. A person checks every one by hand and it is in the queue. You will hear from us on this number, so nothing is needed from you right now.`,
      };
    case "gap":
      return {
        outcome: "gap", escalate: false,
        text: `Yaadly is waiting on one thing from you before your application ${ref} can go further. Monique has your details and will message you on this number to say what it is.`,
      };
    case "passed":
      if (published) {
        return {
          outcome: "published", escalate: false,
          text: `You are a Yaadly worker${first ? `, ${first}` : ""}. Job alerts come to this number. Reply with any question and a person will pick it up.`,
        };
      }
      return {
        outcome: "passed", escalate: false,
        text: `You are through${first ? `, ${first}` : ""}. Your Yaadly profile is being set up and you will be told on this number when you can quote.`,
      };
    case "blocked":
      return { outcome: "blocked", escalate: true, text: BLOCKED };
    default:
      // A status this file has never heard of (a future one, or a legacy
      // "approved" or "declined" from before 16 Sep 2026) is not guessed at.
      return { outcome: "not_found", escalate: true, text: NOT_FOUND_AGAIN };
  }
}

/** The newest live application on this number. Test rows are skipped, and a
 *  row with no phone cannot be matched by phone. */
export function pickByPhone(rows: ApplicationRow[], from: string): ApplicationRow | null {
  const mine = rows.filter((r) => r.status !== "test" && r.phone && samePhone(r.phone, from));
  mine.sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
  return mine[0] ?? null;
}

/** Does the row belong to the number asking? A row with no phone on it is
 *  allowed through (nothing to compare against); a row with a different
 *  phone is not. */
export function senderMatches(row: ApplicationRow | null, from: string): boolean {
  if (!row) return false;
  if (!row.phone) return true;
  return samePhone(row.phone, from);
}

/** The session key the lane keeps its miss count under. Only ever written
 *  when no other lane holds the session, and deleted on any find. */
export const STATUS_MISS_LANE = "status_miss";
