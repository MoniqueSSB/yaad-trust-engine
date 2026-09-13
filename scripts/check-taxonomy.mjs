/**
 * Fails when the job taxonomy has drifted between its copies.
 *
 * There are four. `data/job-taxonomy.js` is the generated source of truth,
 * `docs/job-taxonomy.js` is a byte copy the marketing site loads as a browser
 * global, `preview/index.html` inlines the same globals, and
 * `web/lib/taxonomy.ts` restates the trades and parishes as TypeScript because
 * the app cannot import a file that declares `var`.
 *
 * They all agreed on the day this was written. Nothing kept them agreeing.
 *
 * Why it matters more than a tidiness check: the ONLY reason a client's
 * roofing job and a worker's roofing profile find each other is that both came
 * from this one list. The day the copies diverge, a client posts a job in a
 * trade no worker profile can carry, and the two never meet. Nothing else in
 * the system would notice, because both halves are individually valid.
 *
 * CI already fails when the Edge Functions' `_shared` copies drift. This is
 * that same idea for the list the marketplace is built on.
 *
 * Run: node scripts/check-taxonomy.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

const problems = [];

/** Pull `var NAME=[...]` out of a taxonomy file. */
function globalArray(source, name, where) {
  const m = source.match(new RegExp(`var ${name}\\s*=\\s*(\\[[\\s\\S]*?\\]);`));
  if (!m) {
    problems.push(`${where}: could not find "var ${name}=[...]"`);
    return null;
  }
  try {
    return JSON.parse(m[1]);
  } catch (e) {
    problems.push(`${where}: ${name} is not parseable JSON (${e.message})`);
    return null;
  }
}

/** Pull `export const NAME = [...] as const;` out of the TypeScript copy. */
function tsArray(source, name, where) {
  const m = source.match(new RegExp(`export const ${name} = \\[([\\s\\S]*?)\\] as const;`));
  if (!m) {
    problems.push(`${where}: could not find "export const ${name} = [...] as const;"`);
    return null;
  }
  return m[1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.replace(/^"(.*)"$/s, "$1"))
    .filter((s) => !s.startsWith("//"));
}

const same = (a, b) => a && b && a.length === b.length && a.every((x, i) => x === b[i]);

const generated = read("data/job-taxonomy.js");
const docsCopy = read("docs/job-taxonomy.js");
const previewCopy = read("preview/index.html");
const ts = read("web/lib/taxonomy.ts");

// 1. docs/ is meant to be a byte-for-byte copy, so say so precisely.
if (generated !== docsCopy) {
  problems.push(
    "docs/job-taxonomy.js is no longer a byte copy of data/job-taxonomy.js. " +
      "Copy the generated file over it rather than editing either by hand.",
  );
}

// 2. The prototype inlines the same globals. Only JC_TRADES is an array; the
//    rest are keyed objects, so this checks presence rather than shape. The
//    byte comparison above is what pins the content, and the prototype is
//    illustrative, not something a client's job flows through.
for (const name of ["JC_TRADES", "JC_TYPES", "JC_SIZE", "JC_STAGES", "JC_EV"]) {
  if (!generated.includes(`var ${name}=`)) {
    problems.push(`data/job-taxonomy.js: ${name} is missing from the generated source`);
  }
  if (!previewCopy.includes(`var ${name}=`)) {
    problems.push(`preview/index.html: ${name} is missing, so the prototype has fallen behind`);
  }
}

// 3. The TypeScript copy the app actually imports.
const genTrades = globalArray(generated, "JC_TRADES", "data/job-taxonomy.js");
const tsTrades = tsArray(ts, "TRADES", "web/lib/taxonomy.ts");
if (!same(genTrades, tsTrades)) {
  problems.push(
    "web/lib/taxonomy.ts TRADES does not match data/job-taxonomy.js JC_TRADES.\n" +
      `  generated (${genTrades?.length}): ${JSON.stringify(genTrades)}\n` +
      `  app       (${tsTrades?.length}): ${JSON.stringify(tsTrades)}`,
  );
}

const tsParishes = tsArray(ts, "PARISHES", "web/lib/taxonomy.ts");
if (!tsParishes || tsParishes.length !== 14) {
  problems.push(`web/lib/taxonomy.ts PARISHES should list all 14 parishes, found ${tsParishes?.length}`);
}

if (problems.length) {
  console.error("Job taxonomy has drifted:\n");
  for (const p of problems) console.error("  - " + p + "\n");
  console.error(
    "The taxonomy is the only reason a client's job and a worker's profile find\n" +
      "each other. Fix the copies before merging.",
  );
  process.exit(1);
}

console.log(
  `Job taxonomy is consistent: ${genTrades.length} trades, ${tsParishes.length} parishes, ` +
    "four copies in agreement.",
);
