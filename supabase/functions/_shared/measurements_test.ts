// The measurement rule, tested.
//
// Written 5 September 2026, after the rule was tested by hand for the first
// time since August and let twelve measurements out of twenty-nine straight
// through. Nothing was wrong with the layers. The pattern was narrower than
// the sentence everybody believed it enforced, and nothing ran on any push to
// say so.
//
// Two things are proved here:
//   1. the pattern catches what it must and leaves ordinary condition notes
//      alone, case by case, sentence by sentence
//   2. the Postgres copy of it is character for character the same rule
//
// The second is the one that rots. The first is the one that was wrong.

import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  MEASUREMENT_PATTERN,
  MEASUREMENT_QUOTE_PATTERN,
  hasMeasurement,
  scrub,
} from "./measurements.ts";

// [sentence, is it stating a measurement, what it is testing]
const CASES: [string, boolean, string][] = [
  // ── digits and a unit ──
  ["Rear wall approximately 3.5m long", true, "no space"],
  ["Crack runs about 40 cm down the column", true, "space before the unit"],
  ["Ceiling height 8 ft", true, "feet abbreviated"],
  ["Room is roughly 12 feet by 10 feet", true, "two numbers in one sentence"],
  ["Gap of 2 inches under the door", true, "inches"],
  ["Floor area around 200 sq ft", true, "area"],
  ["Roughly 18 m2 of tiling", true, "square metres, shorthand"],
  ["Skirting damaged for 1.2 metres", true, "decimal"],
  ["Veranda is 3.5M deep", true, "capital unit"],
  ["Tiled area is 4,5 m", true, "decimal comma"],
  ["Zinc sheet 2.4m x 1.2m on the roof", true, "two dimensions on one line"],
  ["Crack about 0.5 sq.m across the slab", true, "sq with a full stop"],
  ["Around 15 square metres of rendering", true, "unit spelled out"],
  ["The 15m2 room was not filmed", true, "no separator at all"],
  ["Ceiling void is 3 m deep", true, "non-breaking space before the unit"],

  // ── the hyphen. All three missed until 5 September 2026, and this is
  //    the phrasing a fluent model actually produces.
  ["Ceiling is 9-foot high", true, "hyphen, foot"],
  ["A 2-metre crack down the column", true, "hyphen, metre"],
  ["A 10-ft run of skirting", true, "hyphen, ft"],

  // ── the number written as a word ──
  ["The room is twelve feet by ten feet", true, "word number"],
  ["Crack about half a metre long", true, "half a"],
  ["Roughly one metre of missing skirting", true, "one"],
  ["Two and a half metres of coping is loose", true, "and a half"],
  ["Three-quarter inch pipe feeding the tank", true, "a pipe size is still a size"],

  // ── units that were simply not on the list ──
  ["Plot is about 0.25 acres", true, "acres"],
  ["About 30 yds of fencing", true, "yds"],
  ["Around 20 sq yards of paving", true, "square yards"],
  ["Floor is 120 ft2 of tiling", true, "ft2"],
  ["Rear boundary runs 0.2 km", true, "km"],

  // ── feet and inch marks ──
  ["Opening measures 6'", true, "foot mark at the end of the sentence"],
  ["Doorway 6'6\" clear", true, "feet and inches together"],
  ["An 8\" pipe runs along the wall", true, "inch mark"],

  // ── ordinary condition notes. None of these may be touched. ──
  ["Two hairline cracks above the window", false, "size in words, no unit"],
  ["1 in 5 tiles is cracked", false, "the classic false positive, bare in is not a unit"],
  ["Three sockets, one with a damaged faceplate", false, "a count"],
  ["Water staining on the ceiling, worse in the corner", false, "plain prose"],
  ["Rust visible on the zinc, front slope", false, "plain prose"],
  ["Second bedroom, north side", false, "an ordinal"],
  ["Paint flaking around 4 windows", false, "a bare number"],
  ["Bathroom on the 1st floor", false, "a floor number"],
  ["Sealant missing on the right column", false, "plain prose"],
  ["Full height crack beside the door frame", false, "the correct way to say a size"],
  ["Photo 3 of 12, rear elevation", false, "counts"],
  ["Meter box on the outside wall is damaged", false, "meter, the thing on the wall"],
  ["Two meters on the outside wall, one cracked", false, "two of them, still not a measurement"],
  ["Damp at the foot of the wall", false, "foot without a number in front of it"],
  ["The roof is in poor condition throughout", false, "plain prose"],
  ["Most of the ceiling is stained", false, "the wording the prompt asks for instead"],
  ["1970s block construction", false, "a decade"],
  ["Grade 2 timber used on the veranda", false, "a grade, not a size"],
];

Deno.test("every measurement in the list is caught", () => {
  const missed = CASES.filter(([t, is]) => is && !hasMeasurement(t)).map(([t]) => t);
  assertEquals(missed, [], `these state a dimension and got through: ${missed.join(" | ")}`);
});

Deno.test("no ordinary condition note is flagged", () => {
  const wrong = CASES.filter(([t, is]) => !is && hasMeasurement(t)).map(([t]) => t);
  assertEquals(wrong, [], `these are clean and were flagged: ${wrong.join(" | ")}`);
});

Deno.test("scrubbing removes the number and leaves a readable sentence", () => {
  const hits: string[] = [];
  assertEquals(scrub("Rear wall approximately 3.5m long", hits), "Rear wall approximately [size removed] long");
  assertEquals(scrub("A 2-metre crack down the column", hits), "A [size removed] crack down the column");
  assertEquals(scrub("Floor area around 200 sq ft", hits), "Floor area around [size removed]");
  assertEquals(scrub("The room is twelve feet by ten feet", hits), "The room is [size removed] by [size removed]");
  // 6' used to survive its own scrub and sit there in the sentence.
  assertEquals(scrub("Doorway 6'6\" clear", hits), "Doorway [size removed] clear");
  assertEquals(scrub("Opening measures 6'", hits), "Opening measures [size removed]");
  assertEquals(hits.length, 6, "every scrubbed sentence is reported to the desk, never silently fixed");
});

Deno.test("scrubbing leaves a clean sentence exactly as it was", () => {
  const hits: string[] = [];
  const clean = "Two hairline cracks above the window, 1 in 5 tiles cracked";
  assertEquals(scrub(clean, hits), clean);
  assertEquals(hits.length, 0);
});

Deno.test("nothing scrubbed still states a measurement", () => {
  const hits: string[] = [];
  for (const [txt] of CASES) {
    const after = scrub(txt, hits);
    assert(!hasMeasurement(after), `scrub left a measurement behind: ${txt} -> ${after}`);
  }
});

// ── the drift check ──
//
// The Postgres copy is the layer that refuses an approval, and it is the copy
// no test can reach from here. So this reads the SQL out of the migration and
// compares it to the string above, character for character. The migration
// writes both patterns inside $re$ ... $re$ dollar quotes for exactly this
// reason: no escaping, so the two files carry identical text.
Deno.test("the Postgres copy of the rule is the same rule", () => {
  const dir = new URL("../../migrations/", import.meta.url);
  const files = [...Deno.readDirSync(dir)]
    .filter((e) => e.isFile && e.name.endsWith(".sql"))
    .map((e) => e.name)
    .sort();

  const defining = files.filter((name) =>
    Deno.readTextFileSync(new URL(name, dir)).includes("function public.has_measurement")
  );
  assert(defining.length > 0, "no migration defines has_measurement()");

  // The newest definition is the one the database is running.
  const newest = defining[defining.length - 1];
  const sql = Deno.readTextFileSync(new URL(newest, dir));
  // From the definition onwards, so a dollar quote mentioned in the migration's
  // own header comment is not mistaken for the rule itself.
  const body = sql.slice(sql.indexOf("function public.has_measurement"));
  const quoted = [...body.matchAll(/\$re\$([\s\S]*?)\$re\$/g)].map((m) => m[1]);

  assertEquals(
    quoted.length,
    2,
    `${newest} should carry exactly two $re$ quoted patterns, found ${quoted.length}`,
  );
  assertEquals(
    quoted[0],
    MEASUREMENT_PATTERN,
    `the measurement pattern in ${newest} has drifted from _shared/measurements.ts`,
  );
  assertEquals(
    quoted[1],
    MEASUREMENT_QUOTE_PATTERN,
    `the feet and inches pattern in ${newest} has drifted from _shared/measurements.ts`,
  );
});
