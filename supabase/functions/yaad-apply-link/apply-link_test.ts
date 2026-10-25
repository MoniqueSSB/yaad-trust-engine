import { assert, assertEquals } from "jsr:@std/assert@1";
import { isOpenApplication, normaliseReference, PER_CALLER_PER_HOUR, PER_REFERENCE_PER_HOUR, SAME_ANSWER } from "./apply-link.ts";

Deno.test("a reference is accepted however a person types it, and comes out as the row holds it", () => {
  assertEquals(normaliseReference("APP-48A107"), "APP-48A107");
  assertEquals(normaliseReference("app-48a107"), "APP-48A107");
  assertEquals(normaliseReference("  app 48a107 "), "APP-48A107");
  assertEquals(normaliseReference("48A107"), "APP-48A107");
  assertEquals(normaliseReference("APP48A107"), "APP-48A107");
  // An en dash typed from a phone keyboard in place of the hyphen.
  assertEquals(normaliseReference("APP–48A107"), "APP-48A107");
});

Deno.test("anything that is not a reference is never looked up", () => {
  for (const bad of ["", null, undefined, "APP-", "APP-48A10", "APP-48A1077", "APP-48A1 7", "APP-48A10%", "' or 1=1 --", "APP-48A107APP-48A107"]) {
    assertEquals(normaliseReference(bad), null, `accepted: ${String(bad)}`);
  }
});

Deno.test("the same answer, with no dashes, and no word that says whether the reference exists", () => {
  assert(!/[–—]/.test(SAME_ANSWER), "no dashes");
  assert(/^If that reference is ours/.test(SAME_ANSWER));
  assert(!/not found|no such|does not exist|sent to \+|@/.test(SAME_ANSWER), "must not reveal a result or an address");
});

Deno.test("only an open application gets a link, and the throttle is three an hour both ways", () => {
  assert(isOpenApplication("started") && isOpenApplication("received"));
  for (const s of ["approved", "declined", "withdrawn", "published", "", null, undefined]) assert(!isOpenApplication(s), String(s));
  assertEquals(PER_REFERENCE_PER_HOUR, 3);
  assertEquals(PER_CALLER_PER_HOUR, 3);
});
