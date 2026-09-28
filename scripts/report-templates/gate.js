// The gate every template passes before it is built, and in CI on every push.
//
// A template is page copy that a client ends up holding, so it meets the same
// two screens a drafted report meets: no measurement (a phone photograph has
// no scale, and measured work for reward is regulated in Jamaica) and no
// banned language. Both screens are imported from supabase/functions/_shared,
// never copied, so this cannot drift from what the report agent enforces.
// Written 28 September 2026, after the first set of templates asked for crack
// widths in millimetres and would have been refused at issue every time.
//
// Also: no em dash or en dash anywhere, which is a house writing rule.
//
//   node scripts/report-templates/gate.js
const path = require("path");
const { pathToFileURL } = require("url");

const SHARED = path.join(__dirname, "..", "..", "supabase", "functions", "_shared");

// Every string a template could print, with where it sits.
function* strings(v, where) {
  if (typeof v === "string") yield [v, where];
  else if (Array.isArray(v)) for (const [i, x] of v.entries()) yield* strings(x, `${where}[${i}]`);
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) yield* strings(x, `${where}.${k}`);
}

async function check() {
  const { hasMeasurement } = await import(pathToFileURL(path.join(SHARED, "measurements.ts")).href);
  const guardrails = await import(pathToFileURL(path.join(SHARED, "guardrails.ts")).href);
  const templates = require("./services");
  const problems = [];
  for (const t of templates) {
    for (const [text, where] of strings(t.doc, t.slug)) {
      if (hasMeasurement(text)) problems.push(`${where}: states a measurement: "${text.slice(0, 120)}"`);
      for (const b of guardrails.scan(text)) problems.push(`${where}: banned language (${b.term}): ${b.guidance}`);
      if (/[–—]/.test(text)) problems.push(`${where}: carries a dash`);
    }
  }
  return { templates, problems };
}

module.exports = { check };

if (require.main === module) {
  check().then(({ templates, problems }) => {
    if (problems.length) {
      console.error(problems.join("\n"));
      console.error(`\n${problems.length} problem(s). The templates were not built.`);
      process.exit(1);
    }
    console.log(`${templates.length} templates: no measurement, no banned language, no dashes.`);
  }).catch((e) => { console.error(e); process.exit(1); });
}
