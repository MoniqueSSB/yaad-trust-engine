"use client";

import { useState } from "react";
import { linkWorkerPhone } from "@/app/portal/worker-phone-actions";

/**
 * The worker side of WhatsApp evidence intake: a worker sending photos and
 * video from a job site over WhatsApp only reaches the right job if Yaadly
 * knows which number is theirs. New workers get this set automatically at
 * WhatsApp signup; this is for everyone who joined before that existed, or
 * whose number changed.
 */
export function LinkWorkerPhone({ phone }: { phone: string | null }) {
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");
  const [msg, setMsg] = useState("");
  const [editing, setEditing] = useState(!phone);

  return (
    <section className="mt-4 rounded-2xl border border-line bg-panel p-4">
      <p className="text-[10.5px] font-bold uppercase tracking-[.2em] text-tealb">Send evidence from WhatsApp</p>
      <p className="mt-1 text-[12px] leading-relaxed text-dim">
        Photos and video sent from this number go straight onto the job as
        evidence, no need to open the portal on site.
      </p>
      {!editing && phone ? (
        <p className="mt-2.5 text-[13px] text-mute">
          Linked to <b className="text-ink">{phone}</b>.{" "}
          <button type="button" onClick={() => setEditing(true)} className="text-tealb underline-offset-2 hover:underline">
            Change
          </button>
        </p>
      ) : (
        <form
          action={async (fd) => {
            setState("busy");
            setMsg("");
            try {
              await linkWorkerPhone(fd);
              setState("idle");
              setEditing(false);
            } catch (e) {
              setState("error");
              setMsg(e instanceof Error ? e.message : "That did not go through.");
            }
          }}
          className="mt-2.5 flex flex-wrap items-center gap-2"
        >
          <input
            name="phone"
            required
            placeholder="Your WhatsApp number"
            defaultValue={phone ?? ""}
            className="rounded-xl border border-line bg-bg px-3.5 py-2.5 text-[13px] text-ink outline-none focus:border-teal"
          />
          <button
            disabled={state === "busy"}
            className="rounded-full bg-linear-to-r from-teal to-mango px-4 py-2.5 text-[12.5px] font-bold text-[#04211D] disabled:opacity-40"
          >
            {state === "busy" ? "Saving…" : "Link this number"}
          </button>
        </form>
      )}
      {state === "error" && (
        <p role="alert" className="mt-2 text-[12.5px] leading-relaxed text-coral">{msg}</p>
      )}
    </section>
  );
}
