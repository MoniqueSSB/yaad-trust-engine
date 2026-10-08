// Builds a filled sample of each report a client can book today, from the
// blank templates in services/, so a prospect can see exactly what they get
// before they pay. Every client, property, person and finding in them is
// invented, and each one says so on its first page and on every page.
//
//   cd scripts/report-templates && npm ci && node samples.js <out dir>
//
// Writes "[C] <Service>, Sample Report.pdf" and ".docx" into <out dir>.
// Refuses to build anything the gate rejects, the same as the templates.
// Added 8 October 2026 on Monique's instruction: no sample report was to be
// promised to a lead until one existed.
const fs = require("fs");
const path = require("path");
const { screen } = require("./gate");
const { build } = require("./render");

// The services on yaadly.co.uk/services, in the order the page lists them.
const SAMPLES = [
  { slug: "project-setup-check", file: "project-setup-check" },
  { slug: "visual-check", file: "visual-check" },
  { slug: "condition-report", file: "condition" },
  { slug: "property-care", file: "property-care" },
  { slug: "oversight-retainer", file: "oversight" },
].map((s) => ({ ...s, doc: require("./samples/" + s.file) }));

(async () => {
  const out = process.argv[2];
  if (!out) { console.error("Usage: node samples.js <out dir>"); process.exit(1); }
  const problems = await screen(SAMPLES);
  if (problems.length) {
    console.error(problems.join("\n"));
    console.error(`\n${problems.length} problem(s). No sample was built.`);
    process.exit(1);
  }
  fs.mkdirSync(out, { recursive: true });
  for (const s of SAMPLES) {
    const name = `[C] ${s.doc.service}, Sample Report`;
    const tmp = path.join(require("os").tmpdir(), "yaadly-sample-" + s.slug);
    await build(s.doc, path.dirname(tmp), path.basename(tmp));
    for (const ext of [".pdf", ".docx"]) { fs.copyFileSync(tmp + ext, path.join(out, name + ext)); fs.unlinkSync(tmp + ext); }
    const pages = (fs.readFileSync(path.join(out, name + ".pdf")).toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
    console.log(`${name}: ${pages} pages`);
  }
})().catch((e) => { console.error(e); process.exit(1); });
