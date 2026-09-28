// One content model per service, two outputs: a Word file to type into and
// an A4 PDF to print and fill by hand. Both are drawn from the same blocks so
// they cannot drift apart.
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const D = require("docx");

const C = { ink: "15161C", mute: "5C6070", line: "DCDDE5", wash: "F7F7FA", mango: "C77A17", teal: "0F6B63", coral: "B3372F", slate: "6B7080" };
const TONE = { severe: C.coral, moderate: C.mango, low: C.teal, ok: C.teal, gap: C.coral, ref: C.slate, na: C.slate, info: C.slate };
const LOGO = fs.readFileSync(path.join(__dirname, "..", "..", "docs", "logo-v1.png"));
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

// ---------------------------------------------------------------- HTML
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const rich = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");

function htmlBlock(b) {
  if (b.h) return `<h2${b.pb === false ? "" : ""}>${esc(b.h)}</h2>`;
  if (b.h3) return `<h3>${esc(b.h3)}</h3>`;
  if (b.p) return `<p>${rich(b.p)}</p>`;
  if (b.small) return `<p class="small">${rich(b.small)}</p>`;
  if (b.note) return `<div class="note ${b.tone || ""}">${rich(b.note)}</div>`;
  if (b.pb) return `<div class="pb"></div>`;
  if (b.kv) {
    const cols = b.cols || 3;
    return `<div class="kv" style="grid-template-columns:repeat(${cols},1fr)">${b.kv.map(([k, v]) => `<div class="kvc"><div class="lab">${esc(k)}</div><div class="val">${v ? esc(v) : "&nbsp;"}</div></div>`).join("")}</div>`;
  }
  if (b.key) {
    return `<table class="key">${b.key.map(([chip, tone, lead, rest]) => `<tr><td class="kc"><span class="chip" style="--t:#${TONE[tone]}">${esc(chip)}</span></td><td><b>${esc(lead)}</b> ${esc(rest || "")}</td></tr>`).join("")}</table>`;
  }
  if (b.tick) {
    return `<div class="tick" style="grid-template-columns:repeat(${b.tick.length},1fr)">${b.tick.map((t) => `<div class="tk"><span class="box"></span><div><b>${esc(t[0])}</b>${t[1] ? `<div class="tkd">${esc(t[1])}</div>` : ""}</div></div>`).join("")}</div>`;
  }
  if (b.table) {
    const t = b.table;
    const w = t.widths;
    const tot = w.reduce((a, x) => a + x, 0);
    const rows = [...(t.rows || [])];
    for (let i = 0; i < (t.blank || 0); i++) rows.push(t.head.map((_, j) => (j === 0 && t.number ? (typeof t.number === "string" ? t.number : "") + String(rows.length + 1) : "")));
    return `<table class="grid${t.tall ? " tall" : ""}${rows.length <= 9 ? " keep" : ""}"><colgroup>${w.map((x) => `<col style="width:${((x / tot) * 100).toFixed(2)}%">`).join("")}</colgroup><thead><tr>${t.head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, j) => `<td${j === 0 && t.firstBold ? ' class="fb"' : ""}>${c === "" ? "&nbsp;" : rich(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  }
  if (b.lines) return `<div class="lines">${b.label ? `<div class="lab">${esc(b.label)}</div>` : ""}${"<div class=\"ln\"></div>".repeat(b.lines)}</div>`;
  if (b.sign) return `<div class="sign" style="grid-template-columns:repeat(${b.sign.length},1fr)">${b.sign.map((k) => `<div class="sg"><div class="sl"></div><div class="lab">${esc(k)}</div></div>`).join("")}</div>`;
  if (b.grid) return `<div class="gridpad" style="height:${b.grid.height || 200}mm">${b.grid.label ? `<div class="gl">${esc(b.grid.label)}</div>` : ""}<div class="north">N<br>&#8593;</div></div>`;
  if (b.contents) return `<table class="toc">${b.contents.map(([l, t, d]) => `<tr><td class="tl">${esc(l)}</td><td>${esc(t)}</td><td class="td">${esc(d)}</td></tr>`).join("")}</table>`;
  throw new Error("unknown block " + JSON.stringify(b).slice(0, 80));
}

function html(doc) {
  const logo = "data:image/png;base64," + LOGO.toString("base64");
  const CSS = `
@page { size:A4; margin:18mm 16mm 18mm 16mm;
  @top-left { content:"Yaadly  \\00B7  ${doc.service}"; font:600 7.5pt 'Menlo',monospace; letter-spacing:.12em; text-transform:uppercase; color:#5c6070; }
  @top-right { content:"Reference ${doc.code}-________"; font:600 7.5pt 'Menlo',monospace; letter-spacing:.08em; color:#5c6070; }
  @bottom-left { content:"${doc.footer}"; font:7pt 'Helvetica Neue',Arial,sans-serif; color:#5c6070; }
  @bottom-right { content:"Page " counter(page) " of " counter(pages); font:7.5pt 'Helvetica Neue',Arial,sans-serif; color:#5c6070; } }
${doc.compact ? '' : '@page :first { @top-left{content:none} @top-right{content:none} @bottom-left{content:none} @bottom-right{content:none} }'}
*{box-sizing:border-box} body{margin:0;font:9.5pt/1.45 'Helvetica Neue',Arial,sans-serif;color:#15161c;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.cover{height:257mm;display:flex;flex-direction:column}
.brand{display:flex;align-items:center;gap:10px;padding-bottom:12px;border-bottom:1.5px solid #15161c}
.brand img{width:30px;height:30px}.brand span{font:500 19pt Georgia,serif}.brand i{font-style:normal;color:#c77a17}
.kick{margin-top:56mm;font:700 8pt 'Menlo',monospace;letter-spacing:.16em;text-transform:uppercase;color:#c77a17}
h1{font:400 30pt/1.1 Georgia,serif;margin:8px 0 14px;letter-spacing:-.01em}
.blurb{font:12pt/1.5 Georgia,serif;color:#5c6070;max-width:150mm;margin:0 0 22px}
.status{display:flex;gap:10px;margin:14px 0}.status span{font:700 7.5pt 'Menlo',monospace;letter-spacing:.12em;text-transform:uppercase;border:1px solid #5c6070;border-radius:20px;padding:4px 10px;color:#5c6070}
.status span:before{content:"";display:inline-block;width:8px;height:8px;border:1px solid #5c6070;margin-right:7px;vertical-align:-1px}
.by{margin-top:auto;border-top:1px solid #dcdde5;padding-top:9px;font-size:8pt;color:#5c6070}.by b{color:#15161c}
h2{font:400 15pt Georgia,serif;margin:20px 0 8px;padding-bottom:5px;border-bottom:1px solid #dcdde5;break-after:avoid}
h3{font:700 9.5pt 'Helvetica Neue',Arial,sans-serif;margin:14px 0 5px;break-after:avoid}
p{margin:0 0 7px}.small{font-size:8.3pt;color:#5c6070}
.note{border-left:3px solid #6b7080;background:#f7f7fa;padding:8px 11px;margin:8px 0;font-size:8.8pt;break-inside:avoid}.note.warn{border-color:#c77a17;background:#fff7e8}.note.teal{border-color:#0f6b63;background:#eef7f5}
.pb{break-after:page}
.kv{display:grid;border:1px solid #dcdde5;background:#f7f7fa;margin:6px 0 10px;break-inside:avoid}.kvc{padding:6px 9px;border-right:1px solid #dcdde5;border-bottom:1px solid #dcdde5;min-height:13mm}
.lab{font:700 6.8pt 'Menlo',monospace;letter-spacing:.12em;text-transform:uppercase;color:#5c6070}.val{padding-top:3px}
table{border-collapse:collapse;width:100%}
.grid{margin:6px 0 12px;table-layout:fixed}.grid th{font:700 6.8pt 'Menlo',monospace;letter-spacing:.08em;text-transform:uppercase;color:#5c6070;text-align:left;background:#f7f7fa;border:1px solid #dcdde5;padding:5px 6px;vertical-align:bottom}
.grid td{border:1px solid #dcdde5;padding:5px 6px;vertical-align:top;height:9mm;font-size:8.8pt}.grid.tall td{height:14mm}.grid td.fb{font-weight:600}
.grid tr{break-inside:avoid}.grid.keep{break-inside:avoid}.grid thead{display:table-header-group}
.key td{padding:6px 4px;border-bottom:1px solid #dcdde5;vertical-align:top}.key .kc{width:32mm}
.chip{display:inline-block;font:700 6.8pt 'Menlo',monospace;letter-spacing:.1em;text-transform:uppercase;color:#fff;background:var(--t);border-radius:20px;padding:3px 9px}
.tick{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin:8px 0 12px}.tk{display:flex;gap:9px;border:1px solid #dcdde5;padding:9px;break-inside:avoid}.box{flex:0 0 13px;height:13px;border:1.4px solid #15161c;margin-top:1px}.tkd{font-size:8pt;color:#5c6070}
.lines{margin:6px 0 12px}.ln{border-bottom:1px solid #c9cad4;height:8.5mm}
.sign{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin:18px 0 8px;break-inside:avoid}.sl{border-bottom:1px solid #15161c;height:12mm;margin-bottom:4px}
.gridpad{position:relative;border:1px solid #9ea0ad;margin:6px 0 10px;background-color:#fff;background-image:linear-gradient(#e3e4ea 1px,transparent 1px),linear-gradient(90deg,#e3e4ea 1px,transparent 1px);background-size:5mm 5mm;break-inside:avoid}
.gridpad .gl{position:absolute;left:6px;top:5px;font:700 6.8pt 'Menlo',monospace;letter-spacing:.12em;text-transform:uppercase;color:#5c6070;background:#fff;padding:1px 4px}
.gridpad .north{position:absolute;right:8px;top:6px;width:9mm;height:12mm;border:1px solid #9ea0ad;border-radius:5mm;background:#fff;text-align:center;font:700 8pt/1.2 Georgia,serif;padding-top:1mm}
.compact{display:flex;justify-content:space-between;align-items:flex-end;padding-bottom:8px;border-bottom:1.5px solid #15161c;margin-bottom:10px}.compact h1{font-size:20pt;margin:4px 0 0}
.toc td{padding:5px 4px;border-bottom:1px solid #dcdde5}.toc .tl{width:8mm;font:700 8pt 'Menlo',monospace;color:#c77a17}.toc .td{text-align:right;color:#5c6070;font-size:8.3pt}
`;
  const cover = `<section class="cover"><div class="brand"><img src="${logo}"><span>Yaad<i>ly</i></span></div>
<div class="kick">${esc(doc.service)}</div><h1>${esc(doc.title)}</h1><p class="blurb">${esc(doc.blurb)}</p>
${htmlBlock({ kv: doc.coverFields, cols: 2 })}
<div class="status">${doc.statuses.map((s) => `<span>${esc(s)}</span>`).join("")}</div>
<div class="by">${rich(doc.preparedBy)}</div></section><div class="pb"></div>`;
  const head = doc.compact ? `<div class="compact"><div><div class="brand" style="border:0;padding:0"><img src="${logo}"><span>Yaad<i>ly</i></span></div><div class="kick" style="margin-top:10px">${esc(doc.service)}</div><h1>${esc(doc.title)}</h1></div></div>` : cover;
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><title>${esc(doc.service)} template</title><style>${CSS}</style></head><body>${head}${doc.blocks.map(htmlBlock).join("\n")}</body></html>`;
}

// ---------------------------------------------------------------- DOCX
const PAGE_W = 11906, MARG = 907, CW = PAGE_W - 2 * MARG; // A4, 16mm margins
const border = (c = C.line) => ({ style: D.BorderStyle.SINGLE, size: 4, color: c });
const cellBorders = { top: border(), bottom: border(), left: border(), right: border() };
const noBorders = { top: { style: D.BorderStyle.NONE, size: 0, color: "FFFFFF" }, bottom: { style: D.BorderStyle.NONE, size: 0, color: "FFFFFF" }, left: { style: D.BorderStyle.NONE, size: 0, color: "FFFFFF" }, right: { style: D.BorderStyle.NONE, size: 0, color: "FFFFFF" } };

function runs(s, o = {}) {
  const out = [];
  String(s ?? "").split(/(\*\*.+?\*\*)/).forEach((part) => {
    if (!part) return;
    const bold = part.startsWith("**");
    out.push(new D.TextRun({ text: bold ? part.slice(2, -2) : part, bold: bold || o.bold, color: o.color, size: o.size, font: o.font, characterSpacing: o.spacing, allCaps: o.caps }));
  });
  return out;
}
const label = (t) => new D.Paragraph({ spacing: { after: 20 }, children: runs(t, { size: 13, bold: true, color: C.mute, font: "Courier New", caps: true, spacing: 10 }) });
const para = (t, o = {}) => new D.Paragraph({ spacing: { after: o.after ?? 100 }, children: runs(t, o) });
const widthsDxa = (w, total = CW) => { const tot = w.reduce((a, x) => a + x, 0); const d = w.map((x) => Math.floor((x / tot) * total)); d[d.length - 1] += total - d.reduce((a, x) => a + x, 0); return d; };

function cell(children, width, o = {}) {
  return new D.TableCell({ width: { size: width, type: D.WidthType.DXA }, borders: o.borders || cellBorders, shading: o.fill ? { type: D.ShadingType.CLEAR, color: "auto", fill: o.fill } : undefined, margins: { top: 70, bottom: 70, left: 100, right: 100 }, verticalAlign: o.valign, children });
}

function docxBlock(b) {
  if (b.h) return [new D.Paragraph({ heading: D.HeadingLevel.HEADING_1, pageBreakBefore: false, keepNext: true, spacing: { before: 280, after: 120 }, border: { bottom: { style: D.BorderStyle.SINGLE, size: 4, color: C.line, space: 4 } }, children: [new D.TextRun({ text: b.h, font: "Georgia", size: 30, color: C.ink })] })];
  if (b.h3) return [new D.Paragraph({ heading: D.HeadingLevel.HEADING_2, keepNext: true, spacing: { before: 200, after: 80 }, children: [new D.TextRun({ text: b.h3, bold: true, size: 19, color: C.ink })] })];
  if (b.p) return [para(b.p)];
  if (b.small) return [para(b.small, { size: 16, color: C.mute })];
  if (b.pb) return [new D.Paragraph({ children: [new D.PageBreak()] })];
  if (b.note) {
    const col = b.tone === "warn" ? C.mango : b.tone === "teal" ? C.teal : C.slate;
    const fill = b.tone === "warn" ? "FFF7E8" : b.tone === "teal" ? "EEF7F5" : C.wash;
    return [new D.Table({ width: { size: CW, type: D.WidthType.DXA }, columnWidths: [CW], rows: [new D.TableRow({ cantSplit: true, children: [cell([para(b.note, { size: 17, after: 0 })], CW, { fill, borders: { ...noBorders, left: { style: D.BorderStyle.SINGLE, size: 18, color: col } } })] })] }), para("", { after: 60 })];
  }
  if (b.kv) {
    const cols = b.cols || 3, w = widthsDxa(Array(cols).fill(1)), rows = [];
    for (let i = 0; i < b.kv.length; i += cols) {
      const slice = b.kv.slice(i, i + cols);
      while (slice.length < cols) slice.push(["", ""]);
      rows.push(new D.TableRow({ cantSplit: true, children: slice.map(([k, v], j) => cell([label(k), para(v || "", { after: 0, size: 19 })], w[j], { fill: C.wash })) }));
    }
    return [new D.Table({ width: { size: CW, type: D.WidthType.DXA }, columnWidths: w, rows }), para("", { after: 80 })];
  }
  if (b.key) {
    const w = widthsDxa([1.1, 4]);
    return [new D.Table({ width: { size: CW, type: D.WidthType.DXA }, columnWidths: w, rows: b.key.map(([chip, tone, lead, rest]) => new D.TableRow({ cantSplit: true, children: [
      cell([new D.Paragraph({ children: [new D.TextRun({ text: " " + chip.toUpperCase() + " ", bold: true, size: 14, color: "FFFFFF", font: "Courier New", shading: { type: D.ShadingType.CLEAR, color: "auto", fill: TONE[tone] } })] })], w[0], { borders: { ...noBorders, bottom: border() } }),
      cell([para(`**${lead}** ${rest || ""}`, { after: 0, size: 18 })], w[1], { borders: { ...noBorders, bottom: border() } }),
    ] })) }), para("", { after: 80 })];
  }
  if (b.tick) {
    const w = widthsDxa(Array(b.tick.length).fill(1));
    return [new D.Table({ width: { size: CW, type: D.WidthType.DXA }, columnWidths: w, rows: [new D.TableRow({ cantSplit: true, children: b.tick.map((t, j) => cell([para(`☐  **${t[0]}**`, { after: 30, size: 19 }), ...(t[1] ? [para(t[1], { size: 15, color: C.mute, after: 0 })] : [])], w[j])) })] }), para("", { after: 80 })];
  }
  if (b.table) {
    const t = b.table, w = widthsDxa(t.widths), rows = [...(t.rows || [])];
    for (let i = 0; i < (t.blank || 0); i++) rows.push(t.head.map((_, j) => (j === 0 && t.number ? (typeof t.number === "string" ? t.number : "") + String(rows.length + 1) : "")));
    const h = t.tall ? 700 : 460;
    return [new D.Table({ width: { size: CW, type: D.WidthType.DXA }, columnWidths: w, rows: [
      new D.TableRow({ tableHeader: true, cantSplit: true, children: t.head.map((x, j) => cell([para(x, { size: 13, bold: true, color: C.mute, font: "Courier New", caps: true, after: 0 })], w[j], { fill: C.wash, valign: D.VerticalAlign.BOTTOM })) }),
      ...rows.map((r) => new D.TableRow({ cantSplit: true, height: { value: h, rule: D.HeightRule.ATLEAST }, children: r.map((c, j) => cell([para(c, { after: 0, size: 17, bold: j === 0 && t.firstBold })], w[j])) })),
    ] }), para("", { after: 100 })];
  }
  if (b.lines) {
    const out = b.label ? [label(b.label)] : [];
    for (let i = 0; i < b.lines; i++) out.push(new D.Paragraph({ spacing: { before: 200, after: 0 }, border: { bottom: { style: D.BorderStyle.SINGLE, size: 4, color: "C9CAD4", space: 1 } }, children: [new D.TextRun("")] }));
    out.push(para("", { after: 80 }));
    return out;
  }
  if (b.sign) {
    const w = widthsDxa(Array(b.sign.length).fill(1));
    return [new D.Table({ width: { size: CW, type: D.WidthType.DXA }, columnWidths: w, rows: [
      new D.TableRow({ height: { value: 700, rule: D.HeightRule.ATLEAST }, children: b.sign.map((_, j) => cell([para("", { after: 0 })], w[j], { borders: { ...noBorders, bottom: { style: D.BorderStyle.SINGLE, size: 6, color: C.ink } } })) }),
      new D.TableRow({ children: b.sign.map((k, j) => cell([label(k)], w[j], { borders: noBorders })) }),
    ] }), para("", { after: 100 })];
  }
  if (b.grid) {
    // A sketching grid: small square cells with light rules. Word cannot draw
    // a background grid, so it is a table of empty cells, one per square.
    const cols = 36, w = widthsDxa(Array(cols).fill(1)), cellH = Math.round(CW / cols);
    const rows = Math.round(((b.grid.height || 200) / 257) * 14000 / cellH);
    const thin = { style: D.BorderStyle.SINGLE, size: 2, color: "E3E4EA" };
    const out = b.grid.label ? [label(b.grid.label)] : [];
    out.push(new D.Table({ width: { size: CW, type: D.WidthType.DXA }, columnWidths: w, rows: Array.from({ length: rows }, () => new D.TableRow({ cantSplit: true, height: { value: cellH, rule: D.HeightRule.EXACT }, children: w.map((x) => new D.TableCell({ width: { size: x, type: D.WidthType.DXA }, borders: { top: thin, bottom: thin, left: thin, right: thin }, margins: { top: 0, bottom: 0, left: 0, right: 0 }, children: [new D.Paragraph({ children: [new D.TextRun({ text: "", size: 2 })] })] })) })) }));
    out.push(para("", { after: 60 }));
    return out;
  }
  if (b.contents) {
    const w = widthsDxa([0.4, 3, 4]);
    return [new D.Table({ width: { size: CW, type: D.WidthType.DXA }, columnWidths: w, rows: b.contents.map(([l, t, d]) => new D.TableRow({ children: [
      cell([para(l, { bold: true, color: C.mango, font: "Courier New", size: 16, after: 0 })], w[0], { borders: { ...noBorders, bottom: border() } }),
      cell([para(t, { after: 0, size: 18 })], w[1], { borders: { ...noBorders, bottom: border() } }),
      cell([new D.Paragraph({ alignment: D.AlignmentType.RIGHT, children: runs(d, { size: 16, color: C.mute }) })], w[2], { borders: { ...noBorders, bottom: border() } }),
    ] })) }), para("", { after: 100 })];
  }
  throw new Error("unknown block");
}

function docx(doc) {
  const cover = [
    new D.Paragraph({ border: { bottom: { style: D.BorderStyle.SINGLE, size: 10, color: C.ink, space: 6 } }, spacing: { after: 1800 }, children: [
      new D.ImageRun({ type: "png", data: LOGO, transformation: { width: 30, height: 30 } }),
      new D.TextRun({ text: "  Yaad", font: "Georgia", size: 38 }), new D.TextRun({ text: "ly", font: "Georgia", size: 38, color: C.mango }),
    ] }),
    para(doc.service, { bold: true, color: C.mango, font: "Courier New", size: 16, caps: true, spacing: 20, after: 120 }),
    new D.Paragraph({ spacing: { after: 240 }, children: [new D.TextRun({ text: doc.title, font: "Georgia", size: 60 })] }),
    para(doc.blurb, { font: "Georgia", size: 24, color: C.mute, after: 400 }),
    ...docxBlock({ kv: doc.coverFields, cols: 2 }),
    para(doc.statuses.map((s) => "☐ " + s).join("      "), { size: 16, bold: true, color: C.mute, font: "Courier New", caps: true, after: 1400 }),
    new D.Paragraph({ border: { top: { style: D.BorderStyle.SINGLE, size: 4, color: C.line, space: 6 } }, children: runs(doc.preparedBy, { size: 16, color: C.mute }) }),
    new D.Paragraph({ children: [new D.PageBreak()] }),
  ];
  const compactHead = [
    new D.Paragraph({ children: [new D.ImageRun({ type: "png", data: LOGO, transformation: { width: 24, height: 24 } }), new D.TextRun({ text: "  Yaad", font: "Georgia", size: 30 }), new D.TextRun({ text: "ly", font: "Georgia", size: 30, color: C.mango })] }),
    para(doc.service, { bold: true, color: C.mango, font: "Courier New", size: 16, caps: true, spacing: 20, after: 40 }),
    new D.Paragraph({ spacing: { after: 160 }, border: { bottom: { style: D.BorderStyle.SINGLE, size: 10, color: C.ink, space: 6 } }, children: [new D.TextRun({ text: doc.title, font: "Georgia", size: 40 })] }),
  ];
  const hdr = new D.Header({ children: [new D.Paragraph({ tabStops: [{ type: D.TabStopType.RIGHT, position: CW }], border: { bottom: { style: D.BorderStyle.SINGLE, size: 4, color: C.line, space: 4 } }, children: [
    new D.TextRun({ text: "YAADLY  ·  " + doc.service.toUpperCase(), font: "Courier New", size: 14, bold: true, color: C.mute }),
    new D.TextRun({ text: "\tReference " + doc.code + "-________", font: "Courier New", size: 14, bold: true, color: C.mute }),
  ] })] });
  const ftr = new D.Footer({ children: [new D.Paragraph({ tabStops: [{ type: D.TabStopType.RIGHT, position: CW }], children: [
    new D.TextRun({ text: doc.footer, size: 14, color: C.mute }),
    new D.TextRun({ children: ["\tPage ", D.PageNumber.CURRENT, " of ", D.PageNumber.TOTAL_PAGES], size: 14, color: C.mute }),
  ] })] });
  return new D.Document({
    creator: "Yaadly", title: doc.service + " report template",
    styles: { default: { document: { run: { font: "Arial", size: 19, color: C.ink } } } },
    sections: [{ properties: { titlePage: !doc.compact, page: { size: { width: PAGE_W, height: 16838 }, margin: { top: 1020, bottom: 1020, left: MARG, right: MARG, header: 500, footer: 500 } } },
      headers: { default: hdr, first: new D.Header({ children: [new D.Paragraph("")] }) },
      footers: { default: ftr, first: new D.Footer({ children: [new D.Paragraph("")] }) },
      children: [...(doc.compact ? compactHead : cover), ...doc.blocks.flatMap(docxBlock)] }],
  });
}

// Writes <outDir>/<name>.docx and <outDir>/<name>.pdf. Chrome prints the PDF
// from a plain temporary name, because it is fussy about brackets in a file URL.
async function build(doc, outDir, name) {
  const base = path.join(outDir, name);
  fs.writeFileSync(base + ".docx", await D.Packer.toBuffer(docx(doc)));
  const tmpHtml = path.join(require("os").tmpdir(), "yaadly-template-" + doc.code + ".html"), tmpPdf = tmpHtml.replace(/html$/, "pdf");
  fs.writeFileSync(tmpHtml, html(doc));
  execFileSync(CHROME, ["--headless", "--disable-gpu", "--no-pdf-header-footer", `--print-to-pdf=${tmpPdf}`, "file://" + tmpHtml], { stdio: "pipe" });
  fs.renameSync(tmpPdf, base + ".pdf");
  fs.unlinkSync(tmpHtml);
  return base;
}
module.exports = { build, html };
