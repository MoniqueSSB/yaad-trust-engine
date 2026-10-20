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

// 20 Oct 2026: a test job left at "evidence" was pinged every day for three weeks.
Deno.test("test jobs are never pinged", () => {
  assert(src.includes('.not("is_test", "is", true)'), "test jobs get the daily ask");
});

// 20 Oct 2026: "your job Carpentry & Joinery job, Kingston".
Deno.test("the job label never doubles the word job", async () => {
  const { jobLabel } = await import("./job-label.ts");
  const j = { id: "JOB-WEB-1", title: "Carpentry & Joinery job, Kingston" };
  assert(jobLabel(j) === "Carpentry & Joinery, Kingston (JOB-WEB-1)", jobLabel(j));
  assert(jobLabel(j, false) === "Carpentry & Joinery, Kingston", jobLabel(j, false));
  assert(jobLabel({ id: "JOB-2", title: "Painting job" }) === "Painting (JOB-2)");
  assert(jobLabel({ id: "JOB-3", title: "Fix the job site gate" }) === "Fix the job site gate (JOB-3)");
  assert(jobLabel({ id: "JOB-4", title: null }) === "JOB-4");
  assert(!src.includes('"your job"'), "a missing title still reads your job your job");
});
