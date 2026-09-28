import { assert, assertEquals } from "jsr:@std/assert@1";
import { addonMoney, addonPdf } from "./pdf.ts";

Deno.test("the money matches the invoice the database drafts", () => {
  assertEquals(addonMoney(26000, "in_full"), { amount: 26000, fee: 3900, total: 29900 });
  // half and half: 15% on each half, rounded per invoice
  const h = addonMoney(15001, "half_now_half_on_signoff");
  assertEquals(h.fee, Math.round(7501 * 0.15) + Math.round(7500 * 0.15));
});

Deno.test("a PDF is drawn, including characters Helvetica cannot draw", async () => {
  const bytes = await addonPdf({
    id: "0b5c7d1e-0000-4000-8000-000000000001", rev: 2,
    scope: "Paint the hallway ceiling too, two coats 🎨, and a very long word Aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    amount_jmd: 26000, terms: "in_full", status: "with_client", last_edit_side: "worker",
    confirm_code: "A1B2C3", updated_at: "2026-09-28T12:00:00Z", agreed_at: null,
  }, { id: "JOB-TEST-1", title: "Repaint bedrooms", parish: "St Catherine" }, "https://app.yaadly.co.uk/portal/jobs/JOB-TEST-1?tab=extra");
  assert(bytes.length > 1000);
  assertEquals(new TextDecoder().decode(bytes.slice(0, 5)), "%PDF-");
});
