// The six services other than the Deposit Protection Check. These pin the
// promises the briefs make, so a later edit that loosens one goes red.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { BRIEFS_EXTRA, EXTRA_KINDS, PROPERTY_CARE_CHECKLIST, sectionsFor } from "./kinds.ts";

const id = (v: unknown) => String(v ?? "").trim();
type F = { ord: number; heading: string; body: string; why: string | null; action: string | null };
const finding = (ord: number): F => ({ ord, heading: "h", body: "b", why: "why", action: "act" });

Deno.test("every service has a brief, and none carries a dash", () => {
  for (const k of ["condition", "technical_signoff", "visual_check", ...EXTRA_KINDS]) {
    assert(BRIEFS_EXTRA[k], `no brief for ${k}`);
    assert(!/[–—]/.test(BRIEFS_EXTRA[k]), `${k} brief carries a dash`);
  }
});

Deno.test("no brief asks for a rating, a result, a status or money", () => {
  for (const [k, b] of Object.entries(BRIEFS_EXTRA)) {
    assert(!/"severity"|"rating"|"result"|"status"\s*:|"money"|"price"|"cost"/.test(b), `${k} brief asks for a judgement or a figure`);
  }
});

Deno.test("a Visual Check never carries why or what to do", () => {
  const fs = [finding(1), finding(2)];
  sectionsFor("visual_check", { sections: {} }, fs, id);
  assertEquals(fs.map((f) => [f.why, f.action]), [[null, null], [null, null]]);
});

Deno.test("a Property Care visit carries a suggested next step but no why", () => {
  const fs = [finding(1)];
  sectionsFor("property_care", { sections: {} }, fs, id);
  assertEquals([fs[0].why, fs[0].action], [null, "act"]);
});

Deno.test("the Property Care checklist is the house list, whatever the model sends", () => {
  const sx = sectionsFor("property_care", { sections: { checklist: [{ state: "on_fire", since: "later", note: "n" }] } }, [], id) as { checklist: { item: string; state: string; since: string }[] };
  assertEquals(sx.checklist.length, PROPERTY_CARE_CHECKLIST.length);
  assertEquals(sx.checklist[0].state, "not_recorded");
  assertEquals(sx.checklist[0].since, "");
  assertEquals(sx.checklist[0].item, PROPERTY_CARE_CHECKLIST[0].item);
});

Deno.test("an unknown element falls back rather than being guessed", () => {
  const sx = sectionsFor("condition", { sections: { finding_refs: [{ element: "kitchen" }] } }, [finding(1)], id) as { finding_refs: { element: string }[] };
  assertEquals(sx.finding_refs[0].element, "external");
});

Deno.test("a sign-off check reference outside the list is dropped", () => {
  const sx = sectionsFor("technical_signoff", { sections: { checks: [{ what: "a" }], finding_refs: [{ check: 7 }] } }, [finding(1)], id) as { finding_refs: { check: number | null }[] };
  assertEquals(sx.finding_refs[0].check, null);
});
