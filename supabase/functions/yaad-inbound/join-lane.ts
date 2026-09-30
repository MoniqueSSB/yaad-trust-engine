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

export const JOIN_LANES = ["join_name", "join_trades", "join_parishes", "join_email", "join_photo", "join_consent"] as const;
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

export function leadTrades(name: string, alertTerms: string): string {
  const first = firstName(name);
  return `Thanks${first ? `, ${first}` : ""}. Jobs will come to you here. ${alertTerms} 2 of 6:`;
}

export const LEAD_PARISHES = "3 of 6:";

export const Q_EMAIL =
  "4 of 6: Your email address?\nIt is how you sign in to your portal.\nReply SKIP to add it later.";

export const Q_PHOTO =
  "5 of 6: Send one photo of a job you finished.\nReply SKIP if you have none to hand.";

export const NOT_A_NAME = "A name is needed to start.\n\n1 of 6: What is your full name?";
export const NOT_AN_EMAIL = "That does not look like an email address.\n\n4 of 6: Your email address?\nReply SKIP to add it later.";
export const PHOTO_PLEASE = "A photo is needed here, not words.\n\n5 of 6: Send one photo of a job you finished.\nReply SKIP if you have none to hand.";
export const WORDS_FIRST = "One thing at a time. Answer this first, then send the photo.";

/** What they are told at the end. Warm, five points, and only what is true
 *  today: quoting and booking wait for the check (v_job_alert_subscribers
 *  .can_quote), a person reads it, nothing is promised. The link opens the
 *  same application on the site for the identity steps. */
export function joinedReply(reference: string, link: string, photoFiled: boolean): string {
  return [
    `That is all six. You are in. Your reference is ${reference}.`,
    photoFiled ? "" : "No photo yet. You can add one on the link below.",
    "",
    "What happens next:",
    "1. A real person reads your application. Not a machine.",
    "2. Finish your check here: your ID, TRN, three referees, and sign the Guidelines.",
    link,
    "3. You hear back here, either way. No silence.",
    "4. Once cleared, jobs come to you here. Quote in writing. Always free.",
    "5. Win a quote and we walk you through how the job runs.",
    "",
    "Any questions, just ask here.",
  ].filter((l) => l !== "").join("\n");
}

/** The sixth question: whether software may read the paperwork first.
 *
 *  The same choice the site asks in AiConsent (JoinFlow.tsx), in fewer
 *  words, so it carries its own version: a consent is worth exactly what the
 *  sentence that earned it said, and this sentence is not that one.
 *  yaad-vetting-review reads the answer, never the version, so YES here
 *  switches the review on exactly as the site's tick does. The facts are the
 *  site's facts: NVIDIA's model, outside Yaadly, not used to train; the ID,
 *  selfie and face video never go to it; it never decides; no costs nothing.
 *  Until it is answered the row says declined, which is the safe reading of
 *  an answer never given. */
export const AI_CONSENT_WA_VERSION = "ai-review-wa-v1";
export const Q_CONSENT =
  "6 of 6: One choice. Either answer is fine.\n\n" +
  "Software can read your paperwork first: proof of address, TRN, certificates, CV, work photos.\n" +
  "It writes notes for the person deciding. It never decides.\n" +
  "It runs on NVIDIA's model, outside Yaadly, and is not used to train anything.\n" +
  "Your ID, selfie and face video are never sent to it.\n\n" +
  "Reply YES to allow it.\nReply NO for a person only.";
export const CONSENT_YES = /^(yes|y|yeah|yeh|ok|okay|allow|allowed|fine|sure)[.!]*$/i;
export const CONSENT_NO = /^(no|n|nah|nope|person|person only|a person only|decline)[.!]*$/i;
export const CONSENT_AGAIN = "Reply YES to let software read your paperwork first, or NO for a person only.";

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
    // Neither consent was asked for in the chat, and the safe reading of an
    // answer never given is no (JoinFlow.tsx, the same rule). They can be
    // granted on the site when the application is opened there.
    ai_review_consent: "declined",
    ai_review_consent_at: new Date().toISOString(),
    ai_review_consent_version: "not-asked-whatsapp",
    showcase_consent: "declined",
    showcase_consent_at: new Date().toISOString(),
    showcase_consent_version: "not-asked-whatsapp",
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
