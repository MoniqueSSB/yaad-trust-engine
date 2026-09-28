// Builds every blank report template into concierge/templates, where the desk
// lists them under Reports, and copies them into the desk's deploy folder.
//
//   cd scripts/report-templates && npm ci && node build.js [--hub <dir>]
//
// --hub also writes "[C] <Service>, Report Template" copies into a folder of
// Monique's (the YaadlyHub business folder), which is where she first asked
// for them. Needs Google Chrome for the PDFs. Refuses to build anything the
// gate rejects: see gate.js.
const fs = require("fs");
const path = require("path");
const { check } = require("./gate");
const { build } = require("./render");

const REPO = path.join(__dirname, "..", "..");
const OUT = path.join(REPO, "concierge", "templates");
const DEPLOY = path.join(REPO, "concierge-deploy", "public", "templates");

(async () => {
  const { templates, problems } = await check();
  if (problems.length) {
    console.error(problems.join("\n"));
    console.error(`\n${problems.length} problem(s). Nothing was built.`);
    process.exit(1);
  }
  const hubAt = process.argv.indexOf("--hub");
  const hub = hubAt > 0 ? process.argv[hubAt + 1] : null;
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(DEPLOY, { recursive: true });

  const index = [];
  for (const t of templates) {
    await build(t.doc, OUT, t.slug);
    const pdf = fs.readFileSync(path.join(OUT, t.slug + ".pdf"));
    const pages = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
    for (const ext of [".pdf", ".docx"]) fs.copyFileSync(path.join(OUT, t.slug + ext), path.join(DEPLOY, t.slug + ext));
    if (hub) {
      const name = t.kind ? `[C] ${t.doc.service}, Report Template` : `[C] ${t.doc.service}, Template`;
      for (const ext of [".pdf", ".docx"]) fs.copyFileSync(path.join(OUT, t.slug + ext), path.join(hub, name + ext));
    }
    index.push({ slug: t.slug, kind: t.kind, service: t.doc.service, title: t.doc.title, pages });
    console.log(`${t.slug}: ${pages} pages`);
  }
  const json = JSON.stringify(index, null, 2) + "\n";
  fs.writeFileSync(path.join(OUT, "index.json"), json);
  fs.writeFileSync(path.join(DEPLOY, "index.json"), json);
})().catch((e) => { console.error(e); process.exit(1); });
