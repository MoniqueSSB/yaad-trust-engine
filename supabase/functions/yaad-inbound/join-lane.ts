// Joining as a tradesperson over WhatsApp: the five short questions.
//
// The join form at app.yaadly.co.uk/apply has carried a button since 17 Sep
// 2026 reading "Rather do this on WhatsApp? Five short questions in the chat",
// and the FAQ the assistant answers from says the same. Until 30 Sep 2026
// nothing on this side recognised the sentence that button sends, so the
// message fell through to the client intake and a tradesperson trying to
// join was asked which parish their property was in. Founder: "fix this so
// it aligns to what is stated on the site".
//
// What it does. Name, trades, parishes, email, one photo of finished work,
// one question a message. At the end it writes the same applications row the
// site's step 1 writes, files the photo the way the site files a portfolio
// upload, puts the number on the job alert list with the consent sentence
// said to them word for word, and sends the link that opens the same
// application on the site for the identity steps, which only happen there.
//
// What it does not do. It never sends an alert. It never asks for an ID, a
// selfie, a TRN or bank details: identity is Persona's, on the site (CLAUDE.md
// §6), and bank details are never typed into this chat. It decides nothing:
// a person at the desk reads the application, as for every applicant.
//
// Pure on purpose, so the wording and the order are tested without a webhook.

/** The sentence the site's button puts in the box, matched as a prefix
 *  because people type on the end of it. "JOIN" on its own is read the same
 *  way, for somebody who was told the word rather than handed the button. */
const OPENER = /^hello yaadly,?\s+i am a tradesperson and i want to join\b/i;
const JOIN_WORD = /^(join|join yaadly|i want to join)[.!]*$/i;

export function isJoinOpener(said: string): boolean {
  const t = (said ?? "").replace(/\s+/g, " ").trim();
  return OPENER.test(t) || JOIN_WORD.test(t);
}

export const JOIN_LANES = ["join_name", "join_alerts", "join_trades", "join_parishes", "join_email", "join_photo"] as const;
export type JoinLane = typeof JOIN_LANES[number];

export function isJoinLane(lane: unknown): lane is JoinLane {
  return (JOIN_LANES as readonly string[]).includes(String(lane ?? ""));
}

/** A session older than this is a different conversation. */
export const JOIN_STALE_MS = 24 * 3600_000;

export const SKIP = /^(skip|no|none|later|not now|nah)[.!]*$/i;

/** The questions, one thing a line. The count is said so nobody wonders how
 *  long this goes on for. Trades and parishes are asked through the tappable
 *  lists in index.ts and take only a lead sentence from here. */
export const Q_NAME =
  "Welcome to Yaadly. Good to have you.\n\nSix quick questions, then you are in.\n\n1 of 6: What is your full name?";

/** 2 of 7: the job alert consent, a question of its own. Founder, 30 Sep
 *  2026: "split this into two questions". YES puts the number on the alert
 *  list with alertTerms as the recorded consent; NO skips the list and the
 *  joining carries on. */
export function qAlerts(name: string, alertTerms: string): string {
  const first = firstName(name);
  return `Thanks${first ? `, ${first}` : ""}.\n\n2 of 6: ${alertTerms}\n\nReply YES or NO.`;
}
export const ALERTS_AGAIN = "Reply YES to hear about jobs here, or NO.";

export const LEAD_TRADES = "3 of 6:";
export const LEAD_PARISHES = "4 of 6:";

export const Q_EMAIL =
  "5 of 6: Your email address?\nYou use it to log in.\nNo email? Reply SKIP.";

export const Q_PHOTO =
  "6 of 6: Send one photo of a job you did.\nNo photo? Reply SKIP.";

export const NOT_A_NAME = "A name is needed to start.\n\n1 of 6: What is your full name?";
export const NOT_AN_EMAIL = "That does not look like an email.\n\n5 of 6: Your email address?\nNo email? Reply SKIP.";
export const PHOTO_PLEASE = "Send a photo here, not words.\n\n6 of 6: Send one photo of a job you did.\nNo photo? Reply SKIP.";
export const WORDS_FIRST = "One thing at a time. Answer this first. Then send the photo.";

/** What they are told at the end. Warm, five points, and only what is true
 *  today: quoting and booking wait for the check (v_job_alert_subscribers
 *  .can_quote), a person reads it, nothing is promised. The link opens the
 *  same application on the site for the identity steps. */
export function joinedReply(reference: string, link: string, photoFiled: boolean, _aiReads = true): string {
  // One phone screen, founder 30 Sep 2026: "this is one a phone", "the
  // messages can be over whelming". The reference, the one next step, and
  // what happens after. Everything else waits for the moment it matters.
  return [
    `You are in. Your reference is ${reference}.`,
    photoFiled ? "" : "No photo yet. You can add one on the link below.",
    ``,
    `Next: finish your check here. About ten minutes.`,
    link,
    ``,
    `An AI agent reads your form. A person decides. We message you here.`,
  ].filter((l) => l !== "").join("\n");
}

/** The AI read is automatic. Founder, 30 Sep 2026: "the ai will read",
 *  "remove the ask for review by human". The row is written granted with
 *  this version, so every row it applies to says so, and yaad-vetting-review
 *  (which still checks the column) runs on every application. This changed
 *  the 30 August rule; DECISIONS.md carries the date and the words. */
export const AI_CONSENT_WA_VERSION = "ai-review-auto-v1";
export const CONSENT_YES = /^(yes|y|yeah|yeh|ok|okay|allow|allowed|fine|sure)[.!]*$/i;
export const CONSENT_NO = /^(no|n|nah|nope|person|person only|a person only|decline)[.!]*$/i;

export function firstName(name: string): string {
  return (name ?? "").trim().split(/\s+/)[0] ?? "";
}

/** Two words or more, letters in it, nothing that reads as a command. */
export function looksLikeName(said: string): boolean {
  const t = (said ?? "").replace(/\s+/g, " ").trim();
  if (t.length < 3 || t.length > 80) return false;
  if (!/[a-z]/i.test(t)) return false;
  if (/^(skip|stop|alerts?|join|hi|hello|yes|no|ok)$/i.test(t)) return false;
  return true;
}

export function looksLikeEmail(said: string): boolean {
  const t = (said ?? "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(t) && t.length <= 120;
}

/** The application row the site's step 1 writes, from the answers held in
 *  the session. Trades and parishes are the words they gave, in their order,
 *  which is what the desk reads; matching uses the alert list's keys. */
export function applicationRow(a: { name?: unknown; trades?: unknown; parishes?: unknown; email?: unknown }, phone: string, reference: string) {
  const trades = Array.isArray(a.trades) ? a.trades.map(String) : [];
  const parishes = Array.isArray(a.parishes) ? a.parishes.map(String) : [];
  return {
    app_id: reference,
    name: String(a.name ?? "").trim().slice(0, 120),
    trade: trades.join(", ").slice(0, 200),
    trade_other: "",
    parish: parishes[0] ?? "",
    parishes: parishes.join(", ").slice(0, 400),
    phone,
    email: String(a.email ?? "").trim().toLowerCase().slice(0, 120),
    years: "",
    work: "",
    status: "received",
    submitted_at: new Date().toISOString(),
    // Granted on every row, founder instruction 30 Sep 2026 (see
    // AI_CONSENT_WA_VERSION). The showcase consent is not written here
    // because production has no such columns (read live 30 Sep 2026;
    // 20260905b is not applied there).
    ai_review_consent: "granted",
    ai_review_consent_at: new Date().toISOString(),
    ai_review_consent_version: AI_CONSENT_WA_VERSION,
  };
}

export function newReference(): string {
  return "APP-" + crypto.randomUUID().slice(0, 6).toUpperCase();
}

/** The link that opens this application on the site for the identity steps.
 *  The upload token is the same secret the site keeps in the browser's own
 *  storage for the same purpose; here it travels to the phone that started
 *  the application, over the channel it started on. */
export function continueLink(appBase: string, applicationId: string, uploadToken: string, reference: string): string {
  const u = new URL("/apply", appBase);
  u.searchParams.set("app", applicationId);
  u.searchParams.set("token", uploadToken);
  u.searchParams.set("ref", reference);
  return u.toString();
}
