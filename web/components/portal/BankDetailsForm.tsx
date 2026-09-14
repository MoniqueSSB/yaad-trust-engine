"use client";

import { useState } from "react";
import { saveBankDetails } from "@/app/portal/bank-actions";

/**
 * The worker's bank details, sent straight to Yaadly's Wise account.
 * The fields are what Wise asks for to pay J$ into a Jamaican bank account
 * (20260914240000). SWIFT codes below were checked on Wise's own SWIFT pages
 * on 14 Sep 2026; any other bank types its own.
 */
const BANKS: { swift: string; name: string }[] = [
  { swift: "JNCBJMKX", name: "NCB (National Commercial Bank)" },
  { swift: "NOSCJMKN", name: "Scotiabank Jamaica" },
  { swift: "JNBSJMKN", name: "JN Bank" },
  { swift: "SAJAJMKN", name: "Sagicor Bank" },
  { swift: "FILBJMKN", name: "First Global Bank" },
  { swift: "JMJAJMKN", name: "JMMB Bank" },
  { swift: "FCIBJMKN", name: "CIBC Caribbean (Jamaica)" },
];

const input =
  "w-full rounded-xl border border-line bg-bg px-3.5 py-2.5 text-[13.5px] text-ink outline-none focus:border-teal";
const label = "grid gap-1 text-[12.5px] font-bold text-mute";

export function BankDetailsForm({ hasDetails }: { hasDetails: boolean }) {
  const [open, setOpen] = useState(!hasDetails);
  const [bank, setBank] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);

  if (saved) {
    return (
      <p role="status" className="mt-3 text-[13.5px] leading-relaxed text-ink">
        Sent to Wise. Yaadly will call you on the number we have for you to check them before any money goes.
      </p>
    );
  }
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="mt-3 text-[12.5px] font-bold text-tealb underline-offset-2 hover:underline">
        Change my bank details
      </button>
    );
  }

  const fieldErr = (k: string) =>
    fields[k] ? <span className="text-[12px] font-normal leading-relaxed text-coral">{fields[k]}</span> : null;

  return (
    <form
      action={async (fd) => {
        setBusy(true);
        setErr(null);
        setFields({});
        const out = await saveBankDetails(fd);
        setBusy(false);
        if (!out.ok) {
          setErr(out.error);
          setFields(out.fields);
          return;
        }
        setSaved(true);
      }}
      className="mt-4 grid gap-3"
      autoComplete="off"
    >
      <label className={label}>
        Full name, exactly as it shows on the account
        <input name="accountHolderName" required className={input} />
        {fieldErr("accountHolderName")}
      </label>
      <label className={label}>
        Bank
        <select name="bank" required value={bank} onChange={(e) => setBank(e.target.value)} className={input}>
          <option value="" disabled>Choose your bank</option>
          {BANKS.map((b) => (
            <option key={b.swift} value={b.swift}>{b.name}</option>
          ))}
          <option value="other">Another bank</option>
        </select>
      </label>
      {bank === "other" && (
        <label className={label}>
          Your bank&apos;s SWIFT code (ask your bank, or look on its website)
          <input name="swiftCode" required className={input} placeholder="8 or 11 letters and numbers, with JM in the middle" />
          {fieldErr("swiftCode")}
        </label>
      )}
      {bank !== "other" && fieldErr("swiftCode")}
      <label className={label}>
        Branch or transit number
        <input name="branchCode" required inputMode="numeric" className={input} />
        {fieldErr("branchCode")}
      </label>
      <label className={label}>
        Account number
        <input name="accountNumber" required inputMode="numeric" className={input} />
        {fieldErr("accountNumber")}
      </label>
      <label className={label}>
        Home address
        <input name="firstLine" required className={input} placeholder="e.g. 12 Hope Road" />
        {fieldErr("firstLine")}
      </label>
      <label className={label}>
        Town or city
        <input name="city" required className={input} placeholder="e.g. Kingston" />
        {fieldErr("city")}
      </label>
      <p className="text-[12px] leading-relaxed text-dim">
        It must be a J$ account in your own name. Your details go straight to Wise, the service Yaadly pays through.
        Yaadly does not keep them.
      </p>
      <div>
        <button
          disabled={busy}
          className="rounded-full bg-linear-to-r from-teal to-mango px-4 py-2.5 text-[12.5px] font-bold text-onbrand disabled:opacity-40"
        >
          {busy ? "Sending to Wise..." : "Send my bank details to Wise"}
        </button>
      </div>
      {err && <p role="alert" className="text-[12.5px] leading-relaxed text-coral">{err}</p>}
    </form>
  );
}
