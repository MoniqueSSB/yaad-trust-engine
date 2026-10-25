// Proves the "where is my application" lane: what is read as the question,
// what never is, the one fixed sentence set per status, that every reply says
// what happens next, and that a blocked applicant or a second miss goes to a
// person. See status-lane.ts.
//
// Run: deno test --allow-read --allow-env supabase/functions/

import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  type ApplicationRow, BLOCKED, isStatusAsk, NOT_FOUND_AGAIN, NOT_FOUND_FIRST, notFoundWithReference,
  parseReference, pickByPhone, sayDate, senderMatches, STATUS_MISS_LANE, statusReply,
} from "./status-lane.ts";
import { ALERTS_OPENER } from "./job-alerts.ts";
import * as guardrails from "./guardrails.ts";

const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
const APP = "https://app.yaadly.co.uk";

function row(over: Partial<ApplicationRow> = {}): ApplicationRow {
  return {
    id: "11111111-2222-3333-4444-555555555555", app_id: "APP-4C9F2A", name: "Marcus Brown", phone: "+18765551234",
    status: "received", created_at: "2026-10-01T15:00:00Z", submitted_at: "2026-10-03T22:30:00Z", upload_token: "aaaa-bbbb",
    ...over,
  };
}

Deno.test("STATUS, a reference and a plain question are read as asking after an application", () => {
  for (const said of [
    "STATUS", "status", "Status.", "APP-4C9F2A", "app-4c9f2a", "my ref is APP-4C9F2A thanks",
    "what happen to my application", "did you get my application", "any update on my application",
    "wha happen to mi application", "weh mi application deh", "unnu get mi application?",
    "I applied last week and heard nothing", "is my application still being looked at",
  ]) assert(isStatusAsk(said), `should be read as a status ask: ${said}`);
});

Deno.test("done, 1, A, a job update, a job description, JOIN and ALERTS are never a status ask", () => {
  for (const said of [
    "done", "1", "A", "", "   ",
    "Finished the first coat on the back wall, applied two coats of primer, still drying",
    "My roof is leaking in Portmore and I need somebody to check it this week",
    "JOIN", "I want to join", ALERTS_OPENER, "ALERTS",
    "the appliance in the kitchen is not working", "stop", "yes", "skip",
    "I applied the sealant, you can see it in the photos",
  ]) assert(!isStatusAsk(said), `must not be read as a status ask: "${said}"`);
});

Deno.test("a reference is APP- and six characters, read anywhere, in any case, and never from a word", () => {
  assertEquals(parseReference("APP-4C9F2A"), "APP-4C9F2A");
  assertEquals(parseReference("app-4c9f2a"), "APP-4C9F2A");
  assertEquals(parseReference("hi, APP-4C9F2A please"), "APP-4C9F2A");
  assertEquals(parseReference("APP-4C9F"), null);
  assertEquals(parseReference("APP-4C9F2A7"), null);
  assertEquals(parseReference("appliance"), null);
  assertEquals(parseReference("application"), null);
  assertEquals(parseReference("APP 4C9F2A"), null);
});

Deno.test("one fixed sentence set per status, exactly as agreed", () => {
  const started = statusReply(row({ status: "started" }), null, { appBase: APP, senderMatchesRow: true });
  assertEquals(started.outcome, "started");
  assertEquals(started.text,
    "You opened an application with Yaadly on 1 October 2026 but it was never sent, so nobody has seen it yet. Here is your link to finish it: https://app.yaadly.co.uk/apply?app=11111111-2222-3333-4444-555555555555&token=aaaa-bbbb&ref=APP-4C9F2A. Reply here if the link does not work.");

  const received = statusReply(row(), null, { appBase: APP, senderMatchesRow: true });
  assertEquals(received.outcome, "received");
  assertEquals(received.text,
    "Yaadly has your application APP-4C9F2A, sent on 3 October 2026. A person checks every one by hand and it is in the queue. You will hear from us on this number, so nothing is needed from you right now.");

  const gap = statusReply(row({ status: "gap" }), null, { appBase: APP, senderMatchesRow: true });
  assertEquals(gap.outcome, "gap");
  assertEquals(gap.text,
    "Yaadly is waiting on one thing from you before your application APP-4C9F2A can go further. Monique has your details and will message you on this number to say what it is.");

  const passed = statusReply(row({ status: "passed" }), { active: false }, { appBase: APP, senderMatchesRow: true });
  assertEquals(passed.outcome, "passed");
  assertEquals(passed.text, "You are through, Marcus. Your Yaadly profile is being set up and you will be told on this number when you can quote.");

  const published = statusReply(row({ status: "passed" }), { active: true }, { appBase: APP, senderMatchesRow: true });
  assertEquals(published.outcome, "published");
  assertEquals(published.text, "You are a Yaadly worker, Marcus. Job alerts come to this number. Reply with any question and a person will pick it up.");

  const blocked = statusReply(row({ status: "blocked" }), null, { appBase: APP, senderMatchesRow: true });
  assertEquals(blocked.outcome, "blocked");
  assertEquals(blocked.text, "Thank you for applying. A person at Yaadly will be in touch with you directly.");
  assertEquals(BLOCKED, blocked.text);

  // No profile row at all reads as not published.
  assertEquals(statusReply(row({ status: "passed" }), null, { appBase: APP, senderMatchesRow: true }).outcome, "passed");
});

Deno.test("not found: first miss asks for the reference, second miss goes to a person, a test row is nobody's", () => {
  const first = statusReply(null, null, { appBase: APP, misses: 0 });
  assertEquals(first.text, NOT_FOUND_FIRST);
  assertEquals(first.text, "I could not find an application on this number. Reply with your reference, it starts APP-, and I will check.");
  assert(!first.escalate);

  const again = statusReply(null, null, { appBase: APP, misses: 1 });
  assertEquals(again.text, NOT_FOUND_AGAIN);
  assertEquals(again.text, "I still cannot find it. A person at Yaadly will pick this up.");
  assert(again.escalate);

  const withRef = statusReply(null, null, { appBase: APP, misses: 0, referenceGiven: "APP-ZZZZZZ" });
  assertEquals(withRef.text, notFoundWithReference("APP-ZZZZZZ"));
  assert(withRef.text.includes("APP-ZZZZZZ") && !withRef.escalate);

  const test = statusReply(row({ status: "test" }), null, { appBase: APP, misses: 0, senderMatchesRow: true });
  assertEquals(test.outcome, "not_found");
  assertEquals(test.text, NOT_FOUND_FIRST);

  // A status this file has never heard of is not guessed at: a person.
  const odd = statusReply(row({ status: "approved" }), null, { appBase: APP, senderMatchesRow: true });
  assert(odd.escalate && odd.text === NOT_FOUND_AGAIN);
});

Deno.test("a reference sent from a number that is not on the row finds nothing, so the finish link never travels to a stranger", () => {
  const r = row({ status: "started" });
  assert(senderMatches(r, "+18765551234") && senderMatches(r, "whatsapp:+18765551234") && senderMatches(r, "8765551234"));
  assert(!senderMatches(r, "+447700900123"));
  assert(senderMatches(row({ phone: null }), "+447700900123"), "a row with no phone has nothing to compare against");
  assert(!senderMatches(null, "+18765551234"));
  const reply = statusReply(r, null, { appBase: APP, misses: 0, referenceGiven: "APP-4C9F2A", senderMatchesRow: false });
  assertEquals(reply.outcome, "not_found");
  assert(!reply.text.includes("token="), "the upload token must not go to a number that is not on the row");
});

Deno.test("by phone: the newest live application on this number, test rows and other numbers skipped", () => {
  const rows = [
    row({ id: "a", app_id: "APP-AAAAAA", created_at: "2026-09-01T00:00:00Z" }),
    row({ id: "b", app_id: "APP-BBBBBB", created_at: "2026-10-01T00:00:00Z" }),
    row({ id: "c", app_id: "APP-CCCCCC", created_at: "2026-10-20T00:00:00Z", status: "test" }),
    row({ id: "d", app_id: "APP-DDDDDD", created_at: "2026-10-21T00:00:00Z", phone: "+447700900123" }),
    row({ id: "e", app_id: "APP-EEEEEE", created_at: "2026-10-22T00:00:00Z", phone: null }),
  ];
  assertEquals(pickByPhone(rows, "whatsapp:+18765551234")?.id, "b");
  assertEquals(pickByPhone(rows, "+447700900123")?.id, "d");
  assertEquals(pickByPhone(rows, "+16475550000"), null);
});

Deno.test("every reply says what happens next, has no dash, no banned phrase, and never names a document or a reason", () => {
  const all = [
    statusReply(row({ status: "started" }), null, { appBase: APP, senderMatchesRow: true }),
    statusReply(row(), null, { appBase: APP, senderMatchesRow: true }),
    statusReply(row({ status: "gap" }), null, { appBase: APP, senderMatchesRow: true }),
    statusReply(row({ status: "passed" }), { active: false }, { appBase: APP, senderMatchesRow: true }),
    statusReply(row({ status: "passed" }), { active: true }, { appBase: APP, senderMatchesRow: true }),
    statusReply(row({ status: "blocked" }), null, { appBase: APP, senderMatchesRow: true }),
    statusReply(null, null, { appBase: APP, misses: 0 }),
    statusReply(null, null, { appBase: APP, misses: 1 }),
    statusReply(null, null, { appBase: APP, misses: 0, referenceGiven: "APP-ZZZZZZ" }),
  ];
  const next = /reply here|hear from us|will message you|will be told|a person will|will be in touch|will pick this up|will check|will look once more/i;
  for (const r of all) {
    assert(!/[\u2013\u2014]/.test(r.text), `dash in: ${r.text}`);
    assert(next.test(r.text), `does not say what happens next: ${r.text}`);
    assertEquals(guardrails.scan(r.text), [], `banned phrase in: ${r.text}`);
    assert(!/guarantee|100%|approved|accepted|you will get work|escrow/i.test(r.text), r.text);
    for (const line of r.text.split("\n")) if (!line.includes("token=")) assert(line.length <= 260, `long line: ${line}`);
  }
  const gap = all[2].text;
  assert(!/\b(id|passport|trn|certificate|address|proof|selfie|reference\s+letter|police)\b/i.test(gap), "the gap reply must not name the document");
  const blocked = all[5].text;
  assert(!/because|reason|failed|declined|refused|blocked|rejected/i.test(blocked), "the blocked reply must not give a reason");
});

Deno.test("the date is said the Jamaican way", () => {
  assertEquals(sayDate("2026-10-03T22:30:00Z"), "3 October 2026");
  assertEquals(sayDate("2026-10-04T03:30:00Z"), "3 October 2026", "half past ten at night in Jamaica is still the 3rd");
  assert(sayDate(null).length > 0 && sayDate("nonsense").length > 0);
});

Deno.test("the lane sits after the join lane and the alert list, before the worker lanes, and is held with the desk", () => {
  const join = src.indexOf("joining as a tradesperson: the six questions");
  const alerts = src.indexOf("── the job alert list");
  const status = src.indexOf("── where is my application");
  const buttons = src.indexOf("── the buttons on a report draft");
  const offScript = src.indexOf("a tradesperson who would otherwise reach the client intake");
  assert(join > 0 && alerts > join && status > alerts && buttons > status && offScript > buttons, "the lane is out of order");
  const lane = src.slice(status, buttons);
  assert(lane.includes("!deskHasThisNumber &&"), "a number the desk is holding must not be answered here");
  assert(lane.includes("isStatusAsk(statusSaid)"), "the lane does not use the tested matcher");
  // A worker on a live job keeps their lane unless they sent a reference.
  assert(/reference \? null : await lookupWorkerWithActiveJobs\(supabase, msg\.from\)/.test(lane), "a worker mid job must not be hijacked by STATUS");
  assert(lane.includes("skipped_worker_on_job"));
});

Deno.test("the lane is read only, answers from fixed strings, and hands a blocked applicant or a second miss to a person", () => {
  const lane = src.slice(src.indexOf("── where is my application"), src.indexOf("── the buttons on a report draft"));
  assert(!/from\("applications"\)\.(update|insert|upsert|delete)/.test(lane), "the lane must never write to applications");
  assert(!/from\("worker_profiles"\)\.(update|insert|upsert|delete)/.test(lane), "the lane must never write to worker_profiles");
  assert(!/chatWithFailover|pickTextProvider|answerWorkerQuestion|screenOffScript/.test(lane), "no model writes a status reply");
  assert(lane.includes("statusReply(row, profile,"), "the reply must come from the tested function");
  assert(lane.includes("if (reply.escalate)"), "no escalation");
  const esc = lane.slice(lane.indexOf("if (reply.escalate)"));
  assert(esc.includes("human_handling: true, awaiting_human_since: nowIso"), "the thread is not held for a person");
  assert(esc.includes('priority: "high"'), "the desk push is not high priority");
  assert(!/row\.name|row\.phone|row\.email/.test(esc), "no contact details may travel in the push");
  assert(lane.includes(`_lane: STATUS_MISS_LANE`) && STATUS_MISS_LANE === "status_miss", "the miss count is not kept in the session");
  assert(lane.includes('"yaadly.status.outcome"'), "no span attribute to see it ran");
});
