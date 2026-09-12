// Proof that the shortlist agent cannot pick anybody it was not shown, cannot
// pick more than asked, and cannot put a reason in front of the desk that the
// banned-language screen would refuse. Run by CI with
//   deno test --allow-read --allow-env supabase/functions/
import { assertEquals, assertStrictEquals } from "jsr:@std/assert@1";
import { buildPrompt, extractJson, rankedPicks, validatePicks, type Candidate } from "./picks.ts";
import { isClean } from "./guardrails.ts";

const cands: Candidate[] = [
  { worker_email: "ann@example.com", name: "Ann-Marie Brown", trade: "Roofing", parish: "St Catherine", areas: "Portmore, Spanish Town", lane: "certified", years: 9, jobs_completed: 4, about: "Zinc and shingle roofs.", slug: "ann-marie-brown", match_reason: "trade and parish", rank_score: 154 },
  { worker_email: "dev@example.com", name: "Devon Clarke", trade: "Roofing", parish: "Kingston", areas: null, lane: "informal", years: 3, jobs_completed: 1, about: null, slug: "devon-clarke", match_reason: "trade, different parish", rank_score: 101 },
  { worker_email: "kem@example.com", name: "Kemar Reid", trade: "Masonry", parish: "St Catherine", areas: "Portmore", lane: "informal", years: 12, jobs_completed: 0, about: "Block work and rendering.", slug: "kemar-reid", match_reason: "parish, related trade", rank_score: 50 },
];

Deno.test("a pick outside the list is dropped, and the rest keep their order", () => {
  const raw = `{"picks":[{"n":7,"reason":"made up"},{"n":2,"reason":"Roofer, has done a zinc job before."},{"n":1,"reason":"Roofer in the parish with several completed jobs."}]}`;
  const picks = validatePicks(raw, cands, 3, isClean)!;
  assertEquals(picks.map((p) => p.worker_email), ["dev@example.com", "ann@example.com"]);
  assertEquals(picks.map((p) => p.rank), [1, 2]);
  assertEquals(picks.every((p) => p.source === "model"), true);
});

Deno.test("never more than asked, and a duplicate number counts once", () => {
  const raw = `{"picks":[{"n":1,"reason":"a"},{"n":1,"reason":"b"},{"n":2,"reason":"c"},{"n":3,"reason":"d"}]}`;
  const picks = validatePicks(raw, cands, 2, isClean)!;
  assertEquals(picks.length, 2);
  assertEquals(picks.map((p) => p.worker_email), ["ann@example.com", "dev@example.com"]);
});

Deno.test("a reason the guardrail refuses is replaced by the database's own reason", () => {
  const raw = `{"picks":[{"n":1,"reason":"Money is held in escrow so this is safe."}]}`;
  const picks = validatePicks(raw, cands, 3, isClean)!;
  assertStrictEquals(picks[0].reason, "trade and parish");
});

Deno.test("a reason that names a price is replaced too", () => {
  const raw = `{"picks":[{"n":2,"reason":"Usually charges about J$45,000 for this."}]}`;
  const picks = validatePicks(raw, cands, 3, isClean)!;
  assertStrictEquals(picks[0].reason, "trade, different parish");
});

Deno.test("no JSON, or JSON without picks, is null so the caller falls back to the ranking", () => {
  assertStrictEquals(validatePicks("I would suggest Ann-Marie.", cands, 3, isClean), null);
  assertStrictEquals(validatePicks(`{"chosen":[1]}`, cands, 3, isClean), null);
});

Deno.test("a well formed empty list is an answer, not a failure", () => {
  assertEquals(validatePicks(`{"picks":[]}`, cands, 3, isClean), []);
});

Deno.test("the ranking fallback is the top of the list, in order, marked as rank", () => {
  const picks = rankedPicks(cands, 2);
  assertEquals(picks.map((p) => [p.worker_email, p.rank, p.source]), [
    ["ann@example.com", 1, "rank"],
    ["dev@example.com", 2, "rank"],
  ]);
});

Deno.test("the prompt numbers candidates from 1 and carries no email address", () => {
  const p = buildPrompt({
    id: "JOB-1", title: "Roof leak over the back bedroom", trade: "Roofing", job_type: null,
    parish: "St Catherine", urgency: "Urgent, within 48 hours", access_type: "No inside access needed, outside work only",
    size_band: null, descr: "Zinc lifted after the storm, water coming in.",
  }, cands, 2);
  assertEquals(p.includes("1. Ann-Marie Brown"), true);
  assertEquals(p.includes("3. Kemar Reid"), true);
  assertEquals(p.includes("@example.com"), false);
  assertEquals(p.includes("Pick up to 2 of these 3"), true);
});

Deno.test("extractJson survives fences and a thinking block", () => {
  const j = extractJson("<think>hmm</think>\n```json\n{\"picks\":[{\"n\":1,\"reason\":\"x\"}]}\n```");
  assertEquals(Array.isArray(j?.picks), true);
});
