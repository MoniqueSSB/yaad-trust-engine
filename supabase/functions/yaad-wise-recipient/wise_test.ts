// yaad-wise-recipient: what is checked before a worker's details go to Wise,
// and what is kept afterwards. 20260914240000.
//
// Run: deno test --allow-read supabase/functions/

import { assert, assertEquals } from "jsr:@std/assert@1";
import { checkBankInput, wiseFieldErrors, wiseRecipientBody } from "./wise.ts";

const good = {
  accountHolderName: "  Devon   Brown ",
  accountNumber: "0 612 345 678",
  swiftCode: "jncbjmkx",
  branchCode: "06 125",
  city: "Kingston",
  firstLine: "12 Hope Road",
};

Deno.test("good details are tidied, not rejected", () => {
  const r = checkBankInput(good);
  assert(r.ok);
  if (r.ok) {
    assertEquals(r.value.accountHolderName, "Devon Brown");
    assertEquals(r.value.accountNumber, "0612345678");
    assertEquals(r.value.swiftCode, "JNCBJMKX");
    assertEquals(r.value.branchCode, "06125");
  }
});

Deno.test("a SWIFT code outside Jamaica is refused", () => {
  const r = checkBankInput({ ...good, swiftCode: "BUKBGB22" });
  assert(!r.ok && "swiftCode" in r.errors);
});

Deno.test("every missing field is named", () => {
  const r = checkBankInput({});
  assert(!r.ok);
  if (!r.ok) {
    for (const k of ["accountHolderName", "accountNumber", "swiftCode", "branchCode", "city", "firstLine"]) {
      assert(k in r.errors, `${k} not reported`);
    }
  }
});

Deno.test("the Wise body is a person in Jamaica, paid in JMD, not owned by Yaadly", () => {
  const r = checkBankInput(good);
  assert(r.ok);
  if (!r.ok) return;
  const b = wiseRecipientBody(123, r.value);
  assertEquals(b.currency, "JMD");
  assertEquals(b.type, "swift_code");
  assertEquals(b.ownedByCustomer, false);
  assertEquals(b.details.legalType, "PRIVATE");
  assertEquals(b.details.address.country, "JM");
});

Deno.test("Wise's errors keep the field and message, never the typed value", () => {
  const out = wiseFieldErrors({ errors: [{ path: "details.accountNumber", message: "Please enter a valid account number", arguments: ["0612345678"] }] });
  assertEquals(out, { accountNumber: "Please enter a valid account number" });
  assert(!JSON.stringify(out).includes("0612345678"));
});
