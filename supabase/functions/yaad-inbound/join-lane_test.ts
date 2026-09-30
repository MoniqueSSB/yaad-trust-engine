// Proves the five joining questions: the opener the site's button sends is
// recognised, each question is short, the order holds, the application row
// matches what the site writes, and nothing here decides, alerts or asks for
// an ID. See join-lane.ts.

import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  applicationRow, continueLink, isJoinLane, isJoinOpener, JOIN_LANES, joinedReply, LEAD_PARISHES,
  looksLikeEmail, looksLikeName, newReference, NOT_A_NAME, NOT_AN_EMAIL, PHOTO_PLEASE, Q_EMAIL, Q_NAME, Q_PHOTO, SKIP, WORDS_FIRST,
  AI_CONSENT_WA_VERSION, ALERTS_AGAIN, CONSENT_NO, CONSENT_YES, LEAD_TRADES, qAlerts,
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
  assertEquals([...JOIN_LANES], ["join_name", "join_alerts", "join_trades", "join_parishes", "join_email", "join_photo"]);
  assert(isJoinLane("join_email") && !isJoinLane("alerts_trades") && !isJoinLane(""));
  for (const q of [Q_NAME, qAlerts("Marcus Brown", ALERT_TERMS), ALERTS_AGAIN, LEAD_TRADES, LEAD_PARISHES, Q_EMAIL, Q_PHOTO, NOT_A_NAME, NOT_AN_EMAIL, PHOTO_PLEASE, WORDS_FIRST]) {
    assert(!/[–—]/.test(q), `dash in: ${q}`);
    for (const line of q.split("\n")) assert(line.length <= 110, `long line: ${line}`);
  }
  assert(Q_NAME.includes("1 of 6") && qAlerts("A B", ALERT_TERMS).includes("2 of 6") && LEAD_TRADES.includes("3 of 6") && LEAD_PARISHES.includes("4 of 6") && Q_EMAIL.includes("5 of 6") && Q_PHOTO.includes("6 of 6"));
});

Deno.test("the AI read is automatic on every application, granted with its own version, and a person still decides", () => {
  const row = applicationRow({ name: "M B", trades: ["Plumbing"], parishes: ["Kingston"], email: "" }, "+1876", "APP-1");
  assertEquals(row.ai_review_consent, "granted");
  assertEquals(row.ai_review_consent_version, AI_CONSENT_WA_VERSION);
  assert(AI_CONSENT_WA_VERSION.includes("auto"), "the version must say the read was not asked for");
  const lane = src.slice(src.indexOf("joining as a tradesperson: the five questions"), src.indexOf("── the job alert list"));
  assert(!lane.includes("join_consent") && !lane.includes("Q_CONSENT"), "the question is gone");
  const read = lane.indexOf("functions/v1/yaad-vetting-review");
  assert(read > 0, "the read no longer starts from the chat");
  assert(!/approve|publish|active:\s*true/.test(lane.slice(read, read + 900)), "nothing after the read may publish or approve");
  assert(/A person decides/.test(joinedReply("APP-1", "x", true)), "a person still decides, and the worker is told so");
});

Deno.test("the consent sentence is said, word for word, before the number goes on the alert list", () => {
  assert(qAlerts("Marcus Brown", ALERT_TERMS).includes(ALERT_TERMS));
  const lane = src.slice(src.indexOf("joining as a tradesperson: the five questions"), src.indexOf("── the job alert list"));
  assert(lane.length > 0, "the join lane is gone or moved");
  const asked = lane.indexOf("qAlerts(name, ALERT_TERMS)");
  const subscribed = lane.indexOf('rpc("subscribe_to_job_alerts"');
  assert(asked > 0 && subscribed > asked, "the number is put on the list before the consent sentence is said");
  assert(/if \(yes\) \{\s*await supabase\.rpc\("subscribe_to_job_alerts"/.test(lane), "only a YES puts the number on the list");
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
  assertEquals(row.ai_review_consent, "granted");
  // Only columns the live table has (read 30 Sep 2026). A column it lacks
  // refuses the whole insert, and the worker is told "That did not save".
  const live = ["app_id","name","trade","trade_other","parish","parishes","phone","email","years","work","status","submitted_at","ai_review_consent","ai_review_consent_at","ai_review_consent_version"];
  for (const k of Object.keys(row)) assert(live.includes(k), `applications has no column ${k} in production`);
  assert(/^APP-[0-9A-F]{6}$/.test(newReference()));
});

Deno.test("the final reply is warm, five points, and promises nothing", () => {
  const link = continueLink("https://app.yaadly.co.uk", "11111111-2222-3333-4444-555555555555", "aaaa-bbbb", "APP-ABC123");
  assert(link.startsWith("https://app.yaadly.co.uk/apply?app=") && link.includes("token=aaaa-bbbb") && link.includes("ref=APP-ABC123"));
  const r = joinedReply("APP-ABC123", link, true);
  assert(r.includes("You are in") && r.includes("APP-ABC123") && r.includes(link));
  assert((r.match(/^\d\. /gm) ?? []).length === 5, "five points");
  assert(/How you get paid:/.test(r) && /bank transfer within 7 days/.test(r) && /Never cash/.test(r) && /when the money is sent/.test(r), "when they are paid and what happens then is said at joining");
  assert(/An AI agent reads your form/.test(r) && /A person decides/.test(r) && /either way/i.test(r), "the agent is named and a person still decides");
  assert(!/[–—]/.test(r));
  assert(!/guarantee|100%|escrow|approved|accepted|you will get work/i.test(r), r);
  assert(joinedReply("APP-1", link, false).includes("No photo yet"));
  assert(joinedReply("APP-1", link, true).includes("all six"));
});


Deno.test("a WhatsApp application reaches the desk the way a site one does", () => {
  const lane = src.slice(src.indexOf("joining as a tradesperson: the five questions"), src.indexOf("── the job alert list"));
  assert(lane.includes('from("worker_profiles").upsert('), "no hidden profile row, so the desk has nobody to publish");
  assert(/active:\s*false/.test(lane), "the profile must be created hidden");
  assert(lane.includes('onConflict: "application_id"'), "a second go must update, not duplicate");
  assert(lane.includes("pushToDesk(settingsReader, {"), "the desk is not told");
  const push = lane.slice(lane.indexOf("pushToDesk(settingsReader, {"), lane.indexOf("pushToDesk(settingsReader, {") + 600);
  assert(!/msg\.from|a\.email|a\.name/.test(push), "no contact details may travel in the push");
});

Deno.test("the YES or NO button carries the same words as the typed question, and its ids are the typed answers", async () => {
  const { JOIN_ALERTS_BODY, joinAlertsContent } = await import("../yaad-twilio-setup/content.ts");
  assert(JOIN_ALERTS_BODY.includes(ALERT_TERMS), "the alert button must say the consent sentence word for word");
  for (const c of [joinAlertsContent()]) {
    const ids = c.types["twilio/quick-reply"].actions.map((a) => a.id);
    assertEquals(ids, ["YES", "NO"]);
    assert(CONSENT_YES.test(ids[0]) && CONSENT_NO.test(ids[1]), "a tap must read exactly as the typed word");
    for (const a of c.types["twilio/quick-reply"].actions) assert(a.title.length <= 20, a.title);
  }
});
