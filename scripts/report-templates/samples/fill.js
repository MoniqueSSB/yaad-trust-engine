// Fills a blank template with sample content without copying its layout.
//
// A sample starts as a deep copy of the template it shows, so a change to the
// template carries into the sample on the next build. Content goes in by
// section heading and by the position of a block inside that section: "the
// first table under B. This visit". If a template is restructured so that a
// fill no longer finds its block, the build stops and says which one, rather
// than printing a sample with a blank where a finding should be.

const SAMPLE_NOTE = "**This is a sample report.** The client, the property, the people and every finding in it are invented, to show what the report looks like and how it reads. No real property was visited.";

const clone = (v) => JSON.parse(JSON.stringify(v));
const kindOf = (b) => Object.keys(b).find((k) => ["table", "kv", "lines", "tick", "sign", "p", "small", "note", "key", "contents", "h3"].includes(k));

function locate(doc, heading, kind, n) {
  const start = doc.blocks.findIndex((b) => b.h === heading);
  if (start < 0) throw new Error(`${doc.service} sample: no section "${heading}"`);
  let seen = 0;
  for (let i = start + 1; i < doc.blocks.length && !doc.blocks[i].h; i++) {
    if (kindOf(doc.blocks[i]) === kind && seen++ === n) return i;
  }
  throw new Error(`${doc.service} sample: no ${kind} number ${n + 1} under "${heading}"`);
}

// Collect every replacement first and apply them from the bottom up, so a fill
// that turns one block into several never moves the next one's position.
function fill(template, sample, fills) {
  const doc = { ...clone(template), ...sample, sample: true };
  const at = fills.map(([heading, kind, n, make]) => {
    const i = locate(doc, heading, kind, n);
    return [i, make(doc.blocks[i])];
  });
  at.sort((a, b) => b[0] - a[0]).forEach(([i, out]) => doc.blocks.splice(i, 1, ...[].concat(out)));
  doc.blocks.unshift({ note: SAMPLE_NOTE, tone: "warn" });
  return doc;
}

// Block builders, each keeping the template's own columns.
const rows = (r) => (b) => ({ table: { ...b.table, rows: r, blank: 0 } });
const numbered = (r) => rows(r.map((x, i) => [String(i + 1), ...x]));
const vals = (v) => (b) => ({ ...b, kv: b.kv.map(([k], i) => [k, v[i] ?? ""]) });
const ticks = (v) => (b) => ({ kv: b.tick.map(([k], i) => [k, v[i] ?? ""]), cols: b.tick.length });
const text = (...paras) => (b) => paras.map((p, i) => ({ p: i === 0 && b.label ? `**${b.label}.** ${p}` : p }));
const signed = (v) => (b) => ({ sign: b.sign.map((k, i) => [k, v[i] ?? ""]) });
// Fill the template's own fixed rows by their first column, in order.
const column = (col, v) => (b) => ({ table: { ...b.table, rows: b.table.rows.map((r, i) => r.map((c, j) => (j >= col && v[i] ? v[i][j - col] ?? c : c))) } });

module.exports = { fill, rows, numbered, vals, ticks, text, signed, column, SAMPLE_NOTE };
