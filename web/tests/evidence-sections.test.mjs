/**
 * Tests for the evidence sections a client reads a job in.
 *
 * The grouping is the part of this that a client sees, and the properties that
 * matter are the ones that would quietly overstate the record if they broke:
 *
 *   - materials is read off kind and is NEVER a phase, so an item that somehow
 *     carried both must not appear twice, once in its own section and once
 *     under a phase heading;
 *   - anything nobody marked lands under a heading that says so, rather than
 *     being folded into a real section and counted as proof;
 *   - an empty section is not drawn, so a stage with no problems looks like a
 *     stage with no problems;
 *   - the order is the order of the work, not the order the files arrived.
 *
 * The vocabulary and the grouping live together in lib/portal, deliberately:
 * the ledger component draws them, it does not decide them.
 *
 * Run: npm test   (from web/)
 */
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(join(HERE, "ts-resolve-hooks.mjs")));

let sections;
let sectionsOf;
before(async () => {
  sections = await import(
    pathToFileURL(join(HERE, "../lib/portal/evidence-sections.ts")).href
  );
  sectionsOf = sections.sectionsOf;
});

/** The shape the ledger actually holds, trimmed to what grouping reads. */
const item = (id, phase, kind = "work") => ({
  id,
  phase,
  kind,
  label: id,
  img: null,
  ok: null,
  created_at: null,
  sha256: null,
  stage: 1,
});

describe("the evidence section vocabulary", () => {
  test("is the order of the work, not alphabetical", () => {
    assert.deepEqual(sections.EVIDENCE_PHASES, [
      "before",
      "during",
      "issue",
      "after",
    ]);
  });

  test("every phase has a badge, a heading, an option and a note", () => {
    for (const ph of sections.EVIDENCE_PHASES) {
      for (const map of [
        sections.PHASE_BADGE,
        sections.PHASE_HEADING,
        sections.PHASE_OPTION,
        sections.PHASE_NOTE,
      ]) {
        assert.ok(
          typeof map[ph] === "string" && map[ph].length > 0,
          `${ph} is missing a word somewhere`,
        );
      }
    }
  });

  test("a problem is called a problem to the reader, never 'issue'", () => {
    // 'issue' is the value stored in the column. It is not a word anybody says
    // on a building site, and the client should never read it.
    assert.equal(sections.PHASE_BADGE.issue, "Problem");
    assert.match(sections.PHASE_HEADING.issue, /Problem/);
    assert.match(sections.PHASE_OPTION.issue, /problem/i);
  });

  test("the problems note tells the client what happens about the money", () => {
    // A problem found on site is the thing that changes what the job is. The
    // client reading this section has to be told, in the same breath, that a
    // change to price or timeline is agreed with them first.
    assert.match(sections.PHASE_NOTE.issue, /writing/i);
    assert.match(sections.PHASE_NOTE.issue, /price|timeline/i);
  });

  test("the unmarked heading admits what it is", () => {
    assert.match(sections.UNMARKED_HEADING, /not marked/i);
  });
});

describe("isPhase", () => {
  test("accepts exactly the four declared words", () => {
    for (const ph of ["before", "during", "issue", "after"]) {
      assert.equal(sections.isPhase(ph), true, ph);
    }
  });

  test("rejects anything nobody declared, including near misses", () => {
    for (const v of [
      null,
      undefined,
      "",
      "maybe",
      "materials",
      "Before",
      "before ",
      "BEFORE",
      "problem",
      0,
      {},
    ]) {
      assert.equal(sections.isPhase(v), false, String(v));
    }
  });
});

describe("phaseBadge", () => {
  test("materials wins over any phase, so nothing is ever double counted", () => {
    // The database constraint refuses this combination outright. The badge
    // still has to have an answer for it, because a row that somehow carried
    // both must resolve to one section rather than appearing in two.
    assert.equal(sections.phaseBadge("before", "materials"), "Materials");
    assert.equal(sections.phaseBadge(null, "materials"), "Materials");
  });

  test("reads the declared phase on ordinary work", () => {
    assert.equal(sections.phaseBadge("before", "work"), "Before");
    assert.equal(sections.phaseBadge("during", "work"), "During");
    assert.equal(sections.phaseBadge("issue", "work"), "Problem");
    assert.equal(sections.phaseBadge("after", "work"), "After");
  });

  test("is silent when nobody said, rather than guessing", () => {
    assert.equal(sections.phaseBadge(null, "work"), null);
    assert.equal(sections.phaseBadge(undefined, undefined), null);
    assert.equal(sections.phaseBadge("", "work"), null);
    // The label is not read. This is the whole point of the column.
    assert.equal(sections.phaseBadge("the joint before work", "work"), null);
  });
});

describe("sectionsOf, the grouping a client actually reads", () => {
  test("returns the sections in the order of the work", () => {
    const out = sectionsOf([
      item("d", "after"),
      item("c", "issue"),
      item("b", "during"),
      item("a", "before"),
    ]);
    assert.deepEqual(
      out.map((s) => s.key),
      ["before", "during", "issue", "after"],
    );
  });

  test("drops empty sections rather than drawing an empty box", () => {
    const out = sectionsOf([item("a", "before"), item("b", "after")]);
    assert.deepEqual(
      out.map((s) => s.key),
      ["before", "after"],
    );
  });

  test("materials is its own section and is read off kind, not phase", () => {
    const out = sectionsOf([
      item("a", "before"),
      item("m", null, "materials"),
    ]);
    assert.deepEqual(
      out.map((s) => s.key),
      ["before", "materials"],
    );
  });

  test("materials comes after the work, and unmarked comes last", () => {
    const out = sectionsOf([
      item("u", null),
      item("m", null, "materials"),
      item("a", "after"),
    ]);
    assert.deepEqual(
      out.map((s) => s.key),
      ["after", "materials", "unmarked"],
    );
  });

  test("nothing is ever counted twice", () => {
    // Including the combination the database refuses. If a materials row ever
    // arrived carrying a phase, it must land in one section, not two, or the
    // client is shown the same photograph as two different things.
    const items = [
      item("a", "before"),
      item("b", "during"),
      item("c", "issue"),
      item("d", "after"),
      item("e", null),
      item("m", "before", "materials"),
    ];
    const out = sectionsOf(items);
    const ids = out.flatMap((s) => s.items.map((i) => i.id));
    assert.equal(ids.length, items.length);
    assert.equal(new Set(ids).size, items.length);
    assert.equal(
      out.find((s) => s.key === "materials").items[0].id,
      "m",
    );
    assert.equal(out.find((s) => s.key === "before").items.length, 1);
  });

  test("an unrecognised phase is unmarked, never silently dropped", () => {
    // A value nobody declared must still reach the page. Losing it would mean
    // a client seeing fewer photographs than were filed.
    const out = sectionsOf([item("x", "maybe"), item("y", "")]);
    assert.deepEqual(
      out.map((s) => s.key),
      ["unmarked"],
    );
    assert.equal(out[0].items.length, 2);
  });

  test("nothing filed at all is no sections, not one empty one", () => {
    assert.deepEqual(sectionsOf([]), []);
  });
});
