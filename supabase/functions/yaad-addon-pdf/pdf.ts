// One revision of an add-on, as a one-page PDF for the client (20260928235000).
//
// Sent as a WhatsApp attachment when the tradesperson changes an add-on, so
// the client can read exactly what they are being asked to accept and reply
// CONFIRM <code>. Edits happen only in the portal (founder, 28 Sep 2026), so
// the page says where, and offers nothing else.
//
// The money is the same arithmetic as _draft_addon_client_invoice(): the
// agreed amount for the work, plus 15% Guarantee & Support on top. Change one,
// change the other. Pure: rows in, bytes out, so the test runs it offline.

import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "npm:pdf-lib@1.17.1";

export type AddonForPdf = {
  id: string;
  rev: number;
  scope: string;
  amount_jmd: number;
  terms: "in_full" | "half_now_half_on_signoff";
  status: string;
  last_edit_side: "client" | "worker";
  confirm_code: string;
  updated_at: string;
  agreed_at: string | null;
};
export type JobForPdf = { id: string; title: string | null; parish: string | null };

const A4: [number, number] = [595.28, 841.89];
const M = 48;
const W = A4[0] - 2 * M;
const DEEP = rgb(0.031, 0.067, 0.059);
const MUTE = rgb(0.369, 0.467, 0.447);
const LINE = rgb(0.863, 0.902, 0.886);
const TEAL = rgb(0.078, 0.722, 0.651);
const NOTE_BG = rgb(0.957, 0.969, 0.965);

const jmd = (n: number) => "J$" + Math.round(n).toLocaleString("en-US");
const day = (s: string | null) =>
  s ? new Date(s).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "America/Jamaica" }) : "";

/** The client's side of the money, as the invoice will carry it. */
export function addonMoney(amountJmd: number, terms: AddonForPdf["terms"]) {
  const amount = Math.round(Number(amountJmd) || 0);
  const parts = terms === "in_full" ? [amount] : [Math.floor((amount + 1) / 2), amount - Math.floor((amount + 1) / 2)];
  const fee = parts.reduce((t, w) => t + Math.round(w * 0.15), 0);
  return { amount, fee, total: amount + fee };
}

export async function addonPdf(a: AddonForPdf, job: JobForPdf, portalUrl: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Add-on to ${job.id}, version ${a.rev}`);
  doc.setAuthor("Yaadly");
  doc.setCreator("Yaadly");
  doc.setProducer("Yaadly");
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  // Helvetica draws Windows-1252 only; anything else becomes "?" rather than
  // stopping the page, as in yaad-invoice/pdf.ts.
  const charset = new Set(reg.getCharacterSet());
  const clean = (s: unknown) =>
    String(s ?? "").replace(/\r/g, "").replace(/[‐‑‒−–—]/g, "-").replace(/[^\n]/gu, (c) => (charset.has(c.codePointAt(0)!) ? c : "?"));

  const page: PDFPage = doc.addPage(A4);
  let y = A4[1] - M;
  const text = (s: string, x: number, size: number, font: PDFFont = reg, color = DEEP) =>
    page.drawText(clean(s), { x, y, size, font, color });
  const wrap = (s: string, size: number, width: number, font: PDFFont = reg): string[] => {
    const out: string[] = [];
    for (const para of clean(s).split("\n")) {
      let cur = "";
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const next = cur ? cur + " " + word : word;
        if (font.widthOfTextAtSize(next, size) <= width) { cur = next; continue; }
        if (cur) out.push(cur);
        cur = word;
        while (font.widthOfTextAtSize(cur, size) > width && cur.length > 1) {
          let cut = cur.length - 1;
          while (cut > 1 && font.widthOfTextAtSize(cur.slice(0, cut), size) > width) cut--;
          out.push(cur.slice(0, cut));
          cur = cur.slice(cut);
        }
      }
      out.push(cur);
    }
    return out;
  };
  const para = (s: string, size = 10.5, font: PDFFont = reg, color = DEEP, width = W, x = M) => {
    for (const l of wrap(s, size, width, font)) { text(l, x, size, font, color); y -= size * 1.45; }
  };
  const rule = () => { page.drawLine({ start: { x: M, y }, end: { x: M + W, y }, thickness: 0.8, color: LINE }); y -= 16; };

  // Head
  text("Yaadly", M, 20, bold);
  const ref = `ADD-ON  ·  ${job.id}  ·  VERSION ${a.rev}`;
  page.drawText(clean(ref), { x: M + W - reg.widthOfTextAtSize(clean(ref), 8), y: y + 6, size: 8, font: reg, color: MUTE });
  y -= 14;
  page.drawLine({ start: { x: M, y }, end: { x: M + W, y }, thickness: 1.4, color: DEEP });
  y -= 30;

  text("EXTRA WORK ON YOUR JOB", M, 8.5, bold, TEAL);
  y -= 22;
  para(job.title || job.id, 20, bold);
  para([job.parish, `Version ${a.rev}, ${a.last_edit_side === "worker" ? "changed by your tradesperson" : "as you wrote it"}, ${day(a.updated_at)}`].filter(Boolean).join("  ·  "), 9.5, reg, MUTE);
  y -= 10;
  rule();

  text("THE EXTRA WORK", M, 8.5, bold, MUTE);
  y -= 16;
  para(a.scope, 11);
  y -= 8;
  rule();

  // Money
  const m = addonMoney(a.amount_jmd, a.terms);
  const row = (label: string, value: string, strong = false) => {
    const f = strong ? bold : reg;
    text(label, M, strong ? 11.5 : 10.5, f, strong ? DEEP : MUTE);
    page.drawText(clean(value), { x: M + W - f.widthOfTextAtSize(clean(value), strong ? 11.5 : 10.5), y, size: strong ? 11.5 : 10.5, font: f, color: DEEP });
    y -= 18;
  };
  text("WHAT YOU PAY", M, 8.5, bold, MUTE);
  y -= 18;
  row("The work, the amount agreed with your tradesperson", jmd(m.amount));
  row("Guarantee & Support, 15%", jmd(m.fee));
  row("You pay", jmd(m.total), true);
  y -= 2;
  para(a.terms === "in_full"
    ? "Paid in full, before the extra work starts."
    : "Half before the extra work starts, and half once it is done and signed off.", 10, reg, MUTE);
  y -= 8;
  rule();

  // What to do
  const boxTop = y + 8;
  const lines: [string, PDFFont][] = a.status === "with_client"
    ? [
      ["To accept this version, reply on WhatsApp:", bold],
      [`CONFIRM ${a.confirm_code}`, bold],
      ["To change it or turn it down, open your job in the Yaadly portal. Changes are made there only:", reg],
      [portalUrl, reg],
    ]
    : a.status === "agreed" || a.status === "signed_off"
    ? [[`Agreed by you and your tradesperson${a.agreed_at ? " on " + day(a.agreed_at) : ""}. Its invoice comes from Yaadly.`, reg], [portalUrl, reg]]
    : [["This version is not waiting on you. Your job in the Yaadly portal shows where it stands:", reg], [portalUrl, reg]];
  const boxLines = lines.flatMap(([s, f]) => wrap(s, s.startsWith("CONFIRM ") ? 16 : 10.5, W - 28, f).map((l) => [l, f, s.startsWith("CONFIRM ") ? 16 : 10.5] as const));
  const boxH = boxLines.reduce((t, [, , size]) => t + size * 1.5, 0) + 22;
  page.drawRectangle({ x: M, y: boxTop - boxH, width: W, height: boxH, color: NOTE_BG, borderColor: TEAL, borderWidth: 0.8 });
  y = boxTop - 20;
  for (const [l, f, size] of boxLines) { text(l, M + 14, size, f, DEEP); y -= size * 1.5; }
  y = boxTop - boxH - 24;

  para("Your original job, its agreed scope and its payment stages do not change. You buy the job, and this add-on, from Yaadly at the price above; Yaadly engages and pays your tradesperson. The job is not finished until any agreed add-on is done and signed off by a named person at Yaadly.", 9, reg, MUTE);

  return await doc.save();
}
