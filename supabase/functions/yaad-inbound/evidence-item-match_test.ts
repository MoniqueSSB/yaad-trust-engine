// Proves pickEvidenceItem() only ever attributes a comment to a specific
// photo when the message actually names its code, and never guesses.
//
// Run: deno test supabase/functions/yaad-inbound/evidence-item-match_test.ts

import { assert, assertEquals } from "jsr:@std/assert@1";
import { pickEvidenceItem, type EvidenceItem } from "./evidence-item-match.ts";

const TWO: EvidenceItem[] = [
  { id: "11111111-1111-1111-1111-111111111111", item_code: "P1" },
  { id: "22222222-2222-2222-2222-222222222222", item_code: "P2" },
];

Deno.test("a code named on its own matches", () => {
  assertEquals(pickEvidenceItem("P2", TWO)?.item_code, "P2");
});

Deno.test("a code named alongside other words still matches, case insensitive", () => {
  assertEquals(pickEvidenceItem("p2 looks great thanks", TWO)?.item_code, "P2");
  assertEquals(pickEvidenceItem("that gap in P1 is still there", TWO)?.item_code, "P1");
});

Deno.test("a plain comment with no code names nothing", () => {
  assertEquals(pickEvidenceItem("this looks great, thanks", TWO), null);
  assertEquals(pickEvidenceItem("that gap is still there", TWO), null);
});

Deno.test("a code not among the stage's own items names nothing", () => {
  // The item exists somewhere in the system, just not on this stage's
  // list, so nothing here should be attributed to it by accident.
  assertEquals(pickEvidenceItem("P9 is fine", TWO), null);
});

Deno.test("a longer number is not misread as a shorter code", () => {
  // "p12" must never match P1: the digit boundary is the whole point.
  assertEquals(pickEvidenceItem("p12 is the reference", TWO), null);
});

Deno.test("a bare ordinal number is never read as a code", () => {
  // The whole reason this is "P1" rather than "1": it must never collide
  // with the ordinal-number conveniences pickJobChoice() and the worker
  // "reply 1 to send" flow already use elsewhere in this repository.
  assertEquals(pickEvidenceItem("1", TWO), null);
  assertEquals(pickEvidenceItem("reply 1 to confirm", TWO), null);
});

Deno.test("empty text or an empty item list names nothing", () => {
  assertEquals(pickEvidenceItem("", TWO), null);
  assertEquals(pickEvidenceItem("P1", []), null);
});

/* ── the gate stays wired ─────────────────────────────────────────────────
   Proves index.ts is actually running this file's logic rather than a
   second copy of its own that has quietly drifted from it. */
const inboundSource = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

Deno.test("yaad-inbound imports pickEvidenceItem rather than defining its own", () => {
  assert(inboundSource.includes('from "./evidence-item-match.ts"'), "yaad-inbound no longer imports evidence-item-match.ts");
  assert(
    (inboundSource.match(/pickEvidenceItem\(/g) ?? []).length >= 2,
    "yaad-inbound should call pickEvidenceItem from both the worker-reply and client-comment lanes",
  );
});
