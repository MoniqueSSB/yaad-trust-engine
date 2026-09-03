"use client";

import { useState } from "react";
import { nominateMaterialsStore } from "@/app/portal/materials-actions";

/**
 * The nominated materials store, PORTAL side of the 28 August 2026 rule.
 *
 * The client names where materials are to be kept. The worker buys them,
 * sends the receipt, and films them in that place. From the moment that
 * evidence is filed the materials are the client's, at the client's risk.
 * Without it the risk stays with the worker.
 *
 * Both sides see this card and they see the same facts, because a rule about
 * who carries a loss cannot be something one party read and the other did
 * not. Only the client gets the form: the worker choosing where to leave
 * goods he is then not responsible for would empty the rule out. Postgres
 * refuses him too, and this component is not what stops him.
 */

const OPTIONS: { value: string; label: string }[] = [
  { value: "lockable", label: "A lockable room, store or container on site" },
  { value: "indoors", label: "Indoors, inside the house" },
  { value: "none_available", label: "Nowhere securable, buy in drops" },
];

const SHORT: Record<string, string> = {
  lockable: "A lockable store on site",
  indoors: "Indoors, inside the house",
  none_available: "Nowhere securable on the property",
};

export function MaterialsStore({
  jobId,
  role,
  storeType,
  store,
  setBy,
  setAt,
}: {
  jobId: string;
  role: "client" | "worker";
  storeType: string | null;
  store: string | null;
  setBy: string | null;
  setAt: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState(storeType ?? "");
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [msg, setMsg] = useState("");
  const named = !!storeType;

  return (
    <section
      /* The go-live checklist links here by name, so the id is load-bearing
         rather than decoration. */
      id="materials"
      className={
        "mt-6 rounded-2xl border p-5 " +
        (named ? "border-line bg-panel" : "border-coral/40 bg-coral/[.06]")
      }
    >
      <h2 className="mb-2 text-[10.5px] font-bold uppercase tracking-[.2em] text-tealb">
        Where materials are kept
      </h2>

      {named ? (
        <>
          <p className="text-[14px] font-bold text-ink">{SHORT[storeType ?? ""] ?? storeType}</p>
          {store && (
            <p className="mt-1 text-[14px] leading-relaxed text-mute">{store}</p>
          )}
          <p className="mt-2 text-[12px] text-dim">
            {setBy ? "Named by " + setBy : "Named on this job"}
            {setAt ? " on " + setAt.slice(0, 10) : ""}
          </p>
          <p className="mt-3 max-w-[62ch] text-[13px] leading-relaxed text-mute">
            {storeType === "none_available"
              ? "There is nowhere securable here, so materials are bought in drops sized to the next stage and the surplus goes off site each night. Those extra trips are priced into the quote, not added afterwards. Nothing is left overnight, so nothing passes to the client, and materials on site stay the worker's risk."
              : role === "client"
                ? "The worker films the materials in this exact place and files it with the receipt. From the moment that evidence is filed the materials are yours and at your risk, because you chose the place and you own the property. If he keeps them somewhere else, or leaves them plainly insecure, the risk stays with him. His tools are his own risk either way. Check that your property insurance covers materials on site: cover on an empty house often does not."
                : "File the receipt, photographs and a video of the materials in this exact place, marked as materials on site. That is what moves the risk in them to the client. Keep them anywhere else, or leave them plainly insecure, and the risk stays with you. Your tools are your own risk in every case."}
          </p>
        </>
      ) : (
        <p className="max-w-[62ch] text-[13px] leading-relaxed text-mute">
          {role === "client"
            ? "Nobody has said where materials should be kept on the property yet. No materials money can be released until you do, so this is the thing holding the job up. Answer it and the worker can buy and start."
            : "The client has not yet said where materials are to be kept. No materials tranche can be released and no materials evidence can be filed until they have. Ask Yaadly to chase it rather than buying on your own account."}
        </p>
      )}

      {role === "client" && (
        <>
          {!open && (
            <button
              onClick={() => setOpen(true)}
              className={
                "mt-3 rounded-full px-4 py-2 text-[13px] font-bold transition " +
                (named
                  ? "border border-line2 text-ink hover:border-teal"
                  : "bg-linear-to-r from-teal to-mango text-onbrand hover:brightness-110")
              }
            >
              {named ? "Change where they are kept" : "Say where they are kept"}
            </button>
          )}

          {open && (
            <form
              action={async (fd) => {
                setState("busy");
                try {
                  await nominateMaterialsStore(fd);
                  setState("done");
                  setMsg("Recorded. The worker sees this, and it is what he films the materials in.");
                  setOpen(false);
                } catch (e) {
                  setState("error");
                  setMsg(e instanceof Error ? e.message : "That was refused.");
                }
              }}
              className="mt-4 grid gap-3"
            >
              <input type="hidden" name="jobId" value={jobId} />
              <select
                name="storeType"
                value={type}
                onChange={(e) => setType(e.target.value)}
                required
                className="rounded-xl border border-line bg-bg px-3.5 py-2.5 text-[13.5px] text-ink outline-none focus:border-teal"
              >
                <option value="">Choose one...</option>
                {OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>

              {type !== "none_available" && (
                <input
                  name="storeWhere"
                  defaultValue={store ?? ""}
                  maxLength={160}
                  required={type !== ""}
                  placeholder="Which room or store, in your words"
                  className="rounded-xl border border-line bg-bg px-3.5 py-2.5 text-[13.5px] text-ink outline-none focus:border-teal"
                />
              )}

              <p className="max-w-[62ch] text-[12.5px] leading-relaxed text-dim">
                {type === "none_available"
                  ? "The worker will buy in drops sized to the next stage and take the surplus away each night. That costs him trips, so it is priced into the quote up front."
                  : "Be specific enough that a stranger could find it and photograph it. This is the instruction the worker is held to."}
              </p>

              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  disabled={state === "busy"}
                  className="rounded-full bg-linear-to-r from-teal to-mango px-4.5 py-2.5 text-[13.5px] font-bold text-onbrand transition hover:brightness-110 disabled:opacity-40"
                >
                  {state === "busy" ? "Recording..." : "Record it"}
                </button>
                <button
                  type="button"
                  onClick={() => { setOpen(false); setState("idle"); }}
                  className="rounded-full border border-line2 px-4 py-2 text-[13px] text-mute transition hover:border-line"
                >
                  Not now
                </button>
              </div>
            </form>
          )}

          {state !== "idle" && state !== "busy" && (
            <p
              role="status"
              className={
                "mt-2.5 rounded-xl px-3.5 py-2.5 text-[13px] " +
                (state === "done"
                  ? "border border-softline bg-soft text-mute"
                  : "border border-coral/30 bg-coral/10 text-mute")
              }
            >
              {msg}
            </p>
          )}
        </>
      )}
    </section>
  );
}
