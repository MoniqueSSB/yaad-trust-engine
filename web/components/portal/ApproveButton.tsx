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
 *
 * The in-person checkbox does not skip anything: the evidence still has to
 * be filed, a dispute still blocks it. It only changes what gets written
 * into stage_approvals.confirmed_method, for a client who is physically at
 * the property and inspected the work themselves rather than reviewing it
 * remotely. A stronger record for later, not a shorter path now.
 */
export function ApproveButton({ jobId, queryHref }: { jobId: string; queryHref: string }) {
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");
  const [msg, setMsg] = useState("");
  /* Announced, not shown. See the live region at the bottom of this file. */
  const [announce, setAnnounce] = useState("");
  const [inPerson, setInPerson] = useState(false);

  return (
    <div className="relative mt-3.5 flex flex-wrap items-center gap-3">
      <form
        action={async (fd) => {
          setState("busy");
          setMsg("");
          try {
            await approveStage(fd);
            // No local "done" state, and no visible success banner:
            // approveStage revalidates the page, and the ledger re-rendering
            // with the stage advanced IS the confirmation. A second visible
            // message would be another, possibly stale, thing claiming the
            // same fact.
            //
            // That reasoning holds for somebody who can SEE the ledger move.
            // A screen reader user got nothing at all: the button label went
            // from "Approving…" back to "Approve this stage", which is
            // indistinguishable from the tap having done nothing, on the one
            // control in this product that moves money. So the confirmation is
            // announced rather than shown. It is the non-visual counterpart to
            // the ledger advancing, not a competing claim, and it cannot go
            // stale because it is written once, at the moment the action
            // returned.
            setState("idle");
            setAnnounce("Stage approved. The ledger below has moved on.");
          } catch (e) {
            setState("error");
            setMsg(e instanceof Error ? e.message : "That did not go through.");
          }
        }}
        className="flex flex-wrap items-center gap-3"
      >
        <input type="hidden" name="jobId" value={jobId} />
        <input type="hidden" name="method" value={inPerson ? "in_person" : "evidence"} />
        <button
          disabled={state === "busy"}
          className="rounded-full bg-linear-to-r from-teal to-mango px-5 py-2.5 text-[13.5px] font-bold text-onbrand transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {state === "busy" ? "Approving…" : inPerson ? "Confirm, I inspected this myself" : "Approve this stage"}
        </button>
      </form>
      <label className="flex items-center gap-1.5 text-[12px] text-dim">
        <input
          type="checkbox"
          checked={inPerson}
          onChange={(e) => setInPerson(e.target.checked)}
          className="size-3.5 accent-teal"
        />
        I&rsquo;m at the property and looked at this myself
      </label>
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

      {/* Off screen rather than hidden: display:none and visibility:hidden are
          both skipped by screen readers, so a live region has to stay in the
          accessibility tree to be read. */}
      <p
        role="status"
        aria-live="polite"
        className="absolute -m-px size-px overflow-hidden whitespace-nowrap border-0 p-0 [clip:rect(0,0,0,0)]"
      >
        {announce}
      </p>
    </div>
  );
}
