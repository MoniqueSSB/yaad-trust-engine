import { assert, assertEquals, assertFalse } from "jsr:@std/assert@1";
import { addonPdfToken, addonPdfUrl, verifyAddonPdfToken } from "./addon-link.ts";

const SECRET = "test-secret";
const ID = "0b5c7d1e-0000-4000-8000-000000000001";

Deno.test("a token opens its own revision", async () => {
  const t = await addonPdfToken(ID, 2, SECRET);
  assertEquals(t.length, 32);
  assert(await verifyAddonPdfToken(ID, 2, t, SECRET));
});

Deno.test("a token does not open another revision or another add-on", async () => {
  const t = await addonPdfToken(ID, 2, SECRET);
  assertFalse(await verifyAddonPdfToken(ID, 3, t, SECRET));
  assertFalse(await verifyAddonPdfToken(ID.replace(/1$/, "2"), 2, t, SECRET));
  assertFalse(await verifyAddonPdfToken(ID, 2, t, "another-secret"));
  assertFalse(await verifyAddonPdfToken(ID, 2, "", SECRET));
});

Deno.test("the url names the function, the add-on, the revision and the token", async () => {
  const u = new URL(await addonPdfUrl("https://x.supabase.co", ID, 1, SECRET));
  assertEquals(u.pathname, "/functions/v1/yaad-addon-pdf");
  assertEquals(u.searchParams.get("a"), ID);
  assertEquals(u.searchParams.get("r"), "1");
  assert(await verifyAddonPdfToken(ID, 1, u.searchParams.get("t") ?? "", SECRET));
});
