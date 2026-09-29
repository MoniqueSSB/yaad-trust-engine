"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setJobWhatsApp } from "@/app/portal/job-actions";

/**
 * Where the client's updates go, on the Job details tab (founder, 29 Sep
 * 2026: "the client should be informed on whatsapp of the job update"). The
 * client adds, changes or removes their own number. Nobody else is shown it:
 * the page renders this for the client only and reads the number with the
 * client's own session.
 */
export function JobWhatsApp({
  jobId,
  phone,
  closed,
}: {
  jobId: string;
  phone: string | null;
  closed: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(phone ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const has = !!(phone && phone.trim());

  const save = async (next: string) => {
    setBusy(true); setError("");
    const r = await setJobWhatsApp(jobId, next);
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    setEditing(false);
    router.refresh();
  };

  return (
    <section id="whatsapp" className="mt-4 scroll-mt-6 rounded-2xl border border-line bg-panel p-5">
      <h2 className="text-[10.5px] font-bold uppercase tracking-[.2em] text-tealb">Updates on WhatsApp</h2>
      {has ? (
        <p className="mt-2 text-[14.5px] leading-relaxed text-ink">
          {phone}
          <span className="block text-[12.5px] text-dim">
            Each report from your tradesperson comes to this number, with the photographs. Email carries on as well.
          </span>
        </p>
      ) : (
        <p className="mt-2 text-[13px] leading-relaxed text-mute">
          Your updates come by email. Add a WhatsApp number and each report from your tradesperson comes there too, with the photographs. It is used for updates on this job and nothing else.
        </p>
      )}

      {!closed && !editing && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => { setEditing(true); setError(""); setValue(phone ?? ""); }}
            className="rounded-full border border-teal bg-soft px-4 py-1.5 text-[12.5px] font-bold text-tealb"
          >
            {has ? "Change the number" : "Add a WhatsApp number"}
          </button>
          {has && (
            <button
              type="button"
              disabled={busy}
              onClick={() => save("")}
              className="rounded-full border border-line2 px-4 py-1.5 text-[12.5px] text-ink disabled:opacity-40"
            >
              {busy ? "Removing…" : "Remove it"}
            </button>
          )}
        </div>
      )}
      {!editing && error && <p role="alert" className="mt-2 text-[12.5px] text-coral">{error}</p>}

      {!closed && editing && (
        <form
          className="mt-3 grid gap-2"
          onSubmit={(e) => { e.preventDefault(); void save(value); }}
        >
          <input
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            maxLength={24}
            placeholder="+447700900123"
            className="w-full rounded-xl border border-line bg-bg px-3.5 py-3 text-[13.5px] text-ink outline-none focus:border-teal"
          />
          <p className="text-[11.5px] text-dim">
            Start with + and the country code: +44 for the UK, +1 for Jamaica, the US and Canada. Seen by Yaadly only, never by the tradesperson. You can remove it at any time.
          </p>
          {error && <p role="alert" className="text-[12.5px] text-coral">{error}</p>}
          <div className="flex gap-2">
            <button type="submit" disabled={busy || value.replace(/\D/g, "").length < 9}
              className="rounded-full bg-linear-to-r from-teal to-mango px-4 py-2 text-[13px] font-bold text-onbrand disabled:opacity-40">
              {busy ? "Saving…" : "Save the number"}
            </button>
            <button type="button" disabled={busy} onClick={() => setEditing(false)}
              className="rounded-full border border-line2 px-4 py-2 text-[13px] text-ink">
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
