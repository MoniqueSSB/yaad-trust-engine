import { assertEquals } from "jsr:@std/assert@1";
import { parseAddonConfirm } from "./addon-confirm.ts";

Deno.test("CONFIRM and a code, in any case, is read", () => {
  assertEquals(parseAddonConfirm("CONFIRM A1B2C3"), "A1B2C3");
  assertEquals(parseAddonConfirm("  confirm a1b2c3. "), "A1B2C3");
  assertEquals(parseAddonConfirm("Confirm A1B2C3!"), "A1B2C3");
});

Deno.test("anything else falls through", () => {
  assertEquals(parseAddonConfirm("yes"), null);
  assertEquals(parseAddonConfirm("CONFIRM"), null);
  assertEquals(parseAddonConfirm("CONFIRM JOB-WA-123"), null);
  assertEquals(parseAddonConfirm("I confirm A1B2C3 but can we change the colour"), null);
  assertEquals(parseAddonConfirm("CONFIRM A1B2C3D"), null);
});
