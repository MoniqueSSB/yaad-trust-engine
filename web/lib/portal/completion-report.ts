/**
 * The rules behind the Completion Report's summary, held in one place.
 *
 * The report opens with a one line outcome, the way a JCT certificate, a RICS
 * survey or a snagging report does (founder decision, 28 Sep 2026). That line
 * is built here, by rules, from the job's own record. It is never written by a
 * model, so it cannot say more than the record does: it counts what happened
 * and says so, including the parts a contractor would rather leave out, a new
 * find nobody has dealt with or an arrival logged away from the site.
 *
 * No money anywhere, by decision. The report is forwarded to family and to
 * buyers.
 */

const TZ = "America/Jamaica";

/** "15 Sep 2026", on the Jamaica day, which is the day the work happened. */
export function fmtDay(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  // Built from parts: en-GB's short month is "Sept" in newer runtimes and
  // "Sep" in older ones, and a report should not change with the server.
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "numeric", day: "numeric" }).formatToParts(d);
  const get = (t: string) => Number(p.find((x) => x.type === t)?.value);
  return get("day") + " " + MONTHS[get("month") - 1] + " " + get("year");
}
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "15 Sep 2026, 08:12", Jamaica time. */
export function fmtWhen(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  return fmtDay(iso) + ", " + time;
}

/**
 * The day aftercare ends: twelve months from completion, on the same Jamaica
 * calendar day. 29 February rolls to 28 February, never into March, so the
 * promise is never read as longer than it is.
 */
export function aftercareEnds(completedIso: string | null | undefined): string | null {
  if (!completedIso) return null;
  const d = new Date(completedIso);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(d);
  const y = Number(parts.find((p) => p.type === "year")?.value);
  const m = Number(parts.find((p) => p.type === "month")?.value);
  let day = Number(parts.find((p) => p.type === "day")?.value);
  const last = new Date(Date.UTC(y + 1, m, 0)).getUTCDate();
  if (day > last) day = last;
  return `${y + 1}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
function count(n: number, one: string, many: string): string {
  return (WORDS[n] ?? String(n)) + " " + (n === 1 ? one : many);
}

export type OutcomeFacts = {
  stagesApproved: number;
  /** "in_person" or anything else, which reads as from the evidence. */
  methods: (string | null)[];
  problems: number;
  newFinds: number;
  farArrivals: number;
  disputes: number;
};

/**
 * The one line under "Outcome". Written in the third person ("the owner"),
 * because the printed copy is forwarded and "you" would then be wrong.
 */
export function outcomeLine(f: OutcomeFacts): string {
  const out: string[] = ["Complete."];
  if (f.stagesApproved > 0) {
    const inPerson = f.methods.filter((m) => m === "in_person").length;
    const how = inPerson === 0 ? ", on the evidence" : inPerson === f.methods.length ? ", in person" : "";
    out.push(
      (f.stagesApproved === 1 ? "The one stage" : (f.stagesApproved === 2 ? "Both stages" : "All " + f.stagesApproved + " stages")) +
        " approved by the owner" + how + ".",
    );
  }
  if (f.problems > 0) out.push(count(f.problems, "problem", "problems") + " found on site and recorded.");
  if (f.newFinds > 0) {
    out.push(count(f.newFinds, "new find", "new finds") + " recorded outside the job, not part of this work.");
  }
  if (f.farArrivals > 0) out.push(count(f.farArrivals, "arrival", "arrivals") + " logged away from the site.");
  out.push(f.disputes === 0 ? "No disputes raised." : count(f.disputes, "dispute", "disputes") + " raised.");
  return out.join(" ");
}

/** "3 before, 2 during, 1 problem", in the order of the work. */
export function phaseCounts(items: { phase?: string | null; kind?: string | null }[]): string {
  const order: [string, string, string][] = [
    ["before", "before", "before"],
    ["during", "during", "during"],
    ["issue", "problem", "problems"],
    ["new", "new find", "new finds"],
    ["after", "after", "after"],
  ];
  const bits: string[] = [];
  for (const [k, one, many] of order) {
    const n = items.filter((e) => e.kind !== "materials" && e.phase === k).length;
    if (n) bits.push(n + " " + (n === 1 ? one : many));
  }
  const mat = items.filter((e) => e.kind === "materials").length;
  if (mat) bits.push(mat + " materials " + (mat === 1 ? "receipt" : "receipts"));
  const rest = items.filter((e) => e.kind !== "materials" && !e.phase).length;
  if (rest) bits.push(rest + " not marked");
  return bits.join(", ");
}

/** Care notes typed one per line back into a list, blanks dropped. */
export function notesFromText(text: string): string[] {
  return String(text ?? "")
    .split(/\r?\n/)
    .map((s) => s.replace(/^\s*[-*•]\s*/, "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

export type TrailEvent = {
  step: string;
  actor_name: string | null;
  actor_email: string | null;
  at: string;
  detail: Record<string, unknown> | null;
};

/** The words for one line of the review trail. */
export function trailLabel(e: TrailEvent): string {
  switch (e.step) {
    case "drafted": return "Care notes drafted (a draft only)";
    case "edited": return (e.detail && e.detail.reopened_from) ? "Edited on the desk, reopened for signing" : "Edited on the desk";
    case "accepted": return "Checked, accepted and sent to the worker";
    case "sent_to_worker": return "Opened for the worker to read and sign";
    case "held": return "Held before reaching the owner by the automatic screen";
    case "released": return e.actor_name === "Automatic screen" ? "Passed the automatic screen, sent to the owner" : "Released unchanged and sent to the owner";
    case "returned": return "Sent back to the worker" + (e.detail && e.detail.reason ? ": \u201c" + String(e.detail.reason) + "\u201d" : "");
    case "signed": return e.detail && e.detail.changed ? "Reviewed and signed by the worker, with changes" : "Reviewed and signed by the worker, no changes";
    case "issued": return e.detail && e.detail.worker_changed ? "Worker's changes read and accepted, report issued" : "Report issued";
    case "client_confirmed": return "Confirmed by the owner";
    case "client_flagged": return "Owner raised a dispute";
    case "worker_edited": return "The worker changed their words";
    case "worker_raised": return "The worker raised an issue";
    default: return e.step;
  }
}

/**
 * Who, as printed. A draft is the agent's, never a person's. Anything done
 * from the desk prints as Yaadly, never a staff member's name (founder, 28 Sep
 * 2026: "it should never be my name"); the name is kept in the database as
 * the internal record only. The worker's and the owner's own steps carry
 * their own names, because those are theirs.
 */
export function trailWho(e: TrailEvent): string {
  if (e.step === "drafted") return "Drafting agent";
  if (e.step === "held" || (e.step === "released" && e.actor_name === "Automatic screen")) return "Automatic screen";
  if (["accepted", "edited", "released", "returned", "issued", "sent_to_worker"].includes(e.step)) return "Yaadly";
  return e.actor_name || "";
}
