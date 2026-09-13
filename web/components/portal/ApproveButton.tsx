"use client";

import { useState } from "react";
import { approveStage } from "@/app/portal/approve-actions";

/**
 * One tap, and the money moves. This is the button the product is named
 * after (31 Aug 2026, Stage 5): the evidence ledger has said "money moves
 * when you approve them" since 30 Aug, and until approve_stage() existed in
 * Postgres that sentence had nothing behind it.
 *
 * Until 3 Sep 2026 that one tap was the whole interaction: the same pill as
 * every other button in the room, no pause and no sentence saying what it
 * was about to release. This adds a hold point in front of it, not a second
 * gate in Postgres: a warning-coloured box states the stage, who is paid,
 * and how much, and only its own, differently styled button actually submits
 * the form. approve_stage() itself is untouched.
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
export function ApproveButton({
  jobId,
  queryHref,
  stageLabel,
  amount,
  workerName,
}: {
  jobId: string;
  queryHref: string;
  /** e.g. "Stage 2", said back in the warning box so the tap is unambiguous */
  stageLabel?: string;
  /** the money this stage releases, already formatted, if known */
  amount?: string | null;
  workerName?: string | null;
}) {
  const [state, setState] = useState<"idle" | "confirming" | "busy" | "error">("idle");
  const [msg, setMsg] = useState("");
  /* Announced, not shown. See the live region at the bottom of this file. It
     stays mounted across every state, idle included: the announcement is
     written the instant approveStage returns and state falls straight back
     to idle, so a live region that only rendered in the "confirming" branch
     would unmount itself in the same tick as the text arrived, and a screen
     reader would never get to read it. */
  const [announce, setAnnounce] = useState("");
  const [inPerson, setInPerson] = useState(false);

  const who = workerName ?? "the worker";
  const explain =
    "Approving " +
    (stageLabel ?? "this stage") +
    " releases " +
    (amount ?? "its payment") +
    " to " +
    who +
    ". Once you approve, it cannot be taken back from here; only a dispute, raised before you approve, can stop it.";

  return (
    <div className="relative mt-3.5">
      {state === "idle" || state === "error" ? (
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setState("confirming")}
              className="rounded-full bg-linear-to-r from-teal to-mango px-5 py-2.5 text-[13.5px] font-bold text-onbrand transition hover:brightness-110"
            >
              Review and approve this stage
            </button>
            <a
              href={queryHref}
              className="text-[12.5px] font-bold text-dim underline-offset-2 hover:text-coral hover:underline"
            >
              Something wrong instead?
            </a>
          </div>
          {state === "error" && (
            <p role="alert" className="mt-2 max-w-[52ch] text-[12.5px] leading-relaxed text-coral">
              {msg}
            </p>
          )}
        </div>
      ) : (
        <div className="max-w-[56ch] rounded-xl border border-coral/40 bg-coral/[.07] p-4">
          <p className="text-[12px] font-bold uppercase tracking-[.14em] text-coral">
            This commits Yaadly to pay for this stage and cannot be undone
          </p>
          <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink">{explain}</p>

          <label className="mt-3 flex items-center gap-1.5 text-[12px] text-dim">
            <input
              type="checkbox"
              checked={inPerson}
              onChange={(e) => setInPerson(e.target.checked)}
              className="size-3.5 accent-teal"
            />
            I&rsquo;m at the property and looked at this myself
          </label>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <form
              action={async (fd) => {
                setState("busy");
                setMsg("");
                try {
                  await approveStage(fd);
                  // No local "done" state, and no visible success banner:
                  // approveStage revalidates the page, and the ledger
                  // re-rendering with the stage advanced IS the
                  // confirmation. A second visible message would be
                  // another, possibly stale, thing claiming the same fact.
                  //
                  // That reasoning holds for somebody who can SEE the
                  // ledger move. A screen reader user gets nothing from
                  // that, so the confirmation is also announced, in the
                  // live region below, the non-visual counterpart to the
                  // ledger advancing rather than a competing claim.
                  setState("idle");
                  setAnnounce("Stage approved. The ledger below has moved on.");
                } catch (e) {
                  setState("error");
                  setMsg(e instanceof Error ? e.message : "That did not go through.");
                }
              }}
            >
              <input type="hidden" name="jobId" value={jobId} />
              <input type="hidden" name="method" value={inPerson ? "in_person" : "evidence"} />
              <button
                disabled={state === "busy"}
                className="rounded-full border border-coral bg-coral/15 px-5 py-2.5 text-[13.5px] font-bold text-coral transition hover:bg-coral/25 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {state === "busy"
                  ? "Approving…"
                  : inPerson
                    ? "Yes, I inspected this myself: accept this stage"
                    : "Yes, accept this stage"}
              </button>
            </form>
            <button
              type="button"
              disabled={state === "busy"}
              onClick={() => setState("idle")}
              className="rounded-full border border-line2 px-3.5 py-2 text-[12.5px] text-mute transition hover:border-line disabled:opacity-40"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Off screen rather than hidden: display:none and visibility:hidden are
          both skipped by screen readers, so a live region has to stay in the
          accessibility tree to be read, in every state above, not only one. */}
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
