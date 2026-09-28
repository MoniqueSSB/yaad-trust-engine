"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setJobAddress } from "@/app/portal/job-actions";

/**
 * Where the job is, on the Job details tab (founder, 28 Sep 2026: its own
 * section, not the overview). The client adds or corrects it; the booked
 * worker reads it. Nobody else is shown it, which the page decides before
 * this renders.
 */
export function JobAddress({
  jobId,
  role,
  addr,
  parish,
  booked,
  closed,
}: {
  jobId: string;
  role: "client" | "worker";
  addr: string | null;
  parish: string | null;
  /** a tradesperson is booked, so somebody needs to find the place */
  booked: boolean;
  closed: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(addr ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const canEdit = role === "client" && !closed;

  return (
    <section id="address" className="mt-4 scroll-mt-6 rounded-2xl border border-line bg-panel p-5">
      <h2 className="text-[10.5px] font-bold uppercase tracking-[.2em] text-tealb">Where the job is</h2>
      {addr ? (
        <p className="mt-2 whitespace-pre-wrap text-[14.5px] leading-relaxed text-ink">
          {addr}
          {parish ? <span className="block text-[12.5px] text-dim">{parish}</span> : null}
        </p>
      ) : (
        <p className="mt-2 text-[13px] leading-relaxed text-mute">
          {role === "client"
            ? booked
              ? "Your tradesperson is booked and needs the street address to find the property. Add it here. Only they and Yaadly see it."
              : "No street address yet. Once somebody is booked, add it here. Only they and Yaadly see it; it never goes on the marketplace."
            : "The client has not added the street address yet. It is on their list to do. Do not set off until it is here."}
        </p>
      )}

      {canEdit && !editing && (
        <button
          type="button"
          onClick={() => { setEditing(true); setError(""); setValue(addr ?? ""); }}
          className="mt-3 rounded-full border border-teal bg-soft px-4 py-1.5 text-[12.5px] font-bold text-tealb"
        >
          {addr ? "Change the address" : "Add the address"}
        </button>
      )}
      {canEdit && editing && (
        <form
          className="mt-3 grid gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true); setError("");
            const r = await setJobAddress(jobId, value);
            setBusy(false);
            if (!r.ok) { setError(r.error); return; }
            setEditing(false);
            router.refresh();
          }}
        >
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            rows={3}
            maxLength={300}
            placeholder="House number, street and district, e.g. 14 Hope Road, Kingston 6"
            className="w-full rounded-xl border border-line bg-bg px-3.5 py-3 text-[13.5px] text-ink outline-none focus:border-teal"
          />
          <p className="text-[11.5px] text-dim">
            Seen by the booked tradesperson and Yaadly only. Directions and who holds the key can go in Messages.
          </p>
          {error && <p role="alert" className="text-[12.5px] text-coral">{error}</p>}
          <div className="flex gap-2">
            <button type="submit" disabled={busy || value.trim().length < 6}
              className="rounded-full bg-linear-to-r from-teal to-mango px-4 py-2 text-[13px] font-bold text-onbrand disabled:opacity-40">
              {busy ? "Saving…" : "Save the address"}
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
