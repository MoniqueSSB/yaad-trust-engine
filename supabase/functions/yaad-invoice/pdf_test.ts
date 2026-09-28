// The invoice PDF (pdf.ts). Invented rows only.
import { assert, assertEquals } from "jsr:@std/assert";
import { PDFDocument } from "npm:pdf-lib@1.17.1";
import { invoicePdf } from "./pdf.ts";

const money = (pence: number, currency = "GBP") =>
  currency === "JMD"
    ? "J$" + Math.round(pence).toLocaleString("en-JM")
    : "£" + (pence / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const settings = {
  invoice_issuer_name: "Yaadly Ltd", invoice_issuer_number: "00000000",
  invoice_issuer_address: "1 Test Street\nLondon", invoice_issuer_email: "test@example.com",
  invoice_issuer_phone: "000", invoice_vat_status: "Not VAT registered",
  invoice_payment_terms: "Due in 14 days.", invoice_pay_to: "Pay Yaadly Ltd.",
};
const inv = {
  id: "INV-TEST-1", status: "draft", client_name: "Test Client", client_email: "client@example.com",
  issue_date: "2026-09-28", due_date: "2026-10-12", subtotal_pence: 4500, total_pence: 4500, currency: "GBP",
};
const line = (d: string) => ({ description: d, qty: 1, unit_amount_pence: 4500, line_total_pence: 4500, price_source: "catalogue" });

const links = async (bytes: Uint8Array) => {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().flatMap((p) => p.node.Annots()?.asArray() ?? []).length;
};

Deno.test("an invoice comes out as a one page PDF", async () => {
  const bytes = await invoicePdf(inv, [line("Visual Check")], settings, money);
  assertEquals(new TextDecoder().decode(bytes.slice(0, 5)), "%PDF-");
  assertEquals((await PDFDocument.load(bytes)).getPageCount(), 1);
});

Deno.test("a long invoice runs onto more pages rather than off the bottom", async () => {
  const many = Array.from({ length: 60 }, (_, i) => line(`Site visit ${i + 1}, a description long enough to wrap onto a second line of the table`));
  const bytes = await invoicePdf(inv, many, settings, money);
  assert((await PDFDocument.load(bytes)).getPageCount() >= 3);
});

Deno.test("a character Helvetica cannot draw does not stop the invoice", async () => {
  const bytes = await invoicePdf({ ...inv, client_name: "Test 🚧 Client 李" }, [line("Roof − repair \u{1F3E0}")], settings, money);
  assertEquals((await PDFDocument.load(bytes)).getPageCount(), 1);
});

Deno.test("the pay link is clickable only on a sent client invoice", async () => {
  const sent = { ...inv, status: "sent", _payUrl: "https://example.com/pay" };
  assertEquals(await links(await invoicePdf(sent, [line("Visual Check")], settings, money)), 1);
  assertEquals(await links(await invoicePdf({ ...sent, status: "draft" }, [line("Visual Check")], settings, money)), 0);
  assertEquals(await links(await invoicePdf({ ...sent, payable_to: "worker" }, [line("Visual Check")], settings, money)), 0);
});

Deno.test("Jamaican dollar invoices and unpriced lines draw without error", async () => {
  const bytes = await invoicePdf(
    { ...inv, currency: "JMD", subtotal_pence: 45000, total_pence: 45000, covering_note: "A note.\nTwo lines." },
    [line("Painting"), { description: "Unknown", qty: 1, unit_amount_pence: 0, line_total_pence: 0, price_source: "needs_price" }],
    settings, money,
  );
  assertEquals((await PDFDocument.load(bytes)).getPageCount(), 1);
});
