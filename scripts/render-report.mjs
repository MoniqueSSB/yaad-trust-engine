#!/usr/bin/env node
// Turn a drafted report into the document the client actually receives, on a
// laptop, with no desk.
//
// Until 28 September 2026 this file carried its own copy of the document
// template, and the desk carried another, with a comment asking whoever
// touched one to keep the other in step by hand. They drifted within a day:
// the desk grew a document the client could read and this copy did not. So
// this no longer has a template. It lifts the renderer out of
// concierge/concierge.html, the same functions the desk's "Open the
// document" button runs, and calls them. One template, two ways to print it.
//
// This is deliberately NOT an agent and it holds no model call. Everything it
// prints was either written by the drafting agent and already screened, typed
// by a named person, or is the house standard fixed in the renderer.
//
//   node scripts/render-report.mjs <input.json> [--out <dir>] [--no-pdf]
//
// The input is the rows as they sit in Postgres, nothing reshaped:
//   { "report": <the reports row, sections and all>, "findings": [<report_findings rows>] }
// scripts/report-example.json is a worked example with invented data. PDF is
// produced by headless Chrome, which is on every Mac this is run from;
// --no-pdf stops at the HTML.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

// The pieces of the desk the renderer needs, by the line each one starts
// with. If a name here stops matching, this fails loudly rather than
// printing a document from half a template.
const PIECES = [
  ["const esc = ", "\n"],
  ["const RPT_LOGO = ", "\n"],
  ["const RPT_SERVICE = ", "\n"],
  ["const RPT_STATE = ", "\n"],
  ["const RPT_RESULT = ", "\n// The two record only services"],
  ["const RPT_MONEY = ", "\nfunction rptMoneyAsk"],
  ["const RPT_DOC_CSS = ", "\n// ---------------------------------------------------------------- the six"],
  ["const RPT_KEYS = ", "\nfunction reportDocumentHtml"],
  ["function reportDocumentHtml(", "\nconst RPT_DEP_CSS"],
  ["const RPT_DEP_CSS = ", "\nconst QPR_FN"],
];

export function loadRenderer() {
  const desk = readFileSync(join(REPO, "concierge", "concierge.html"), "utf8");
  const code = PIECES.map(([start, end]) => {
    const i = desk.indexOf(start);
    const j = i < 0 ? -1 : desk.indexOf(end, i + start.length);
    if (i < 0 || j < 0) throw new Error(`render-report: could not find "${start.trim()}" in concierge.html. The desk's renderer has moved; update PIECES.`);
    return desk.slice(i, j);
  }).join("\n");
  return new Function(`${code}\nreturn reportDocumentHtml;`)();
}

const args = process.argv.slice(2);
const input = args.find((a) => !a.startsWith("--") && !(args[args.indexOf(a) - 1] === "--out"));
if (!input) {
  console.error("usage: node scripts/render-report.mjs <input.json> [--out <dir>] [--no-pdf]");
  process.exit(1);
}
const outDir = args.includes("--out") ? args[args.indexOf("--out") + 1] : dirname(resolve(input));
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

const data = JSON.parse(readFileSync(input, "utf8"));
if (!data.report || !Array.isArray(data.findings)) {
  console.error('The input needs { "report": {...}, "findings": [...] }, the rows as they are in Postgres. See scripts/report-example.json.');
  process.exit(1);
}
const html = loadRenderer()(data.report, data.findings);
const stem = (data.report.number || "report-draft").replace(/[^A-Za-z0-9._-]/g, "-");
const htmlPath = join(outDir, `${stem}.html`);
writeFileSync(htmlPath, html);
console.log("html ->", htmlPath);

if (!args.includes("--no-pdf")) {
  if (!existsSync(CHROME)) {
    console.error("Chrome not found, so no PDF. Open the HTML and print to PDF, or pass --no-pdf.");
    process.exit(0);
  }
  const pdfPath = join(outDir, `${stem}.pdf`);
  execFileSync(CHROME, [
    "--headless", "--disable-gpu", "--no-pdf-header-footer",
    `--print-to-pdf=${pdfPath}`, `file://${htmlPath}`,
  ], { stdio: "pipe" });
  console.log("pdf  ->", pdfPath);
}
