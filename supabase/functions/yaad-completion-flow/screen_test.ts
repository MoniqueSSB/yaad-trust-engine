// The automatic screen on a signed Completion Report. It is the only thing
// between a worker's words and the client when nobody at Yaadly reads them,
// so the cases that matter are the ones that must hold a report: a price, and
// a word Yaadly never uses. If one of these ever has to be loosened, the
// change is letting a figure or a promise reach an owner unread.
import { assertEquals } from "jsr:@std/assert@1";
import { screenWords } from "./screen.ts";

Deno.test("clean care notes pass", () => {
  assertEquals(screenWords(["Leave the shower unused for 48 hours.", "Wipe the tiles after use."], "Retiled the wall and fitted the mixer."), []);
});

Deno.test("a price in the worker's account holds it", () => {
  const f = screenWords([], "Materials cost J$45,000 and labour was paid.");
  assertEquals(f.some((x) => x.kind === "money"), true);
});

Deno.test("a pound figure holds it", () => {
  assertEquals(screenWords(["The client paid £300 for this."], null).length > 0, true);
});

Deno.test("a banned word holds it", () => {
  assertEquals(screenWords(["This work is 100% guaranteed."], null).some((x) => x.kind === "wording"), true);
});

Deno.test("escrow holds it", () => {
  assertEquals(screenWords([], "Money was held in escrow until I finished.").some((x) => x.kind === "wording"), true);
});

Deno.test("a count of days is not money", () => {
  assertEquals(screenWords(["Keep off the floor for 3 days."], "Took 4 days, 2 stages."), []);
});
