/**
 * The evidence ledger, at the altitude a client actually reads it from.
 *
 * The previous version opened with "Evidence ledger · 3 items", printed every
 * stage as a card whether or not anything had happened on it, and put a full
 * sha256 under every photo in 9px mono. That is a forensic audit view, shown
 * to somebody whose question is "has he done it, and is my money safe".
 *
 * The founder's note was that this should be high level, "because that's what
 * we actually need". So the top line is now the answer to the question:
 * which stage, what is the proof, and who is holding it up. The fingerprints
 * are not deleted, because the whole product rests on them being checkable.
 * They move inside a details element, closed by default, one per stage. A
 * client who never opens it loses nothing; a client in a dispute has it all.
 *
 * The button that actually accepts a stage moved to its own Approvals tab
 * (3 Sep 2026), behind its own hold point, so this ledger only ever answers
 * "what is the proof", never "shall I sign this off" in the same breath.
 */

import type { ReactNode } from "react";
import Link from "next/link";
import { EvidenceItemComment } from "./EvidenceItemComment";
import { whenDateTime } from "@/lib/date";
import { phaseBadge, sectionsOf, stageLock } from "@/lib/portal/evidence-sections";

export type EvidenceItem = {
  id: string;
  label: string | null;
  img: string | null;
  ok: boolean | null;
  created_at: string | null;
  sha256: string | null;
  stage: number | null;
  /** Which section of the job this belongs to, as declared by whoever filed
      it, or null if nobody said. Never inferred from the label: see
      20260906000700. */
  phase?: string | null;
  /** 'materials' is its own section and carries no phase. See 20260828c. */
  kind?: string | null;
  /** The before this after answers, by id. See 20260906020400. */
  pairs_with?: string | null;
  /** P1, P2, P3: the short per-job code. */
  item_code?: string | null;
};

type StageState = "done" | "now" | "todo";

function stamp(iso: string | null) {
  return whenDateTime(iso) ?? "";
}

export function EvidenceLedger({
  items,
  stageCount,
  stageNames = [],
  stageProofs = [],
  currentStage,
  role,
  awaitingApproval,
  jobId,
  upload = null,
  startsWhen = null,
}: {
  /** The upload forms, drawn inside the one stage card that is open. Null
      when nothing may be filed (before stage 1, or once the job is done). */
  upload?: ReactNode;
  /** What stage 1 is waiting on, shown on it while every stage is locked. */
  startsWhen?: string | null;
  items: EvidenceItem[];
  stageCount: number;
  /** The stage names from the accepted quote's schedule, in order, so each
      section reads "Stage 2 · Posts and rails fitted" and not a bare number.
      Empty on a job with no schedule, which keeps the numbered sections. */
  stageNames?: string[];
  /** What proves each stage, from the same schedule. */
  stageProofs?: (string | null)[];
  /** jobs.stage: the stage being worked, 0 before anything starts */
  currentStage: number;
  role: "client" | "worker";
  awaitingApproval: boolean;
  /** Only used to build the link to the Approvals tab and to gate the
      per-photo comment box, neither of which render for a worker. Optional
      so nothing else calling this component needs to change. */
  jobId?: string;
}) {
  const stages = Array.from({ length: stageCount }, (_, k) => k + 1);
  /* Every item on the job, by id, so an after can show the before it answers
     even when that before was filed on an earlier stage. */
  const byId = new Map(items.map((e) => [e.id, e]));
  /* The befores that have an after against them, so a before can say it has
     been answered instead of looking like it is still waiting. */
  const answered = new Map(
    items.filter((e) => e.pairs_with).map((e) => [e.pairs_with as string, e]),
  );
  const filed = items.length;
  const checked = items.filter((e) => e.ok === true).length;

  /* One sentence, before any list, answering the question the page is open
     for. Everything below it is the supporting detail. */
  /* awaitingApproval is checked FIRST, before the currentStage === 0 branch.
     Found by testing the approve button rather than by reading this: a job
     at stage 0 with evidence already filed for stage 1 (the ordinary shape
     the moment a worker files a first photo) said "Nothing filed yet" in
     the same breath the ledger below it listed two items and put an Approve
     button on screen. Whether anything is waiting on a human is a more
     urgent fact than which stage number the job happens to be on. */
  const headline = awaitingApproval
    ? role === "client"
      ? "Photos are in and waiting on you. This stage closes when you approve them."
      : "Photos are in. The client has been asked to approve them."
    : currentStage === 0
      ? "Nothing filed yet. Evidence starts when the first stage does."
      : filed === 0
        ? stageTitle(currentStage) + " is under way. No photos filed against it yet."
        : stageTitle(currentStage) + " is under way, with " + filed +
          " item" + (filed === 1 ? "" : "s") + " filed so far.";

  function stageTitle(n: number): string {
    const name = stageNames[n - 1];
    return name ? "Stage " + n + ", " + name + "," : "Stage " + n;
  }

  return (
    <section className="mt-6">
      <div
        className={
          "rounded-2xl border p-5 " +
          (awaitingApproval
            ? "border-mango/40 bg-mango/[.07]"
            : "border-line bg-panel")
        }
      >
        <h2 className="text-[10.5px] font-bold uppercase tracking-[.2em] text-tealb">
          Evidence
        </h2>
        <p className="mt-2 max-w-[62ch] text-[15px] font-bold leading-snug text-ink">
          {headline}
        </p>
        <p className="mt-2 max-w-[62ch] text-[13px] leading-relaxed text-mute">
          {stageNames.length > 0
            ? "The work is split into the " + stageNames.length + " stages of the accepted quote, below. Evidence goes on the stage being worked: open it to add photos. The stages after it stay locked until it is signed off on the Approvals tab, and the worker is paid for each stage once it is approved."
            : "Each stage has its own proof and its own release. Evidence goes on the stage being worked, and the stages after it stay locked until it is signed off. Money moves once per stage, never as one lump at the end."}
        </p>
        <div className="mt-3.5 flex flex-wrap gap-x-5 gap-y-1 text-[12.5px] text-dim">
          {/* "Stage 0 of 1" read as broken (founder, 14 Sep 2026). Before
              work starts it says how many stages there are and where they
              came from; after, which one is being worked. */}
          <span>
            {currentStage > 0 ? (
              <>
                Stage <b className="text-mute">{currentStage}</b> of{" "}
                <b className="text-mute">{stageCount}</b>
              </>
            ) : (
              <>
                Not started · <b className="text-mute">{stageCount}</b> stage{stageCount === 1 ? "" : "s"}
                {stageNames.length > 0 ? " from the quote" : ""}
              </>
            )}
          </span>
          <span>
            <b className="text-mute">{filed}</b> item
            {filed === 1 ? "" : "s"} filed
          </span>
          <span>
            <b className="text-mute">{checked}</b> checked
          </span>
        </div>

        {/* The button the product is named after lives on the Approvals tab
            now, next to the money it releases. Client only: a worker
            approving his own work is the thing this whole ledger exists to
            rule out. */}
        {awaitingApproval && role === "client" && jobId && (
          <Link
            href="?tab=approvals"
            className="mt-3.5 inline-flex rounded-full bg-linear-to-r from-teal to-mango px-5 py-2.5 text-[13.5px] font-bold text-onbrand transition hover:brightness-110"
          >
            Go to Approvals to sign off &rarr;
          </Link>
        )}
      </div>

      <ul className="mt-3 grid gap-2.5">
        {stages.map((n) => {
          const mine = items.filter((e) => (e.stage ?? 1) === n);
          /* Founder, 14 Sep 2026: only the stage being worked is open, and
             the rest are blacked out until each stage before them is signed
             off. stageLock reads jobs.stage, which only approve_stage()
             moves, so this decides nothing a person has not already decided. */
          const lock = stageLock(n, currentStage);
          const state: StageState = lock === "locked" ? "todo" : lock;
          return (
            <li
              key={n}
              aria-disabled={state === "todo" || undefined}
              className={
                "min-w-0 rounded-2xl border p-4 " +
                (state === "done"
                  ? "border-softline bg-soft"
                  : state === "now"
                    ? "border-mango/40 bg-mango/5"
                    : "border-line bg-panel2 opacity-45 grayscale")
              }
            >
              <div className="flex flex-wrap items-center gap-3">
                <b className="text-[14px]">
                  Stage {n}
                  {stageNames[n - 1] ? " · " + stageNames[n - 1] : ""}
                </b>
                <span
                  className={
                    "rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide " +
                    (state === "done"
                      ? "bg-tealb/15 text-tealb"
                      : state === "now"
                        ? "bg-mango/15 text-mango"
                        : "bg-panel2 text-dim")
                  }
                >
                  {state === "done"
                    ? "Signed off, released"
                    : state === "now"
                      ? "In progress"
                      : "Locked"}
                </span>
                <span className="ml-auto text-[11.5px] text-dim">
                  {mine.length === 0
                    ? "Nothing filed"
                    : mine.length + " item" + (mine.length === 1 ? "" : "s")}
                </span>
              </div>
              {/* What proves this stage, in the accepted quote's own words,
                  so the photos filed below can be read against it. */}
              {stageProofs[n - 1] && (
                <p className="mt-1.5 text-[12.5px] leading-relaxed text-dim">
                  What proves it: <span className="text-mute">{stageProofs[n - 1]}</span>
                </p>
              )}
              {/* Why a locked stage is locked, in one line, so a greyed card
                  never reads as broken. */}
              {state === "todo" && (
                <p className="mt-1.5 text-[12.5px] font-bold leading-relaxed text-dim">
                  {n === 1
                    ? (startsWhen ?? "Opens when stage 1 starts.")
                    : "Opens when stage " + (n - 1) + " is signed off."}
                </p>
              )}
              {state === "done" && (
                <p className="mt-1.5 text-[12px] leading-relaxed text-dim">
                  Signed off. Closed to new evidence.
                </p>
              )}
              {/* The stage you click to file on. A native details element, so
                  it opens without any script; open by default for the worker,
                  whose job this is, and one tap away for the client. id
                  "upload" is what the worker's "File stage N evidence" action
                  links to. */}
              {state === "now" && upload && (
                <details id="upload" open={role === "worker"} className="group mt-3 scroll-mt-6">
                  <summary className="inline-flex cursor-pointer list-none rounded-full bg-linear-to-r from-teal to-mango px-4.5 py-2.5 text-[13.5px] font-bold text-onbrand transition hover:brightness-110">
                    <span className="group-open:hidden">Add evidence to stage {n}</span>
                    <span className="hidden group-open:inline">Close</span>
                  </summary>
                  {upload}
                </details>
              )}

              {mine.length > 0 && (
                <>
                  {/* Read in the order of the work rather than the order the
                      files arrived. A client scanning a stage wants the before
                      next to the before, and wants a problem found on site to
                      be somewhere they will actually see it rather than
                      seventh in a grid. Empty sections are not drawn: a stage
                      with no problems should look like a stage with no
                      problems, not like a stage with an empty box on it. */}
                  {sectionsOf(mine).map((sec) => (
                    <section key={sec.key} className="mt-3.5">
                      <div className="flex items-baseline gap-2">
                        <h4 className="text-[10.5px] font-bold uppercase tracking-[.2em] text-tealb">
                          {sec.heading}
                        </h4>
                        <span className="text-[11px] text-dim">
                          {sec.items.length}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[11.5px] leading-relaxed text-dim">
                        {sec.note}
                      </p>
                      <ul className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {sec.items.map((e) => (
                          <EvidenceCard
                            key={e.id}
                            e={e}
                            answers={e.pairs_with ? byId.get(e.pairs_with) : undefined}
                            answeredBy={answered.get(e.id)}
                            role={role}
                            jobId={jobId}
                          />
                        ))}
                      </ul>
                    </section>
                  ))}

                  {/* The audit trail, one click away rather than in the way.
                      Closed by default; a native details element so it works
                      without hydrating anything. */}
                  <details className="mt-3 group">
                    <summary className="cursor-pointer list-none text-[12px] font-bold text-tealb underline-offset-2 hover:underline">
                      Show the record for this stage
                    </summary>
                    <p className="mt-2 text-[11.5px] leading-relaxed text-dim">
                      Each line is the fingerprint taken when the file was
                      filed. If a photo were ever swapped, its fingerprint
                      would stop matching, which is what makes this a record
                      rather than an album.
                    </p>
                    <ul className="mt-2 grid gap-1.5">
                      {mine.map((e) => (
                        <li key={e.id} className="text-[11px] text-dim">
                          <b className="text-mute">{e.label ?? "Evidence"}</b>
                          {phaseBadge(e.phase, e.kind)
                            ? " · " + phaseBadge(e.phase, e.kind)
                            : ""}
                          {e.created_at ? " · " + stamp(e.created_at) : ""}
                          {e.sha256 ? (
                            <span className="mt-0.5 block break-all font-mono text-[9.5px] leading-relaxed">
                              sha256 · {e.sha256}
                            </span>
                          ) : (
                            <span className="mt-0.5 block text-[10.5px] italic">
                              filed before fingerprinting, no hash on record
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </details>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * One evidence item. Lifted out of the stage loop when the flat grid became
 * five grouped ones, purely so the grouping is readable; the markup inside is
 * unchanged from when it sat inline.
 */
function EvidenceCard({
  e,
  answers,
  answeredBy,
  role,
  jobId,
}: {
  e: EvidenceItem;
  /** The before this after answers, if it names one. */
  answers?: EvidenceItem;
  /** The after that answers this before, if one has been filed. */
  answeredBy?: EvidenceItem;
  role: "client" | "worker";
  jobId?: string;
}) {
  const badge = phaseBadge(e.phase, e.kind);
  return (
    <li className="overflow-hidden rounded-xl border border-line bg-panel">
      {e.img && e.img.startsWith("data:audio/") ? (
        /* A voice note, not a photograph: the client's own words from the job
           wizard, played rather than shown. */
        <div className="grid h-36 w-full place-items-center bg-panel2 px-3">
          <audio controls preload="metadata" src={e.img} className="w-full" />
        </div>
      ) : e.img ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={e.img}
          alt={e.label ?? "Evidence photo"}
          className="h-36 w-full object-cover"
        />
      ) : (
        <div className="grid h-16 w-full place-items-center bg-panel2 text-[11.5px] text-dim">
          Filed without an image
        </div>
      )}
      <div className="p-3">
        <div className="flex items-start justify-between gap-2">
          <b className="text-[13px] leading-snug">
            {/* Kept on the card as well as over the section, because a card
                seen on its own, linked to or scrolled past its heading, should
                still say what it is. A problem found on site is coloured apart
                from the rest: it is the one a client must not skim over. */}
            {badge && (
              <span
                className={
                  "mr-1.5 rounded-full px-1.5 py-0.5 align-middle text-[9.5px] font-bold uppercase tracking-wide " +
                  (e.phase === "new"
                    ? "bg-coral/15 text-coral"
                    : e.phase === "issue"
                      ? "bg-mango/15 text-mango"
                      : "bg-tealb/15 text-tealb")
                }
              >
                {badge}
              </span>
            )}
            {e.label ?? "Evidence"}
          </b>
          {e.ok != null && (
            <span
              className={
                "flex-none rounded-full px-2 py-0.5 text-[9.5px] font-bold " +
                (e.ok ? "bg-tealb/15 text-tealb" : "bg-mango/15 text-mango")
              }
            >
              {e.ok ? "Checked" : "Awaiting check"}
            </span>
          )}
        </div>
        {/* The comparison, shown rather than described. An after carries a
            thumbnail of the before it answers, so a client sees the two
            together without leaving the section; a before that has been
            answered says so instead of looking like it is still waiting. The
            before is not drawn as a second full card anywhere: it appears once
            in its own section, and here at thumbnail size. */}
        {answers && (
          <div className="mt-1.5 flex items-center gap-2 rounded-lg border border-softline bg-soft p-1.5">
            {answers.img ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={answers.img} alt={answers.label ?? "The before"} className="h-9 w-12 flex-none rounded object-cover" />
            ) : (
              <span className="grid h-9 w-12 flex-none place-items-center rounded bg-panel2 text-[9px] text-dim">no image</span>
            )}
            <span className="text-[11px] leading-snug text-mute">
              Answers {answers.item_code ?? "the before"}
              {answers.label ? ", " + answers.label : ""}
            </span>
          </div>
        )}
        {!answers && answeredBy && (
          <p className="mt-1 text-[11px] text-tealb">
            Answered by {answeredBy.item_code ?? "an after"}
          </p>
        )}
        {e.created_at && (
          <p className="mt-0.5 text-[11px] text-dim">{stamp(e.created_at)}</p>
        )}
        {/* Client only, the same rule the Approve button already follows: a
            worker commenting on their own photo is not what this exists for,
            and the RLS insert policy would refuse it anyway if a stray call
            ever got this far. */}
        {role === "client" && jobId && (
          <EvidenceItemComment jobId={jobId} evidenceId={e.id} />
        )}
      </div>
    </li>
  );
}
