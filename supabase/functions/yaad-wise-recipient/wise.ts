/**
 * The small, testable parts of yaad-wise-recipient. No imports, no network.
 *
 * The field rules come from Wise's own account-requirements for a GBP to JMD
 * payment, read live on 14 Sep 2026: route type swift_code; recipient type,
 * account number, SWIFT/BIC, transit code, and an address in Jamaica (city
 * and first line; Wise drops the post code once the country is Jamaica).
 */

export type BankInput = {
  accountHolderName: string;
  accountNumber: string;
  swiftCode: string;
  branchCode: string;
  city: string;
  firstLine: string;
};

export type Checked = { ok: true; value: BankInput } | { ok: false; errors: Record<string, string> };

const clean = (s: unknown) => String(s ?? "").trim().replace(/\s+/g, " ");

/** Checks a worker's details against Wise's rules before anything is sent. */
export function checkBankInput(raw: Record<string, unknown>): Checked {
  const v: BankInput = {
    accountHolderName: clean(raw.accountHolderName),
    accountNumber: clean(raw.accountNumber).replace(/\s/g, ""),
    swiftCode: clean(raw.swiftCode).replace(/\s/g, "").toUpperCase(),
    branchCode: clean(raw.branchCode).replace(/\s/g, ""),
    city: clean(raw.city),
    firstLine: clean(raw.firstLine),
  };
  const errors: Record<string, string> = {};
  if (v.accountHolderName.length < 2 || v.accountHolderName.length > 140) {
    errors.accountHolderName = "Type your full name exactly as it shows on the account.";
  }
  if (!/^[a-zA-Z0-9]{4,34}$/.test(v.accountNumber)) {
    errors.accountNumber = "Type your account number, digits only.";
  }
  if (!/^[a-zA-Z]{6}(([a-zA-Z0-9]{2})|([a-zA-Z0-9]{5}))$/.test(v.swiftCode) || !/^[A-Z]{4}JM/.test(v.swiftCode)) {
    errors.swiftCode = "Choose your bank, or type your bank's SWIFT code. It has 8 or 11 letters and numbers, with JM in the middle.";
  }
  if (!/^[a-zA-Z0-9]{2,15}$/.test(v.branchCode)) {
    errors.branchCode = "Type your branch or transit number.";
  }
  if (v.city.length < 1 || v.city.length > 255) errors.city = "Type your town or city.";
  if (v.firstLine.length < 1 || v.firstLine.length > 255) errors.firstLine = "Type your home address.";
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value: v };
}

/** The body Wise's POST /v1/accounts expects for a person in Jamaica, paid in JMD. */
export function wiseRecipientBody(profileId: number, v: BankInput) {
  return {
    profile: profileId,
    accountHolderName: v.accountHolderName,
    currency: "JMD",
    type: "swift_code",
    ownedByCustomer: false,
    details: {
      legalType: "PRIVATE",
      accountNumber: v.accountNumber,
      swiftCode: v.swiftCode,
      branchCode: v.branchCode,
      address: { country: "JM", city: v.city, firstLine: v.firstLine },
    },
  };
}

/**
 * Wise's validation errors, turned into the form's field names. Only Wise's
 * own message and the field are kept: never the value that was typed.
 */
// deno-lint-ignore no-explicit-any
export function wiseFieldErrors(body: any): Record<string, string> {
  const out: Record<string, string> = {};
  const map: Record<string, keyof BankInput> = {
    accountHolderName: "accountHolderName",
    accountNumber: "accountNumber",
    swiftCode: "swiftCode",
    branchCode: "branchCode",
    "address.city": "city",
    "address.firstLine": "firstLine",
  };
  for (const e of Array.isArray(body?.errors) ? body.errors : []) {
    const path = String(e?.path ?? "").replace(/^details\./, "");
    const field = map[path];
    if (field && !out[field]) out[field] = String(e?.message ?? "Wise could not accept this.").slice(0, 200);
  }
  return out;
}
