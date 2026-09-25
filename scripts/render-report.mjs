#!/usr/bin/env node
// Turn a drafted report into the document the client actually receives.
//
// Until 25 September 2026 nothing in this repository produced a document.
// yaad-report drafted findings into Postgres, the desk rated them and issued a
// number, and that was the end of it: issuing changed a status and made no
// artefact at all. Three of the seven priced services ARE a document, so the
// deliverable did not exist.
//
// This is deliberately NOT an agent and it holds no model call. Everything it
// prints was either written by the drafting agent and already screened, or
// typed by a named person. A renderer that could write a sentence would be a
// second place for an unrated judgment to get into a client's hands.
//
//   node scripts/render-report.mjs <input.json> [--out <dir>] [--no-pdf]
//
// The input is the report, its findings and the checklist states. There is a
// worked example in the RUNBOOK. PDF is produced by headless Chrome, which is
// on every Mac this is run from; --no-pdf stops at the HTML.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const SERVICE_NAMES = {
  deposit_check: "Deposit Protection Check",
  condition: "Condition Report",
  technical_signoff: "Technical Sign-off",
  visual_check: "Visual Check",
};

// The checklist is the house standard for the service, not something the agent
// decides. It is here rather than in the model's hands on purpose: a client
// paying for a review is owed the same list every time, including the lines
// where nothing was wrong. "Not provided" on a line is a finding of its own.
const CHECKLISTS = {
  deposit_check: [
    ["Contractor named on the quote", "identity"],
    ["Business registration or TRN", "identity"],
    ["Verifiable address and a number other than WhatsApp", "identity"],
    ["Independent trace of the business", "identity"],
    ["Quote in writing and dated", "the quote"],
    ["Quote itemised by element of work", "the quote"],
    ["Labour and materials separated", "the quote"],
    ["Quantities and specification stated", "the quote"],
    ["Who supplies the materials", "materials"],
    ["Who owns the materials once paid for", "materials"],
    ["Who receives deliveries on site", "materials"],
    ["Payment structure written down", "money"],
    ["What the client is exposed to at each stage", "money"],
    ["Receipt for anything already paid", "money"],
    ["Insurance held by the contractor", "risk"],
    ["Start date, working duration and completion date", "programme"],
    ["What happens if the contractor is late", "programme"],
    ["What happens if the client stops the work", "programme"],
  ],
};

const STATES = {
  confirmed:     ["Confirmed",     "ok"],
  provided:      ["Provided",      "ok"],
  not_provided:  ["Not provided",  "gap"],
  not_found:     ["Not found",     "gap"],
  referred:      ["Referred on",   "ref"],
  not_applicable:["Not applicable","na"],
};

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function logoDataUri() {
  const p = join(REPO, "brand", "yaadly-logo-master.png");
  if (!existsSync(p)) return null;
  return "data:image/png;base64," + readFileSync(p).toString("base64");
}

function page(d) {
  const kind = d.report.kind;
  const service = SERVICE_NAMES[kind] || kind;
  const issued = Boolean(d.report.number);
  const logo = logoDataUri();
  const items = (CHECKLISTS[kind] || []).map((row, i) => {
    const state = d.checklist?.[i]?.state || "not_provided";
    const [label, tone] = STATES[state] || STATES.not_provided;
    return { text: row[0], group: row[1], label, tone, note: d.checklist?.[i]?.note || "" };
  });
  const groups = [];
  for (const it of items) {
    if (!groups.length || groups[groups.length - 1].name !== it.group) groups.push({ name: it.group, rows: [] });
    groups[groups.length - 1].rows.push(it);
  }

  const sev = (f) => f.severity
    ? `<div class="sev s-${esc(f.severity)}">${esc(f.severity)}</div>`
    : `<div class="sev blankchip">rating to add</div>`;

  return `<!doctype html>
<html lang="en-GB"><head><meta charset="utf-8">
<title>${esc(service)}${d.report.number ? ", " + esc(d.report.number) : ", draft"}</title>
<style>
  :root{
    --ink:#15161c; --mute:#5c6070; --line:#dcdde5; --wash:#f7f7fa;
    --mango:#c77a17; --teal:#0f6b63; --coral:#b3372f;
    --disp:"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif;
    --body:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;
    --mono:ui-monospace,SFMono-Regular,Menlo,monospace;
  }
  @page{size:A4;margin:20mm 16mm 18mm}
  *{box-sizing:border-box}
  body{margin:0;color:var(--ink);font-family:var(--body);font-size:10.6pt;line-height:1.55;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  table.doc{width:100%;border-collapse:collapse} table.doc td{padding:0}
  table.doc thead{display:table-header-group}
  .runhead{display:flex;align-items:center;gap:9px;border-bottom:1.6pt solid var(--ink);padding-bottom:5px;margin-bottom:8mm}
  .runhead img{width:8.5mm;height:8.5mm;object-fit:contain}
  .runhead .wm{font-family:var(--disp);font-size:14pt;letter-spacing:-0.01em}
  .runhead .wm span{color:var(--mango)}
  .runhead .svc{margin-left:auto;font:600 7.6pt/1 var(--mono);text-transform:uppercase;letter-spacing:.12em;color:var(--mute);text-align:right}
  .body{padding-top:0}
  .draftbar{background:#fff6e6;border:1pt solid #e8cf9a;border-left:3pt solid var(--mango);padding:8px 12px;border-radius:2pt;font-size:9pt;margin-bottom:16px}
  h1{font-family:var(--disp);font-weight:400;font-size:23pt;line-height:1.1;margin:4px 0 16px;letter-spacing:-0.015em}
  .meta{display:grid;grid-template-columns:1fr 1fr 1fr;gap:1px 18px;background:var(--wash);border:1pt solid var(--line);border-radius:2pt;padding:11px 14px;margin-bottom:20px}
  .meta div{padding:3px 0}
  .meta dt{font:600 7.2pt/1 var(--mono);text-transform:uppercase;letter-spacing:.1em;color:var(--mute);margin-bottom:2px}
  .meta dd{margin:0;font-size:10pt}
  h2{font-family:var(--disp);font-weight:400;font-size:14.5pt;margin:24px 0 10px;padding-bottom:5px;border-bottom:1pt solid var(--line)}
  h2:first-of-type{margin-top:8px}
  .lead{color:var(--mute);font-size:9.4pt;margin:-4px 0 10px}
  .blank{border:1pt dashed #b9bbc8;background:#fcfcfe;border-radius:2pt;padding:13px 15px;color:var(--mute);font-size:9.6pt}
  .blank .lbl{font:600 7.2pt/1 var(--mono);text-transform:uppercase;letter-spacing:.1em;color:var(--coral);margin-bottom:6px}
  .blank p{margin:0 0 7px} .blank p:last-child{margin:0}
  .vline{font-family:var(--disp);font-size:14pt;line-height:1.3;margin:0 0 9px}
  .f{border:1pt solid var(--line);border-radius:2pt;margin-bottom:10px;break-inside:avoid}
  .f-head{display:flex;gap:10px;align-items:flex-start;padding:9px 13px;background:var(--wash);border-bottom:1pt solid var(--line)}
  .n{font:600 9pt/1.45 var(--mono);color:var(--mute);flex:none;min-width:14px}
  .f-head h3{margin:0;font-size:11.4pt;font-weight:650;line-height:1.3;flex:1}
  .sev{flex:none;font:600 7.2pt/1 var(--mono);text-transform:uppercase;letter-spacing:.08em;border-radius:99px;padding:4.5px 9px;white-space:nowrap}
  .blankchip{color:var(--coral);border:1pt dashed var(--coral)}
  .s-severe{color:#fff;background:var(--coral)} .s-moderate{color:#fff;background:var(--mango)} .s-low{color:#fff;background:var(--teal)}
  .f-body{padding:10px 13px 12px} .f-body p{margin:0}
  .why{margin-top:8px;padding-top:8px;border-top:1pt dotted var(--line);font-size:10.2pt}
  .why b{font:600 7.2pt/1 var(--mono);text-transform:uppercase;letter-spacing:.1em;color:var(--mango);display:block;margin-bottom:3px}
  .act{margin-top:8px;padding-top:8px;border-top:1pt dotted var(--line);font-size:10.2pt}
  .act b{font:600 7.2pt/1 var(--mono);text-transform:uppercase;letter-spacing:.1em;color:var(--teal);display:block;margin-bottom:3px}
  table.ck{width:100%;border-collapse:collapse;font-size:9.8pt}
  table.ck tr{break-inside:avoid}
  table.ck td{border-bottom:1pt solid var(--line);padding:6px 4px;vertical-align:top}
  table.ck td.g{font:600 7.2pt/1 var(--mono);text-transform:uppercase;letter-spacing:.1em;color:var(--mute);padding-top:13px;border:none}
  table.ck td.s{width:29mm;text-align:right;white-space:nowrap}
  .tag{font:600 7.2pt/1 var(--mono);text-transform:uppercase;letter-spacing:.08em;border-radius:99px;padding:4px 8px;display:inline-block}
  .t-ok{color:#fff;background:var(--teal)} .t-gap{color:#fff;background:var(--coral)}
  .t-ref{color:var(--ink);background:#eceef4;border:1pt solid var(--line)} .t-na{color:var(--mute);border:1pt solid var(--line)}
  .note{display:block;color:var(--mute);font-size:8.8pt;margin-top:2px}
  table.sc{width:100%;border-collapse:collapse;font-size:9.8pt;table-layout:fixed}
  table.sc th{font:600 7.2pt/1 var(--mono);text-transform:uppercase;letter-spacing:.1em;color:var(--mute);text-align:left;padding:0 8px 6px 0;border-bottom:1pt solid var(--line)}
  table.sc td{padding:7px 8px 7px 0;border-bottom:1pt solid var(--line);vertical-align:top}
  table.sc tr{break-inside:avoid}
  table.sc td.in{border-left:2.5pt solid var(--teal);padding-left:9px}
  table.sc td.ex{border-left:2.5pt solid var(--coral);padding-left:9px}
  table.pay th.stg{width:26mm} table.pay th.shr{width:20mm;text-align:right} table.pay td.shr{text-align:right}
  .fill{display:inline-block;min-width:15mm;border-bottom:1pt dashed #b9bbc8;color:var(--coral);font:600 7.2pt/1.9 var(--mono);text-align:center}
  .copy{border:1pt solid var(--line);border-left:3pt solid var(--teal);background:#fbfcfc;border-radius:2pt;padding:13px 15px;font-size:9.8pt;white-space:pre-wrap;line-height:1.5}
  ul.q{margin:0;padding-left:17px} ul.q li{margin-bottom:6px}
  .scope{background:var(--wash);border:1pt solid var(--line);border-radius:2pt;padding:12px 15px;font-size:9.4pt}
  .scope p{margin:0 0 6px} .scope p:last-child{margin:0}
  footer{margin-top:22px;padding-top:10px;border-top:1pt solid var(--line);font-size:8.4pt;color:var(--mute)}
</style></head><body>

<table class="doc"><thead><tr><td>
<div class="runhead">
  ${logo ? `<img src="${logo}" alt="">` : ""}
  <div class="wm">Yaad<span>ly</span></div>
  <div class="svc">${esc(service)}<br>${esc(d.report.number || "Draft, not issued")}</div>
</div>
</td></tr></thead><tbody><tr><td>
<div class="body">
${d.report.practice ? `<div class="draftbar"><b>Practice document.</b> Invented client, invented contractor, invented quote. Produced to test the drafting agent. Nothing in it relates to a real person or a real property.</div>` : ""}

<h1>${esc(d.report.title || "Contractor and quote review, before any deposit is paid")}</h1>

<div class="meta">
  <div><dt>Client</dt><dd>${esc(d.report.client_name || "Not named")}</dd></div>
  <div><dt>Property</dt><dd>${esc(d.report.property || "Not given")}</dd></div>
  <div><dt>Subject of review</dt><dd>${esc(d.report.subject || "Not given")}</dd></div>
  <div><dt>Prepared</dt><dd>${esc(d.report.prepared_on || "")}</dd></div>
  <div><dt>Status</dt><dd>${issued ? "Issued" : "Draft, not issued"}</dd></div>
  <div><dt>Reference</dt><dd>${esc(d.report.number || "Number minted on issue")}</dd></div>
</div>

<h2>Verdict</h2>
${d.report.verdict_line || d.report.verdict ? `
  <p class="vline">${esc(d.report.verdict_line || "")}</p>
  <p style="margin:0">${esc(d.report.verdict || "")}</p>
` : `<div class="blank">
  <div class="lbl">Not written yet</div>
  <p><b>The one line for page one.</b> The shape it takes: "Hold. Do not send Friday's payment as the quote stands."</p>
  <p><b>The paragraph under it.</b> What you would do and why, in your own words.</p>
  <p>No model has seen this field and none ever will. The report cannot issue until it is written and every finding below carries a rating.</p>
</div>`}

<h2>The red flags</h2>
<p class="lead">Every risk this review found in the quote and the arrangement around it, in plain English, with why each one matters to you.</p>
${d.findings.map((f) => `<div class="f">
  <div class="f-head"><div class="n">${esc(f.ord)}</div><h3>${esc(f.heading)}</h3>${sev(f)}</div>
  <div class="f-body"><p>${esc(f.body)}</p>
  ${f.why ? `<div class="why"><b>Why it matters</b>${esc(f.why)}</div>` : ""}
  ${f.action ? `<div class="act"><b>What to do</b>${esc(f.action)}</div>` : ""}</div>
</div>`).join("")}

${(d.payment_schedule || []).length ? `<h2>Payment schedule we would put in its place</h2>
<p class="lead">Not a valuation and not a price. This is the ORDER money should move in, and what has to exist before each stage is paid. The shares are left blank on purpose: that is your judgment and the contractor's agreement, not a number this document decides. Agree the whole table in writing before anything is paid.</p>
<table class="sc pay">
<tr><th class="stg">Stage</th><th>Paid when</th><th>Evidence before it moves</th><th class="shr">Share</th></tr>
${d.payment_schedule.map((r) => `<tr>
  <td><b>${esc(r.stage)}</b></td><td>${esc(r.when)}</td><td>${esc(r.evidence)}</td>
  <td class="shr">${r.share ? esc(r.share) : `<span class="fill">&nbsp;</span>`}</td>
</tr>`).join("")}
</table>` : ""}

${d.ask_the_builder ? `<h2>The questions to send your builder</h2>
<p class="lead">Written out, ready to copy and send as one message. A builder with nothing to hide answers these without much trouble. One who will not answer them has told you something too.</p>
<div class="copy">${esc(d.ask_the_builder)}</div>` : ""}

<h2>What was checked</h2>
<p class="lead">The same list on every ${esc(service)}, including the lines where nothing was wrong. A line marked not provided is a gap in the paperwork, not an accusation.</p>
<table class="ck">
${groups.map((g) => `
  <tr><td class="g" colspan="2">${esc(g.name)}</td></tr>
  ${g.rows.map((r) => `<tr>
    <td>${esc(r.text)}${r.note ? `<span class="note">${esc(r.note)}</span>` : ""}</td>
    <td class="s"><span class="tag t-${r.tone}">${esc(r.label)}</span></td>
  </tr>`).join("")}
`).join("")}
</table>

${(d.scope?.included || []).length || (d.scope?.excluded || []).length ? `<h2>Scope of work, as the quote defines it</h2>
<p class="lead">Taken from the contractor's own wording. Anything on the right is not excluded by him, it is simply not written down, which means it is not yet agreed either way and it is where a variation later comes from.</p>
<table class="sc"><tr><th style="width:50%">Included in the quote</th><th>Not stated, so not agreed</th></tr><tr>
  <td class="in"><ul class="q">${(d.scope.included || []).map((x) => `<li>${esc(x)}</li>`).join("")}</ul></td>
  <td class="ex"><ul class="q">${(d.scope.excluded || []).map((x) => `<li>${esc(x)}</li>`).join("")}</ul></td>
</tr></table>` : ""}

${d.variations ? `<h2>If the scope changes</h2>
<p class="lead">Agreed at the start, before anybody is on site, because a variation argued about afterwards is the most common way a job of this kind goes wrong.</p>
<div class="scope">
  <p><b>Nothing outside the table above is part of this job.</b> If the contractor finds something extra, or either side wants a change, the work stops at that point and nobody proceeds on a verbal yes.</p>
  <p><b>A change is agreed in writing before it starts, and it records five things:</b> what changed and why, who asked for it, the effect on the programme, the effect on the price, and who agreed it, dated. A WhatsApp message with those five things in it is in writing. A voice note is not.</p>
  <p><b>Work done without that record is not payable and is not the client's risk.</b> Say so at the start, in the same message that agrees the payment schedule, so it is a shared rule rather than something produced in an argument later.</p>
</div>` : ""}

${(d.report.questions || []).length ? `<h2>Questions for other professionals</h2>
<p class="lead">Raised by the review and deliberately not answered here. Each belongs to a different profession.</p>
<ul class="q">${d.report.questions.map((q) => `<li>${esc(q)}</li>`).join("")}</ul>` : ""}

${(d.report.omitted || []).length ? `<h2>What this review could not establish</h2>
<ul class="q">${d.report.omitted.map((q) => `<li>${esc(q)}</li>`).join("")}</ul>` : ""}

<h2>Scope</h2>
<div class="scope">
  <p>${esc(d.report.scope_line || "This is a review of a contractor, their written quote and the arrangement around it. It is a desk review. Nobody attended the property.")}</p>
  <p>It does not value the property, confirm who owns it, interpret a contract, give an opinion on whether any structure is sound, or say where a boundary runs. It does not estimate what the work should cost: that is quantity surveying and Yaadly does not sell it. What Yaadly guarantees is project management, procurement and oversight judgment.</p>
  <p>Findings describe what was recorded in the review notes. Anything the notes could not establish is named rather than answered.</p>
</div>

<footer>
  Prepared by Monique Sewell-Bennett, supplying professional services as a sole trader, 55 Remington Road, London N15 6SS. Jobs and full project management are supplied separately by Yaadly Ltd, registered in England and Wales, company number 17358077.<br>
  Findings drafted by the Yaadly report agent${d.report.model ? ` (${esc(d.report.model)}, EU)` : ""} from the reviewer's notes, then screened for language, measurements and figures. Every finding is rated, and the verdict written, by a named person before the report is issued.
</footer>
</div>
</td></tr></tbody></table>
</body></html>`;
}

const args = process.argv.slice(2);
const input = args.find((a) => !a.startsWith("--"));
if (!input) {
  console.error("usage: node scripts/render-report.mjs <input.json> [--out <dir>] [--no-pdf]");
  process.exit(1);
}
const outDir = args.includes("--out") ? args[args.indexOf("--out") + 1] : dirname(resolve(input));
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

const data = JSON.parse(readFileSync(input, "utf8"));
const stem = (data.report.number || "report-draft").replace(/[^A-Za-z0-9._-]/g, "-");
const htmlPath = join(outDir, `${stem}.html`);
writeFileSync(htmlPath, page(data));
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
