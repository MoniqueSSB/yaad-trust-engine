// The phone match, and the collision it exists to close.
//
// The negative cases are the point. This check decides whether a WhatsApp
// reply is allowed to book a worker or approve a stage, and approving a stage
// raises a worker pay invoice.
//
// Run: deno test --allow-read supabase/functions/

import { assert, assertEquals } from "jsr:@std/assert@1";
import { digitsOf, matchingPhone, samePhone } from "./phone.ts";

Deno.test("the same number in different shapes still matches", () => {
  const pairs: [string, string][] = [
    ["+1 (876) 555-1234", "18765551234"],
    ["whatsapp:+447700900123", "+44 7700 900123"],
    ["8765551234", "18765551234"],          // worker typed it without the country code
    ["876 555 1234", "+1-876-555-1234"],
  ];
  for (const [a, b] of pairs) {
    assert(samePhone(a, b), `should have matched: ${a} / ${b}`);
    assert(samePhone(b, a), `matching must not depend on argument order: ${a} / ${b}`);
  }
});

Deno.test("two different countries sharing their last nine digits do NOT match", () => {
  // This is the whole reason the file exists. Under the last-nine-digits rule
  // these were the same person, and that rule guarded a worker pay invoice.
  const uk = "+447700900123";
  const jm = "+18765700900123";
  assertEquals(digitsOf(uk).slice(-9), digitsOf(jm).slice(-9), "the old rule really did collide here");
  assert(!samePhone(uk, jm), "the collision the old rule allowed is still open");
});

Deno.test("a genuinely different number never matches", () => {
  assert(!samePhone("+18765551234", "+18765559999"));
  assert(!samePhone("+447700900123", "+447700900124"));
});

Deno.test("something too short to be a number matches nothing, including itself", () => {
  for (const junk of ["", "   ", "12345", "876", "not a number"]) {
    assert(!samePhone(junk, "+18765551234"), `should not match: ${junk}`);
    assert(!samePhone(junk, junk), `a fragment must not match itself: ${junk}`);
  }
});

Deno.test("a suffix is only allowed to be short by a country code, not by more", () => {
  // Nine digits inside a much longer string is a coincidence, not a number.
  assert(!samePhone("555123456", "999888777555123456"));
});

Deno.test("null and undefined are refused rather than throwing", () => {
  assert(!samePhone(null, "+18765551234"));
  assert(!samePhone(undefined, undefined));
  assertEquals(digitsOf(null), "");
});

Deno.test("matchingPhone picks the right rows out of a table read", () => {
  const rows = [
    { email: "a@x.com", phone: "+18765551234" },
    { email: "b@x.com", phone: "8765551234" },
    { email: "c@x.com", phone: "+447700900123" },
    { email: "d@x.com", phone: null },
  ];
  const hits = matchingPhone(rows, (r) => r.phone, "18765551234");
  assertEquals(hits.map((r) => r.email), ["a@x.com", "b@x.com"]);
});
