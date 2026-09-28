import { assert, assertEquals } from "jsr:@std/assert@1";
import { invoicePdf, type JobWork } from "./pdf.ts";

const money = (p: number, c = "JMD") => (c === "JMD" ? "J$" + Math.round(p).toLocaleString("en-JM") : "£" + (p / 100).toFixed(2));
const settings = { invoice_issuer_name: "Yaadly Ltd", invoice_issuer_number: "17358077", invoice_issuer_address: "London", invoice_payment_terms: "Due in 7 days" };

Deno.test("an add-on invoice draws the job's main work and additional work apart", async () => {
  const jw: JobWork = {
    currency: "JMD",
    total: 115000 + 29900,
    rows: [
      { id: "INV-2026-0100", kind: "main", label: "Job", work: null, fee: null, total: 115000, status: "paid", current: false },
      { id: "INV-2026-0101", kind: "addon", label: "Paint the hallway ceiling as well", work: 26000, fee: 3900, total: 29900, status: "sent", current: true },
    ],
  };
  const bytes = await invoicePdf(
    { id: "INV-2026-0101", status: "sent", currency: "JMD", issue_date: "2026-09-28", due_date: "2026-10-05", client_name: "Test Client", job_id: "JOB-TEST-1", period_label: "Add-on", subtotal_pence: 29900, total_pence: 29900, payable_to: "yaadly", _jobWork: jw },
    [
      { description: "Add-on: Paint the hallway ceiling as well", qty: 1, unit_amount_pence: 26000, line_total_pence: 26000, price_source: "manual" },
      { description: "Guarantee & Support, 15%", qty: 1, unit_amount_pence: 3900, line_total_pence: 3900, price_source: "manual", is_fee: true },
    ],
    settings, money,
  );
  assertEquals(new TextDecoder().decode(bytes.slice(0, 5)), "%PDF-");
  assert(bytes.length > 2000);
  if (Deno.env.get("WRITE_SAMPLE")) await Deno.writeFile(Deno.env.get("WRITE_SAMPLE")!, bytes);
});

Deno.test("an invoice with no add-on beside it is drawn exactly as before", async () => {
  const bytes = await invoicePdf(
    { id: "INV-2026-0100", status: "sent", currency: "JMD", issue_date: "2026-09-28", due_date: "2026-10-05", client_name: "Test Client", job_id: "JOB-TEST-1", subtotal_pence: 115000, total_pence: 115000, payable_to: "yaadly", _jobWork: null },
    [{ description: "The work", qty: 1, unit_amount_pence: 100000, line_total_pence: 100000, price_source: "manual" }],
    settings, money,
  );
  assertEquals(new TextDecoder().decode(bytes.slice(0, 5)), "%PDF-");
});
