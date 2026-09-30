// Proves the five joining questions: the opener the site's button sends is
// recognised, each question is short, the order holds, the application row
// matches what the site writes, and nothing here decides, alerts or asks for
// an ID. See join-lane.ts.

import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  applicationRow, continueLink, isJoinLane, isJoinOpener, JOIN_LANES, joinedReply, LEAD_PARISHES, leadTrades,
  looksLikeEmail, looksLikeName, newReference, NOT_A_NAME, NOT_AN_EMAIL, PHOTO_PLEASE, Q_EMAIL, Q_NAME, Q_PHOTO, SKIP, WORDS_FIRST,
  AI_CONSENT_WA_VERSION, CONSENT_AGAIN, CONSENT_NO, CONSENT_YES, Q_CONSENT,
} from "./join-lane.ts";
import { ALERT_TERMS, ALERTS_OPENER } from "./job-alerts.ts";

const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
const joinFlow = await Deno.readTextFile(new URL("../../../web/app/apply/JoinFlow.tsx", import.meta.url));

Deno.test("the sentence the site's button sends is read as joining", () => {
  // Held against the site, because a button whose sentence the lane does not
  // recognise sends a tradesperson into client intake with no error anywhere.
  const m = /encodeURIComponent\("([^"]+)"\)/.exec(joinFlow.slice(joinFlow.indexOf("const WA_JOIN")));
  assert(m, "the site's WA_JOIN opener was not found");
  assert(isJoinOpener(m![1]), `the site sends "${m![1]}" and the lane does not read it`);
  assert(isJoinOpener(m![1] + " Marcus Brown"), "typing on the end of the opener must still join");
  assert(isJoinOpener("JOIN"));
  assert(isJoinOpener("I want to join"));
});

Deno.test("a client, an alert sign-up and a job description are never read as joining", () => {
  for (const said of [ALERTS_OPENER, "ALERTS", "I need a plumber to join two pipes", "hello", "my roof is leaking in Portmore", "join the pipes please"]) {
    assert(!isJoinOpener(said), said);
  }
});

Deno.test("six questions, in order, each short", () => {
  assertEquals(JOIN_LANES.length, 6);
  assertEquals([...JOIN_LANES], ["join_name", "join_trades", "join_parishes", "join_email", "join_photo", "join_consent"]);
  assert(isJoinLane("join_email") && !isJoinLane("alerts_trades") && !isJoinLane(""));
  for (const q of [Q_NAME, LEAD_PARISHES, Q_EMAIL, Q_PHOTO, Q_CONSENT, CONSENT_AGAIN, NOT_A_NAME, NOT_AN_EMAIL, PHOTO_PLEASE, WORDS_FIRST]) {
    assert(!/[–—]/.test(q), `dash in: ${q}`);
    for (const line of q.split("\n")) assert(line.length <= 110, `long line: ${line}`);
  }
  // The trades lead is one line by design: it is a template variable, and it
  // carries the consent sentence, which is not to be shortened.
  const lead = leadTrades("Marcus Brown", ALERT_TERMS);
  assert(!/[–—\n]/.test(lead) && lead.length < 900, lead);
  assert(Q_NAME.includes("1 of 6") && lead.includes("2 of 6") && LEAD_PARISHES.includes("3 of 6") && Q_EMAIL.includes("4 of 6") && Q_PHOTO.includes("5 of 6") && Q_CONSENT.includes("6 of 6"));
});

Deno.test("the consent question says what the site says, carries its own version, and a no is a no", () => {
  for (const fact of ["never decides", "NVIDIA", "outside Yaadly", "not used to train", "ID, selfie and face video are never sent"]) {
    assert(Q_CONSENT.includes(fact), `the consent question no longer says: ${fact}`);
  }
  assert(Q_CONSENT.includes("Either answer is fine"), "saying no must be said to cost nothing");
  // The site's own version, read off the site, so the two can never be the same string.
  const siteVersion = /const AI_CONSENT_VERSION = "([^"]+)"/.exec(joinFlow)?.[1] ?? "";
  assert(siteVersion && String(AI_CONSENT_WA_VERSION) !== siteVersion && AI_CONSENT_WA_VERSION.startsWith("ai-review-wa-"), "a different sentence needs its own version");
  for (const y of ["yes", "YES", "ok", "allow"]) assert(CONSENT_YES.test(y) && !CONSENT_NO.test(y), y);
  for (const n of ["no", "NO", "person only", "nah"]) assert(CONSENT_NO.test(n) && !CONSENT_YES.test(n), n);
  for (const neither of ["", "maybe", "what does that mean", "1"]) assert(!CONSENT_YES.test(neither) && !CONSENT_NO.test(neither), neither);
  const lane = src.slice(src.indexOf("joining as a tradesperson: the five questions"), src.indexOf("── the job alert list"));
  assert(lane.includes('ai_review_consent: yes ? "granted" : "declined"'), "the answer is not what is recorded");
  assert(lane.includes("ai_review_consent_version: AI_CONSENT_WA_VERSION"), "the consent is recorded without its version");
  assert(!/ai_review_consent:\s*"granted"/.test(lane), "nothing may default the consent to granted");
});

Deno.test("the consent sentence is said, word for word, before the number goes on the alert list", () => {
  assert(leadTrades("Marcus Brown", ALERT_TERMS).includes(ALERT_TERMS));
  const lane = src.slice(src.indexOf("joining as a tradesperson: the five questions"), src.indexOf("── the job alert list"));
  assert(lane.length > 0, "the join lane is gone or moved");
  const asked = lane.indexOf("leadTrades(name, ALERT_TERMS)");
  const subscribed = lane.indexOf('rpc("subscribe_to_job_alerts"');
  assert(asked > 0 && subscribed > asked, "the number is put on the list before the consent sentence is said");
  assert(lane.includes("p_version: ALERT_CONSENT_VERSION"), "the consent is recorded without its version");
});

Deno.test("nothing in the lane sends an alert, checks an identity or asks for bank details", () => {
  const lane = src.slice(src.indexOf("joining as a tradesperson: the five questions"), src.indexOf("── the job alert list"));
  assert(!/invoke\(\s*["'`]yaad-match/.test(lane) && !/match_workers_for_job/.test(lane), "the join lane must not run the matcher");
  assert(!/sendWhatsAppTo\(|api\.twilio\.com/.test(lane), "the join lane replies, it does not send to anybody else");
  assert(!/photo_id|selfie|face_video|persona/i.test(lane), "identity is Persona's, on the site");
  assert(!/bank|account number|sort code/i.test(lane), "bank details are never asked for in the chat");
  for (const q of [Q_NAME, Q_EMAIL, Q_PHOTO]) assert(!/id card|passport|bank|trn/i.test(q), q);
});

Deno.test("the lane sits ahead of the alert list, and a held desk number is held for it", () => {
  const join = src.indexOf("joining as a tradesperson: the five questions");
  const alerts = src.indexOf("── the job alert list");
  assert(join > 0 && alerts > join, "the join lane must come before the alert list");
  assert(src.slice(join, alerts).includes("!deskHasThisNumber &&"), "a number the desk is holding must not be walked through the questions");
});

Deno.test("a name is a name and an email is an email", () => {
  for (const ok of ["Marcus Brown", "Ann-Marie Clarke", "O'Neil"]) assert(looksLikeName(ok), ok);
  for (const no of ["", "M", "skip", "ALERTS", "1234", "hello"]) assert(!looksLikeName(no), no);
  assert(looksLikeEmail("marcus@example.com") && !looksLikeEmail("marcus at gmail") && !looksLikeEmail("skip"));
  for (const s of ["skip", "SKIP", "no", "later", "none"]) assert(SKIP.test(s), s);
  assert(!SKIP.test("marcus@example.com"));
});

Deno.test("the application row is the one the site's step 1 writes, with both consents off", () => {
  const row = applicationRow({ name: "  Marcus  Brown ", trades: ["Plumbing", "Tiling"], parishes: ["St Catherine"], email: "Marcus@Example.com" }, "+18761234567", "APP-ABC123");
  assertEquals(row.name, "Marcus  Brown".replace("  ", "  ").trim());
  assertEquals(row.trade, "Plumbing, Tiling");
  assertEquals(row.parish, "St Catherine");
  assertEquals(row.parishes, "St Catherine");
  assertEquals(row.email, "marcus@example.com");
  assertEquals(row.phone, "+18761234567");
  assertEquals(row.status, "received");
  assertEquals(row.app_id, "APP-ABC123");
  // Neither consent was asked, so neither is granted. The safe reading of an
  // answer never given, the same as JoinFlow.tsx.
  assertEquals(row.ai_review_consent, "declined");
  assertEquals(row.showcase_consent, "declined");
  assert(/^APP-[0-9A-F]{6}$/.test(newReference()));
});

Deno.test("the final reply is warm, five points, and promises nothing", () => {
  const link = continueLink("https://app.yaadly.co.uk", "11111111-2222-3333-4444-555555555555", "aaaa-bbbb", "APP-ABC123");
  assert(link.startsWith("https://app.yaadly.co.uk/apply?app=") && link.includes("token=aaaa-bbbb") && link.includes("ref=APP-ABC123"));
  const r = joinedReply("APP-ABC123", link, true);
  assert(r.includes("You are in") && r.includes("APP-ABC123") && r.includes(link));
  assert((r.match(/^\d\. /gm) ?? []).length === 5, "five points");
  assert(/real person/i.test(r) && /either way/i.test(r), "warm, and honest about who decides");
  assert(!/[–—]/.test(r));
  assert(!/guarantee|100%|escrow|approved|accepted|you will get work/i.test(r), r);
  assert(joinedReply("APP-1", link, false).includes("No photo yet"));
});
