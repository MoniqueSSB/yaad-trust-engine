// A tap is a way of typing. The row ids must be exactly what a worker typing
// the letter would have sent, or the menu files nothing it says it files.
//
// Run: deno test --allow-read supabase/functions/

import { assert, assertEquals } from "jsr:@std/assert@1";
import { sectionMenuContent } from "./content.ts";

Deno.test("the section menu's row ids are the letters the typed question accepts", () => {
  const c = sectionMenuContent();
  const items = c.types["twilio/list-picker"].items;
  assertEquals(items.map((i) => i.id), ["B", "D", "A", "P", "N", "S"]);
  // WhatsApp's own limits: ten rows, 24 characters per row title, 20 on the button.
  assert(items.length <= 10);
  for (const i of items) assert(i.item.length <= 24, i.item);
  assert(c.types["twilio/list-picker"].button.length <= 20);
  // Exactly one variable, the lead sentence, and the body uses it.
  assertEquals(Object.keys(c.variables), ["1"]);
  assert(c.types["twilio/list-picker"].body.startsWith("{{1}}"));
});

import { SECTION_MENU_APPROVAL, SECTION_MENU_NAME } from "./content.ts";
import { CLIENT_UPDATE_APPROVAL, CLIENT_UPDATE_BODY, CLIENT_UPDATE_NAME, clientUpdateContent, WORKER_UPDATE_APPROVAL, WORKER_UPDATE_BODY, WORKER_UPDATE_NAME, workerUpdateContent } from "./content.ts";

Deno.test("the section menu is submitted for approval as itself, as Utility", () => {
  assertEquals(SECTION_MENU_APPROVAL.name, SECTION_MENU_NAME);
  assert(/^[a-z0-9_]+$/.test(SECTION_MENU_APPROVAL.name), "Meta template names are lowercase, digits and underscores");
  assert(SECTION_MENU_APPROVAL.name.length <= 512);
  // A question about a job the worker is already doing. Never marketing.
  assertEquals(SECTION_MENU_APPROVAL.category, "UTILITY");
});

Deno.test("the worker update template is the one yaad-notify-client fills", async () => {
  const other = await Deno.readTextFile(new URL("../yaad-notify-client/worker-template.ts", import.meta.url));
  assert(other.includes(JSON.stringify(WORKER_UPDATE_BODY)), "the body drifted from yaad-notify-client/worker-template.ts");
  assert(other.includes(`"${WORKER_UPDATE_NAME}"`), "the template name drifted");
  const c = workerUpdateContent();
  assertEquals(c.types["twilio/text"].body, WORKER_UPDATE_BODY);
  assertEquals(Object.keys(c.variables), ["1", "2", "3"]);
  assert(/^[a-z0-9_]+$/.test(WORKER_UPDATE_APPROVAL.name), "Meta template names are lowercase, digits and underscores");
  assertEquals(WORKER_UPDATE_APPROVAL.category, "UTILITY");
  assert(!/[–—]/.test(WORKER_UPDATE_BODY));
});

Deno.test("the client update template is the one yaad-notify-client fills", async () => {
  const other = await Deno.readTextFile(new URL("../yaad-notify-client/client-template.ts", import.meta.url));
  assert(other.includes(JSON.stringify(CLIENT_UPDATE_BODY)), "the body drifted from yaad-notify-client/client-template.ts");
  assert(other.includes(`"${CLIENT_UPDATE_NAME}"`), "the template name drifted");
  const c = clientUpdateContent();
  assertEquals(c.types["twilio/text"].body, CLIENT_UPDATE_BODY);
  assertEquals(Object.keys(c.variables), ["1", "2", "3"]);
  assert(/^[a-z0-9_]+$/.test(CLIENT_UPDATE_APPROVAL.name), "Meta template names are lowercase, digits and underscores");
  assertEquals(CLIENT_UPDATE_APPROVAL.category, "UTILITY");
  assert(!/[\u2013\u2014]/.test(CLIENT_UPDATE_BODY));
});

Deno.test("the daily check-in's second message is the same line in both functions", async () => {
  const { ON_SITE_BODY, ON_SITE_STEPS } = await import("./content.ts");
  const checkin = await Deno.readTextFile(new URL("../yaad-daily-checkin/index.ts", import.meta.url));
  assert(checkin.includes(JSON.stringify(ON_SITE_STEPS)), "yaad-daily-checkin's copy of ON_SITE_STEPS has drifted from content.ts");
  assert(!ON_SITE_STEPS.includes("\n"), "a template variable is one line");
  assert(ON_SITE_BODY.includes("Are you on site today?") && ON_SITE_BODY.includes("Send current location"), "the first message asks the question and says how to add the location");
  assert(!/[\u2013\u2014]/.test(ON_SITE_BODY + ON_SITE_STEPS), "no dashes");
});

/* ── the new versions and the worker templates, 30 Sep 2026 ─────────────── */

import {
  ALERT_PARISHES_BODY, ALERT_PARISHES_NAME, ALERT_TRADES_BODY, ALERT_TRADES_NAME, JOB_ALERT_BODY, JOB_ALERT_NAME,
  JOIN_ALERTS_BODY, JOIN_ALERTS_NAME, META_WORKER_TEMPLATES, metaWorkerApproval, metaWorkerContent,
  UPDATE_DRAFT_BODY, UPDATE_DRAFT_NAME,
} from "./content.ts";

const DASH = /[\u2013\u2014]/;
const BANNED = /escrow|\bheld\b|100%|guarantee/i;

Deno.test("a changed body is a new name, never the approved one edited", () => {
  assertEquals(UPDATE_DRAFT_NAME, "yaadly_update_read_back_v2");
  assertEquals(JOIN_ALERTS_NAME, "yaadly_join_alerts_v2");
  assertEquals(ALERT_TRADES_NAME, "yaadly_alert_trades_menu_v2");
  assertEquals(ALERT_PARISHES_NAME, "yaadly_alert_parishes_menu_v2");
  assertEquals(JOB_ALERT_NAME, "yaadly_job_alert_v2");
});

Deno.test("the joining button counts the questions joining actually asks", async () => {
  const lane = await Deno.readTextFile(new URL("../yaad-inbound/join-lane.ts", import.meta.url));
  // What a worker reads, not what a comment says: comment lines are skipped.
  const code = lane.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  const totals = [...code.matchAll(/\b\d of (\d)\b/g)].map((m) => m[1]);
  assert(totals.length > 0);
  for (const n of totals) assert(JOIN_ALERTS_BODY.includes(`2 of ${n}:`), `join-lane.ts says of ${n}, the button disagrees`);
});

Deno.test("the read-back button says the typed way too", () => {
  assert(UPDATE_DRAFT_BODY.includes("or reply 1"));
});

Deno.test("the lists say how to name one that is not listed", () => {
  for (const b of [ALERT_TRADES_BODY, ALERT_PARISHES_BODY]) assert(/not on the list\? Type/.test(b), b);
});

Deno.test("the job alert puts no article in front of the trade", () => {
  assert(!/\ban? \{\{1\}\}/.test(JOB_ALERT_BODY), JOB_ALERT_BODY);
});

Deno.test("every worker template follows Meta's rules and Yaadly's", () => {
  const names = new Set<string>();
  const settings = new Set<string>();
  for (const t of META_WORKER_TEMPLATES) {
    assert(/^[a-z0-9_]+$/.test(t.name), t.name);
    assert(!names.has(t.name) && !settings.has(t.setting), `${t.name} is listed twice`);
    names.add(t.name); settings.add(t.setting);
    assert(t.setting.startsWith("twilio_content_sid_"));
    assert(!/^\s*\{\{/.test(t.body) && !/\}\}\s*[.]?\s*$/.test(t.body), `${t.name} starts or ends with a variable`);
    const used = [...t.body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => m[1]);
    assertEquals([...new Set(used)].sort(), Object.keys(t.variables).sort(), `${t.name}: every variable needs a sample, and every sample a variable`);
    assert(!DASH.test(t.body), `${t.name} has a dash`);
    assert(!BANNED.test(t.body), `${t.name} has a banned word`);
    assert(!/\bowner\b/i.test(t.body), `${t.name} says owner, not client`);
    assertEquals(metaWorkerApproval(t).category, "UTILITY");
    assertEquals(metaWorkerContent(t).types["twilio/text"].body, t.body);
  }
});

Deno.test("no new body carries a dash or a banned word", () => {
  for (const b of [UPDATE_DRAFT_BODY, JOIN_ALERTS_BODY, ALERT_TRADES_BODY, ALERT_PARISHES_BODY, JOB_ALERT_BODY]) {
    assert(!DASH.test(b), b);
    assert(!BANNED.test(b), b);
  }
});
