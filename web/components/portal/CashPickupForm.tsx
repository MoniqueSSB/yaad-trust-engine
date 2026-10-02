"use client";

import { useState } from "react";
import { saveCashPickup } from "@/app/portal/pickup-actions";
import { PARISHES } from "@/lib/taxonomy";

/**
 * MoneyGram cash pick-up, for a worker with no bank account (20261001194258).
 * Asks for two things only: the name exactly as it shows on their ID, and the
 * parish they will collect in. Never an ID number, never a pick-up reference.
 */
const input =
  "w-full rounded-xl border border-line bg-bg px-3.5 py-2.5 text-[13.5px] text-ink outline-none focus:border-teal";
const label = "grid gap-1 text-[12.5px] font-bold text-mute";

export function CashPickupForm({ name, parish }: { name: string | null; parish: string | null }) {
  const [open, setOpen] = useState(!name);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  if (done) {
    return <p role="status" className="mt-3 text-[13.5px] leading-relaxed text-ink">{done}</p>;
  }
  if (!open) {
    return (
      <div className="mt-3 flex flex-wrap gap-4">
        <button type="button" onClick={() => setOpen(true)} className="text-[12.5px] font-bold text-tealb underline-offset-2 hover:underline">
          Change my pick-up details
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const fd = new FormData();
            fd.set("name", "");
            fd.set("parish", "");
            const out = await saveCashPickup(fd);
            setBusy(false);
            if (!out.ok) return setErr(out.error);
            setDone("Cash pick-up removed. Yaadly will pay you by bank transfer.");
          }}
          className="text-[12.5px] font-bold text-coral underline-offset-2 hover:underline disabled:opacity-40"
        >
          Stop cash pick-up
        </button>
        {err && <p role="alert" className="w-full text-[12.5px] leading-relaxed text-coral">{err}</p>}
      </div>
    );
  }

  return (
    <form
      action={async (fd) => {
        setBusy(true);
        setErr(null);
        const out = await saveCashPickup(fd);
        setBusy(false);
        if (!out.ok) return setErr(out.error);
        setDone("Saved. Yaadly will call you on the number we have for you to check your name before any money goes.");
      }}
      className="mt-4 grid gap-3"
      autoComplete="off"
    >
      <label className={label}>
        Your full name, exactly as it shows on your ID
        <input name="name" required defaultValue={name ?? ""} className={input} />
      </label>
      <label className={label}>
        Parish you will collect in
        <select name="parish" required defaultValue={parish ?? ""} className={input}>
          <option value="" disabled>Choose a parish</option>
          {PARISHES.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
      </label>
      <div>
        <button
          disabled={busy}
          className="rounded-full bg-linear-to-r from-teal to-mango px-4 py-2.5 text-[12.5px] font-bold text-onbrand disabled:opacity-40"
        >
          {busy ? "Saving..." : "Use cash pick-up"}
        </button>
      </div>
      {err && <p role="alert" className="text-[12.5px] leading-relaxed text-coral">{err}</p>}
    </form>
  );
}
