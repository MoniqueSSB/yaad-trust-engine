"use client";

import { useState } from "react";
import { approveStage } from "@/app/portal/approve-actions";

/**
 * One tap, and the money moves. This is the button the product is named
 * after (31 Aug 2026, Stage 5): the evidence ledger has said "money moves
 * when you approve them" since 30 Aug, and until approve_stage() existed in
 * Postgres that sentence had nothing behind it.
 *
 * A client-side wrapper around a server action, same shape as
 * EvidenceUpload: the action can genuinely fail (a dispute opened between
 * page load and the tap, nothing filed yet) and the database's own sentence
 * explaining why is worth more than a crash. queryHref is a real URL to the
 * dispute form, not a modal: tabs are URLs on this page, and "something is
 * wrong with this, not approved" deserves its own address as much as
 * approval does.
 */
export function ApproveButton({ jobId, queryHref }: { jobId: string; queryHref: string }) {
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");
  const [msg, setMsg] = useState("");

  return (
    <div className="mt-3.5 flex flex-wrap items-center gap-3">
      <form
        action={async (fd) => {
          setState("busy");
          setMsg("");
          try {
            await approveStage(fd);
            // No local "done" state: approveStage revalidates the page, and
            // the ledger re-rendering with the stage advanced IS the
            // confirmation. A separate success message would be a second,
            // possibly stale, thing claiming the same fact.
          } catch (e) {
            setState("error");
            setMsg(e instanceof Error ? e.message : "That did not go through.");
          }
        }}
      >
        <input type="hidden" name="jobId" value={jobId} />
        <button
          disabled={state === "busy"}
          className="rounded-full bg-linear-to-r from-teal to-mango px-5 py-2.5 text-[13.5px] font-bold text-[#04211D] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {state === "busy" ? "Approving…" : "Approve this stage"}
        </button>
      </form>
      <a
        href={queryHref}
        className="text-[12.5px] font-bold text-dim underline-offset-2 hover:text-coral hover:underline"
      >
        Something wrong instead?
      </a>
      {state === "error" && (
        <p role="alert" className="w-full text-[12.5px] leading-relaxed text-coral">
          {msg}
        </p>
      )}
    </div>
  );
}
