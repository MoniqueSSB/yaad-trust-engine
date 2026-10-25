import { assert, assertEquals } from "jsr:@std/assert@1";
import { normaliseReference, PER_CALLER_PER_HOUR, PER_REFERENCE_PER_HOUR, SAME_ANSWER } from "./apply-link.ts";

Deno.test("a reference is accepted however a person types it, and comes out as the row holds it", () => {
  assertEquals(normaliseReference("APP-48A107"), "APP-48A107");
  assertEquals(normaliseReference("app-48a107"), "APP-48A107");
  assertEquals(normaliseReference("  app 48a107 "), "APP-48A107");
  assertEquals(normaliseReference("48A107"), "APP-48A107");
  assertEquals(normaliseReference("APP48A107"), "APP-48A107");
  // An en dash typed from a phone keyboard in place of the hyphen.
  assertEquals(normaliseReference("APP\u201348A107"), "APP-48A107");
});

Deno.test("anything that is not a reference is never looked up", () => {
  for (const bad of ["", null, undefined, "APP-", "APP-48A10", "APP-48A1077", "APP-48A1 7", "APP-48A10%", "' or 1=1 --", "APP-48A107APP-48A107"]) {
    assertEquals(normaliseReference(bad), null, `accepted: ${String(bad)}`);
  }
});

Deno.test("the same answer, with no dashes, and no word that says whether the reference exists", () => {
  assert(!/[\u2013\u2014]/.test(SAME_ANSWER), "no dashes");
  assert(/^If that reference is ours/.test(SAME_ANSWER));
  assert(!/not found|no such|does not exist|sent to \+|@/.test(SAME_ANSWER), "must not reveal a result or an address");
});

// Which applications get a link is tested where it is decided, applyLinkPhase
// in yaad-notify-client/worker-cleared_test.ts.
Deno.test("the throttle is three an hour both ways", () => {
  assertEquals(PER_REFERENCE_PER_HOUR, 3);
  assertEquals(PER_CALLER_PER_HOUR, 3);
});
