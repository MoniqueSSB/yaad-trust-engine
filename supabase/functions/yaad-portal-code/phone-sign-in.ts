// The pure parts of signing in by WhatsApp, 25 Oct 2026 (founder: "make it
// so people can sign in through whatsapp or email", "workers and clients").
// Kept apart from Deno.serve so they can be tested without a database.

import { e164Digits } from "./e164.ts";

/** The one sentence the browser is told after asking for a code by phone.
 *  The same words whether the number is ours, is not, or matches more than
 *  one account, and the lookup runs after the answer has gone, so the box
 *  tells nobody which numbers are real. */
export const PHONE_SAME_ANSWER =
  "If that number is on a Yaadly account, your code is on its way on WhatsApp, and by email if we have one.";

/** The one sentence for a code that did not work, for every way it fails. */
export const PHONE_WRONG_CODE =
  "That code did not match, or it has expired. Ask for a fresh one and type it in.";

/** Tries per hour. Sending: three per number, six per caller. Checking a
 *  code: five per number, ten per caller, on top of Supabase's own limits. */
export const LIMITS = {
  send: { phone: 3, caller: 6 },
  verify: { phone: 5, caller: 10 },
} as const;

/** A number as typed, as the digits every sender uses, or null when it
 *  cannot be a full international number. */
export function phoneDigits(input: unknown): string | null {
  const d = e164Digits(String(input ?? ""));
  return d.length >= 10 && d.length <= 15 ? d : null;
}

/** A six digit code, or null. */
export function phoneCode(input: unknown): string | null {
  const c = String(input ?? "").replace(/\D/g, "");
  return c.length === 6 ? c : null;
}

export type Candidate = { email: string | null; phone: string | null; source: string | null };

/** The one sign in email this number belongs to, or null.
 *
 *  Candidates come back from the database by their last nine digits; this
 *  decides on the WHOLE number, normalised the same way on both sides, so a
 *  UK and a Jamaican number that share nine digits never match. A worker
 *  counts with a live profile (the database already filtered that); a
 *  client counts only if they already have an account, which is the job
 *  code gate left exactly where it was: a phone number never opens a new
 *  client account. More than one email behind one number is refused rather
 *  than guessed, because guessing is how somebody signs into the wrong
 *  person's jobs. */
export function pickEmail(
  digits: string,
  candidates: Candidate[],
  clientHasAccount: (email: string) => boolean,
): { email: string; source: "worker" | "client" } | null {
  const found = new Map<string, "worker" | "client">();
  for (const c of candidates) {
    const email = String(c.email ?? "").trim().toLowerCase();
    if (!email || e164Digits(String(c.phone ?? "")) !== digits) continue;
    if (c.source === "worker") found.set(email, "worker");
    else if (c.source === "client" && clientHasAccount(email) && !found.has(email)) found.set(email, "client");
  }
  if (found.size !== 1) return null;
  const [[email, source]] = [...found.entries()];
  return { email, source };
}

/** The words that carry the code, on WhatsApp and by email. */
export function phoneCodeLine(otp: string): string {
  return `Your Yaadly sign in code is ${otp}. Type it on the sign in page. It lasts about an hour and it is single use. If you did not ask for it, ignore this and nothing happens.`;
}
