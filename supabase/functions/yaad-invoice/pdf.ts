// The invoice as a PDF, drawn here from the same rows renderInvoice() reads.
//
// Asked for on 28 Sep 2026: the client's invoice email carries the invoice
// as a PDF attachment, and the desk previews that same file. Founder's choice
// (option A): draw it inside this function, so no invoice data goes to any
// new service. The price is a plain standard font (Helvetica), so the PDF
// does not look exactly like the HTML version. The words must: every sentence
// here mirrors renderInvoice() in index.ts. Change one, change the other.
//
// Pure: rows in, bytes out. No network, no database, no clock except the
// dates it is given, so the test can run it with invented rows.

import { PDFDocument, PDFString, rgb, StandardFonts, type PDFFont, type PDFPage } from "npm:pdf-lib@1.17.1";

type Row = Record<string, any>;

const A4: [number, number] = [595.28, 841.89];
const M = 48; // page margin, points
const W = A4[0] - 2 * M;

const DEEP = rgb(0.031, 0.067, 0.059);
const MUTE = rgb(0.369, 0.467, 0.447);
const LINE = rgb(0.863, 0.902, 0.886);
const TEAL = rgb(0.078, 0.722, 0.651);
const AMBER = rgb(0.541, 0.353, 0);
const AMBER_BG = rgb(1, 0.984, 0.949);
const NOTE_BG = rgb(0.957, 0.969, 0.965);

/** Yaadly's worker fee on a worker's pay invoice (28 Sep 2026): the quoted
 *  labour, the fee kept out of it, and the agreed rate that is paid. Read
 *  from the figures the pay invoice recorded when it was raised
 *  (20260928230000), never worked back from the rate. Null on anything else,
 *  and on pay raised before then, which shows no breakdown rather than a
 *  guessed one. Used by the HTML invoice, the PDF and nothing else. */
export function workerFeeBreakdown(inv: Row) {
  if (inv.payable_to !== "worker" || inv.worker_labour_jmd == null || inv.worker_fee_jmd == null) return null;
  const labour = Number(inv.worker_labour_jmd), fee = Number(inv.worker_fee_jmd);
  const pct = labour > 0 ? Math.round((fee / labour) * 100) : 0;
  return { labour, fee, rate: labour - fee, pct };
}

const dt = (d: string) =>
  new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export async function invoicePdf(
  inv: Row,
  lines: Row[],
  settings: Record<string, string>,
  money: (pence: number, currency?: string) => string,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${inv.id} · ${settings.invoice_issuer_name ?? "Yaadly"}`);
  doc.setAuthor(settings.invoice_issuer_name ?? "Yaadly");
  doc.setCreator("Yaadly");
  doc.setProducer("Yaadly");
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  // Helvetica can only draw the Windows-1252 characters. A client name or a
  // description with anything else (an emoji, a Chinese character) would
  // otherwise throw and stop the invoice from sending. Swap the common
  // look-alikes, and anything left becomes "?" rather than a crash.
  const charset = new Set(reg.getCharacterSet());
  const clean = (s: unknown) =>
    String(s ?? "")
      .replace(/\r/g, "")
      .replace(/[‐‑‒−]/g, "-")
      .replace(/ | /g, " ")
      .replace(/[^\n]/gu, (c) => (charset.has(c.codePointAt(0)!) ? c : "?"));

  let page: PDFPage = doc.addPage(A4);
  let y = A4[1] - M;

  const text = (s: string, x: number, yy: number, size: number, font: PDFFont = reg, color = DEEP) =>
    page.drawText(clean(s), { x, y: yy, size, font, color });
  const right = (s: string, xr: number, yy: number, size: number, font: PDFFont = reg, color = DEEP) =>
    text(s, xr - font.widthOfTextAtSize(clean(s), size), yy, size, font, color);

  // Word wrap to a width; long unbroken words are cut rather than overflow.
  const wrap = (s: string, size: number, width: number, font: PDFFont = reg): string[] => {
    const out: string[] = [];
    for (const para of clean(s).split("\n")) {
      let cur = "";
      for (let word of para.split(/ +/)) {
        while (font.widthOfTextAtSize(word, size) > width) {
          let i = word.length;
          while (i > 1 && font.widthOfTextAtSize(word.slice(0, i), size) > width) i--;
          if (cur) { out.push(cur); cur = ""; }
          out.push(word.slice(0, i));
          word = word.slice(i);
        }
        const next = cur ? cur + " " + word : word;
        if (font.widthOfTextAtSize(next, size) > width && cur) { out.push(cur); cur = word; }
        else cur = next;
      }
      out.push(cur);
    }
    return out;
  };

  const newPage = () => {
    page = doc.addPage(A4);
    y = A4[1] - M;
    text(`${inv.id} continued`, M, y - 9, 9, reg, MUTE);
    y -= 26;
  };
  const need = (h: number) => { if (y - h < M + 20) newPage(); };

  // ------------------------------------------------------------ header
  text("YAADLY", M, y - 26, 26, bold);
  text(".", M + bold.widthOfTextAtSize("YAADLY", 26), y - 26, 26, bold, TEAL);
  right("INVOICE", M + W, y - 22, 22, bold);
  right(String(inv.id ?? ""), M + W, y - 42, 13, bold);
  right(String(inv.status ?? "").toUpperCase(), M + W, y - 58, 9, bold, inv.status === "draft" ? AMBER : TEAL);

  const issuer = [
    settings.invoice_issuer_name,
    `Company number ${settings.invoice_issuer_number ?? ""}`,
    ...String(settings.invoice_issuer_address ?? "").split("\n"),
    `${settings.invoice_issuer_email ?? ""} · ${settings.invoice_issuer_phone ?? ""}`,
  ];
  let iy = y - 44;
  for (const l of issuer) for (const w of wrap(l ?? "", 9, W * 0.55)) { text(w, M, iy, 9, reg, MUTE); iy -= 12; }
  y = Math.min(iy, y - 66) - 8;
  page.drawRectangle({ x: M, y, width: W, height: 2.5, color: TEAL });
  y -= 24;

  // -------------------------------------------------------------- meta
  const billed = [
    inv.client_name, inv.client_company, inv.client_email,
    ...(inv.client_address ? String(inv.client_address).split("\n") : []),
  ].filter(Boolean).map(String);
  const meta: [string, string[]][] = [
    ["BILLED TO", billed],
    ["ISSUED", [dt(inv.issue_date)]],
    ["DUE", [dt(inv.due_date)]],
  ];
  if (inv.job_id) meta.push(["JOB", [String(inv.job_id)]]);
  if (inv.period_label) meta.push(["PERIOD", [String(inv.period_label)]]);
  if (inv.po_number) meta.push(["PO NUMBER", [String(inv.po_number)]]);
  // Billed to takes the wide first column, the rest share what is left.
  const colW = [W * 0.36, ...meta.slice(1).map(() => (W * 0.64) / (meta.length - 1))];
  let mx = M, low = y;
  meta.forEach(([h, vals], i) => {
    text(h, mx, y, 7.5, bold, MUTE);
    let my = y - 14;
    for (const v of vals) for (const w of wrap(v, 10, colW[i] - 10)) { text(w, mx, my, 10); my -= 13; }
    low = Math.min(low, my);
    mx += colW[i];
  });
  y = low - 16;

  // ------------------------------------------------------------- lines
  const cQty = M + W * 0.64, cUnit = M + W * 0.8, cAmt = M + W;
  const descW = W * 0.58;
  const head = () => {
    text("SERVICE", M, y, 7.5, bold, MUTE);
    right("QTY", cQty, y, 7.5, bold, MUTE);
    right("UNIT", cUnit, y, 7.5, bold, MUTE);
    right("AMOUNT", cAmt, y, 7.5, bold, MUTE);
    y -= 7;
    page.drawLine({ start: { x: M, y }, end: { x: M + W, y }, thickness: 0.6, color: LINE });
    y -= 16;
  };
  head();
  for (const l of lines) {
    const unpriced = l.price_source === "needs_price";
    const desc = wrap(String(l.description ?? ""), 10, descW);
    const h = desc.length * 13 + (unpriced ? 12 : 0) + 12;
    if (y - h < M + 20) { newPage(); head(); }
    if (unpriced) page.drawRectangle({ x: M, y: y - h + 12, width: W, height: h, color: AMBER_BG });
    const qty = Number(l.qty) % 1 === 0 ? String(Number(l.qty)) : Number(l.qty).toFixed(2);
    right(qty, cQty, y, 10);
    right(unpriced ? "-" : money(l.unit_amount_pence, inv.currency), cUnit, y, 10);
    right(unpriced ? "-" : money(l.line_total_pence, inv.currency), cAmt, y, 10);
    let ly = y;
    for (const d of desc) { text(d, M, ly, 10, reg, unpriced ? AMBER : DEEP); ly -= 13; }
    if (unpriced) { text("PRICE NOT SET", M, ly, 7.5, bold, AMBER); ly -= 12; }
    y = ly - 2;
    page.drawLine({ start: { x: M, y: y + 6 }, end: { x: M + W, y: y + 6 }, thickness: 0.6, color: LINE });
    y -= 12;
  }

  // ------------------------------------------------ worker fee breakdown
  const wf = workerFeeBreakdown(inv);
  if (wf) {
    need(70);
    text("HOW THIS PAY IS WORKED OUT", M, y, 7.5, bold, MUTE); y -= 15;
    const row = (label: string, v: string, f: PDFFont = reg) => { text(label, M, y, 10, f); right(v, cAmt, y, 10, f); y -= 14; };
    row("Quoted labour", money(wf.labour, "JMD"));
    row(`Less Yaadly's worker fee (${wf.pct}%)`, "-" + money(wf.fee, "JMD"));
    row("Agreed rate, paid to you", money(wf.rate, "JMD"), bold);
    y -= 8;
  }

  // ------------------------------------------------------------ totals
  need(80);
  const tx = M + W - 210;
  text("Subtotal", tx, y, 10); right(money(inv.subtotal_pence, inv.currency), cAmt, y, 10); y -= 17;
  text("VAT", tx, y, 10); right(String(settings.invoice_vat_status ?? ""), cAmt, y, 10); y -= 10;
  page.drawRectangle({ x: tx, y, width: 210, height: 1.5, color: DEEP });
  y -= 20;
  text("Total", tx, y, 15, bold); right(money(inv.total_pence, inv.currency), cAmt, y, 15, bold);
  y -= 28;

  // ------------------------------------------------------- unpriced warn
  const unpriced = lines.filter((l) => l.price_source === "needs_price").length;
  if (unpriced) {
    const n = unpriced;
    const w = wrap(`Not ready to send. ${n} line${n > 1 ? "s have" : " has"} no price. The agent will not guess one. Price ${n > 1 ? "them" : "it"} or remove ${n > 1 ? "them" : "it"} first.`, 9.5, W - 24);
    const h = w.length * 12.5 + 16;
    need(h + 10);
    page.drawRectangle({ x: M, y: y - h + 10, width: W, height: h, color: AMBER_BG, borderColor: rgb(1, 0.878, 0.639), borderWidth: 0.8 });
    let wy = y - 4;
    for (const l of w) { text(l, M + 12, wy, 9.5, reg, AMBER); wy -= 12.5; }
    y -= h + 14;
  }

  // -------------------------------------------------------------- note
  if (inv.covering_note) {
    const w = wrap(String(inv.covering_note), 10, W - 30);
    const h = w.length * 13.5 + 34;
    need(Math.min(h, 200));
    page.drawRectangle({ x: M, y: y - h + 12, width: W, height: h, color: NOTE_BG });
    page.drawRectangle({ x: M, y: y - h + 12, width: 2.5, height: h, color: TEAL });
    text("NOTE", M + 16, y - 6, 7.5, bold, MUTE);
    let ny = y - 22;
    for (const l of w) {
      if (ny < M + 20) { newPage(); ny = y; }
      text(l, M + 16, ny, 10); ny -= 13.5;
    }
    y = ny - 18;
  }

  // ------------------------------------------------------------ footer
  // Same sentences, same conditions, as the footer in renderInvoice().
  const foot: { t: string; link?: string }[] = [];
  if (inv.payable_to === "worker") {
    foot.push({ t: "This is what Yaadly owes the tradesperson for this work. Yaadly pays them. It is not a bill to the client, who pays Yaadly for the job." });
  } else {
    foot.push({ t: String(settings.invoice_payment_terms ?? "") }, { t: String(settings.invoice_pay_to ?? "") });
    if (inv._payUrl && inv.status === "sent") foot.push({ t: "Pay this invoice by card: pay online", link: String(inv._payUrl) });
    if (settings.invoice_bank_details) foot.push({ t: `Bank transfer: ${settings.invoice_bank_details}. Use ${inv.id} as the reference.` });
  }
  foot.push(
    { t: `${settings.invoice_vat_status ? settings.invoice_vat_status + ". " : ""}${settings.invoice_issuer_name ?? ""} is registered in England and Wales, company number ${settings.invoice_issuer_number ?? ""}.` },
    { t: "Services are project management, observation and documentation. They are not a survey, a valuation, a legal opinion or a quantity surveyor's estimate." },
  );
  const fw = foot.map((f) => ({ ...f, lines: f.t ? wrap(f.t, 8.5, W) : [] }));
  need(fw.reduce((a, f) => a + f.lines.length * 11.5, 0) + 20);
  page.drawLine({ start: { x: M, y }, end: { x: M + W, y }, thickness: 0.6, color: LINE });
  y -= 16;
  for (const f of fw) {
    for (const l of f.lines) {
      text(l, M, y, 8.5, reg, MUTE);
      if (f.link) {
        // The words "pay online" are the link, as in the email.
        const x0 = M + reg.widthOfTextAtSize(clean("Pay this invoice by card: "), 8.5);
        page.drawLine({ start: { x: x0, y: y - 1.5 }, end: { x: x0 + reg.widthOfTextAtSize("pay online", 8.5), y: y - 1.5 }, thickness: 0.5, color: MUTE });
        const annot = doc.context.obj({
          Type: "Annot", Subtype: "Link", Border: [0, 0, 0],
          Rect: [x0, y - 3, x0 + reg.widthOfTextAtSize("pay online", 8.5), y + 9],
          A: { Type: "Action", S: "URI", URI: PDFString.of(f.link) },
        });
        page.node.addAnnot(doc.context.register(annot));
      }
      y -= 11.5;
    }
  }

  // Page numbers once the count is known, only when there is more than one.
  const pages = doc.getPages();
  if (pages.length > 1) pages.forEach((p, i) => {
    const s = `Page ${i + 1} of ${pages.length}`;
    p.drawText(s, { x: A4[0] - M - reg.widthOfTextAtSize(s, 8), y: M / 2, size: 8, font: reg, color: MUTE });
  });

  return await doc.save();
}
