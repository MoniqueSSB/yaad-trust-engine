import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(join(here, "ts-resolve-hooks.mjs")));

let screenOwnWords;
before(async () => {
  ({ screenOwnWords } = await import(pathToFileURL(join(here, "../lib/own-words.ts")).href));
});
const shared = join(here, "..", "..", "supabase", "functions", "_shared");

test("the app's banned list is the shared one, byte for byte", () => {
  assert.equal(
    readFileSync(join(here, "..", "lib", "guardrails.ts"), "utf8"),
    readFileSync(join(shared, "guardrails.ts"), "utf8"),
    "web/lib/guardrails.ts has drifted. Copy supabase/functions/_shared/guardrails.ts over it.",
  );
});

test("the app's screen says the same sentence the WhatsApp one does", () => {
  const theirs = readFileSync(join(shared, "own-words.ts"), "utf8");
  const ours = readFileSync(join(here, "..", "lib", "own-words.ts"), "utf8");
  const body = (s) => s.slice(s.indexOf("export function screenOwnWords"));
  assert.equal(body(ours), body(theirs));
});

test("the five banned phrases are caught on the edit page too", () => {
  for (const said of [
    "Your money is in escrow until I finish",
    "This removes all fraud",
    "The job is 100% done",
    "You are fully covered",
    "The money is held safely with a licensed payment provider",
  ]) assert.equal(screenOwnWords(said).ok, false, said);
  assert.equal(screenOwnWords("fixing beam in place").ok, true);
});
