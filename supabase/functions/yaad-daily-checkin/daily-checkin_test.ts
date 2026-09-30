// The daily check-in follows the arrival rule and covers live work. 30 Sep 2026.
import { assert } from "jsr:@std/assert@1";
import { checkInApplies } from "./arrival-rule.ts";

const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

Deno.test("live work is in_progress and evidence", () => {
  assert(src.includes('.in("status", ["in_progress", "evidence"])'), "a job with evidence waiting drops off the daily ask");
});

Deno.test("where somebody is at home, the check-in question is not asked", () => {
  assert(src.includes("if (!checkInApplies(accessById.get(j.id)))"), "the arrival rule is not read");
  const at = src.indexOf("if (!checkInApplies(accessById.get(j.id)))");
  const atHome = src.slice(at, src.indexOf("continue;\n      }", at));
  assert(!atHome.includes("onSiteSid"), "the on site question still goes to a job with somebody at home");
  assert(!checkInApplies("Someone lives there / is at home"), "the rule changed under this test");
});
