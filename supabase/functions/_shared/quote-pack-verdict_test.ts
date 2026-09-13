import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import * as guardrails from "./guardrails.ts";
import { missingSections, REQUIRED_SECTIONS, verdictFor } from "./quote-pack-verdict.ts";

const full = (over: Record<string, unknown> = {}) => ({
  scope_summary: "Repaint the front railings.",
  included: ["rust prep", "two coats"],
  excluded: ["gate motor"],
  rough_timeline: "About three days.",
  payment_stages: [{ stage: "First coat", evidence_note: "Even coverage.", proportion_percent: 100 }],
  ...over,
});

Deno.test("a clean pack is clean", () => {
  const v = verdictFor(full(), guardrails.scan);
  assertEquals(v.banned_language_detected, false);
  assertEquals(v.price_language_detected, false);
});

// The exact case that held a pack: the phrase is banned for the money sense
// and the model used it about paint. The verdict must still report it, because
// deciding it is harmless is a person's call, not this function's.
Deno.test("the decorating sense of a banned phrase is still reported", () => {
  const v = verdictFor(full({ payment_stages: [{ evidence_note: "surface fully covered" }] }), guardrails.scan);
  assertEquals(v.banned_language_detected, true);
  assertEquals(v.banned_samples, ["fully covered"]);
});

Deno.test("escrow is caught anywhere in the pack", () => {
  const v = verdictFor(full({ scope_summary: "Funds sit in escrow." }), guardrails.scan);
  assertEquals(v.banned_language_detected, true);
});

// A pack must never carry a figure: the worker prices the job, not Yaadly.
Deno.test("a price anywhere in the pack is reported, with a sample", () => {
  const v = verdictFor(full({ rough_timeline: "About three days, J$45,000 of materials." }), guardrails.scan);
  assertEquals(v.price_language_detected, true);
  assertEquals(v.samples.length > 0, true);
});

Deno.test("a bare large number with a currency word is reported", () => {
  const v = verdictFor(full({ scope_summary: "Roughly 45,000 dollars of work." }), guardrails.scan);
  assertEquals(v.price_language_detected, true);
});

// A percentage is not a price. Payment stages are expressed in percentages and
// flagging those would make every pack dirty.
Deno.test("a stage percentage is not a price", () => {
  const v = verdictFor(full({ payment_stages: [{ proportion_percent: 30 }, { proportion_percent: 70 }] }), guardrails.scan);
  assertEquals(v.price_language_detected, false);
});

Deno.test("missing sections are named, in the required order", () => {
  assertEquals(missingSections({ scope_summary: "x" }), ["included", "excluded", "rough_timeline", "payment_stages"]);
  assertEquals(missingSections(full()), []);
  assertEquals(REQUIRED_SECTIONS.length, 5);
});
