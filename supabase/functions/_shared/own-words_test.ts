import { assert, assertEquals } from "jsr:@std/assert@1";
import { screenOwnWords } from "./own-words.ts";

Deno.test("ordinary words about the work pass untouched", () => {
  for (const said of [
    "fixing beam in place, the work is done for this stage",
    "I am back Tuesday to hang the door",
    "Tiles are up, grout tomorrow. The client's documents are held safely in the house.",
  ]) assertEquals(screenOwnWords(said).ok, true, said);
});

// The same five phrases both guardrail suites assert, so a worker's words are
// held to exactly the list a model's are.
Deno.test("the banned phrases are caught when a person types them", () => {
  for (const said of [
    "Your money is in escrow until I finish",
    "This removes all fraud",
    "The job is 100% done",
    "You are fully covered",
    "The money is held safely with a licensed payment provider",
  ]) {
    const r = screenOwnWords(said);
    assertEquals(r.ok, false, said);
    if (!r.ok) {
      assert(r.terms.length > 0);
      assert(r.message.startsWith("Not sent."), r.message);
      assert(/Nothing has gone to the client/.test(r.message), r.message);
      assert(!/[–—]/.test(r.message), "no dashes");
    }
  }
});

Deno.test("he is told which words, so he can fix it without guessing", () => {
  const r = screenOwnWords("Payment is in ESCROW and you are fully covered");
  assert(!r.ok);
  if (!r.ok) {
    assert(r.terms.includes("escrow"), r.terms.join());
    assert(r.terms.includes("fully covered"), r.terms.join());
    assert(r.message.includes('"escrow"'));
  }
});

Deno.test("nothing and null are clean, never a crash", () => {
  assertEquals(screenOwnWords("").ok, true);
  assertEquals(screenOwnWords(null).ok, true);
});
