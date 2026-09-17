// A worker outside WhatsApp's 24 hour window gets the approved template, with
// a sentence that is true for the kind and never one that asks for a reply
// about words they have not seen.
//
// Run: deno test --allow-read supabase/functions/

import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  hasWorkerTemplateDecision, insideWindow, samePhoneDigits, templateVar, WINDOW_MS, WORKER_UPDATE_BODY, workerTemplateSummary,
} from "./worker-template.ts";

const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

Deno.test("every kind routed to a worker's phone has a decision, template or not", () => {
  const routing = src.slice(src.indexOf('recipientEmail = "";') - 700, src.indexOf('recipientEmail = "";'));
  const kinds = [...routing.matchAll(/kind === "([a-z_]+)"/g)].map((m) => m[1]);
  assert(kinds.length >= 10, "routing block moved");
  for (const k of new Set(kinds)) {
    assert(hasWorkerTemplateDecision(k), `${k} routes to a worker but has no template decision`);
  }
});

Deno.test("the drafted report is never sent as a template", () => {
  assertEquals(workerTemplateSummary("evidence_landed"), null);
});

Deno.test("summaries fit the sentence and carry no dashes or promises", () => {
  for (const k of ["booked_worker", "job_live_worker", "worker_paid", "evidence_comment", "walkthrough_requested"]) {
    const s = workerTemplateSummary(k)!;
    assert(s && s.length <= 200, k);
    assert(!/[–—]/.test(s), `${k} has a dash`);
    assert(!/\.$/.test(s), `${k} ends in a full stop, the body adds one`);
    assert(!/escrow|guarantee|100%|held for/i.test(s), k);
  }
  assert(workerTemplateSummary("job_live_worker")!.includes("location"), "the live message must say how to check in");
  assert(workerTemplateSummary("booked_worker")!.includes("Do not start"), "booked must still say not to start");
});

Deno.test("the body neither starts nor ends on a variable, and uses exactly three", () => {
  assert(!WORKER_UPDATE_BODY.startsWith("{{"));
  assert(!/\}\}\s*$/.test(WORKER_UPDATE_BODY));
  assertEquals([...WORKER_UPDATE_BODY.matchAll(/\{\{(\d)\}\}/g)].map((m) => m[1]), ["1", "2", "3"]);
  assert(!/[–—]/.test(WORKER_UPDATE_BODY));
});

Deno.test("the window is read with a margin, and no record means outside", () => {
  const now = Date.parse("2026-09-17T12:00:00Z");
  assert(insideWindow(new Date(now - 3600_000).toISOString(), now));
  assert(!insideWindow(new Date(now - WINDOW_MS - 1).toISOString(), now));
  assert(!insideWindow(null, now));
  assert(!insideWindow("not a date", now));
});

Deno.test("the same phone matches across the formats wa_inbound_seen holds", () => {
  assert(samePhoneDigits("+447761231858", "447761231858"));
  assert(samePhoneDigits("whatsapp:+18765550199", "18765550199"));
  assert(!samePhoneDigits("+447761231858", "+447761231859"));
  assert(!samePhoneDigits("", "123"));
});

Deno.test("a template variable is one line, bounded, never empty", () => {
  assertEquals(templateVar("a\nb"), "a b");
  assertEquals(templateVar(""), "-");
  assert(templateVar("x".repeat(500)).length <= 200);
});
