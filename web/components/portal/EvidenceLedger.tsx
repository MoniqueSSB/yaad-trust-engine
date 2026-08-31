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
 */

import { ApproveButton } from "./ApproveButton";

export type EvidenceItem = {
  id: string;
  label: string | null;
  img: string | null;
  ok: boolean | null;
  created_at: string | null;
  sha256: string | null;
  stage: number | null;
};

type StageState = "done" | "now" | "todo";

function stamp(iso: string | null) {
  return iso ? new Date(iso).toISOString().slice(0, 16).replace("T", " ") : "";
}

export function EvidenceLedger({
  items,
  stageCount,
  currentStage,
  role,
  awaitingApproval,
  jobId,
}: {
  items: EvidenceItem[];
  stageCount: number;
  /** jobs.stage: the stage being worked, 0 before anything starts */
  currentStage: number;
  role: "client" | "worker";
  awaitingApproval: boolean;
  /** Only used to build the Approve button and the link to the dispute form,
      neither of which render for a worker. Optional so nothing else calling
      this component needs to change. */
  jobId?: string;
}) {
  const stages = Array.from({ length: stageCount }, (_, k) => k + 1);
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
      ? "Photos are in and waiting on you. Money moves when you approve them."
      : "Photos are in. The client has been asked to approve them."
    : currentStage === 0
      ? "Nothing filed yet. Evidence starts when the first stage does."
      : filed === 0
        ? "Stage " + currentStage + " is under way. No photos filed against it yet."
        : "Stage " + currentStage + " is under way, with " + filed +
          " item" + (filed === 1 ? "" : "s") + " filed so far.";

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
          Each stage has its own checklist, its own proof and its own release.
          Money moves once per stage, never as one lump at the end.
        </p>
        <div className="mt-3.5 flex flex-wrap gap-x-5 gap-y-1 text-[12.5px] text-dim">
          <span>
            Stage <b className="text-mute">{Math.max(currentStage, 0)}</b> of{" "}
            <b className="text-mute">{stageCount}</b>
          </span>
          <span>
            <b className="text-mute">{filed}</b> item
            {filed === 1 ? "" : "s"} filed
          </span>
          <span>
            <b className="text-mute">{checked}</b> checked
          </span>
        </div>

        {/* The button the product is named after. Client only: a worker
            approving his own work is the thing this whole ledger exists to
            rule out. jobId is optional on the type only so nothing else
            calling EvidenceLedger has to change; the page that matters
            always passes it. */}
        {awaitingApproval && role === "client" && jobId && (
          <ApproveButton jobId={jobId} queryHref="?tab=job#dispute" />
        )}
      </div>

      <ul className="mt-3 grid gap-2.5">
        {stages.map((n) => {
          const mine = items.filter((e) => (e.stage ?? 1) === n);
          const state: StageState =
            n < currentStage ? "done" : n === currentStage ? "now" : "todo";
          return (
            <li
              key={n}
              className={
                "rounded-2xl border p-4 " +
                (state === "done"
                  ? "border-softline bg-soft"
                  : state === "now"
                    ? "border-mango/40 bg-mango/5"
                    : "border-line bg-panel")
              }
            >
              <div className="flex flex-wrap items-center gap-3">
                <b className="text-[14px]">Stage {n}</b>
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
                      : "Not started"}
                </span>
                <span className="ml-auto text-[11.5px] text-dim">
                  {mine.length === 0
                    ? "Nothing filed"
                    : mine.length + " item" + (mine.length === 1 ? "" : "s")}
                </span>
              </div>

              {mine.length > 0 && (
                <>
                  <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {mine.map((e) => (
                      <li
                        key={e.id}
                        className="overflow-hidden rounded-xl border border-line bg-panel"
                      >
                        {e.img && e.img.startsWith("data:audio/") ? (
                          /* A voice note, not a photograph: the client's own
                             words from the job wizard, played rather than
                             shown. */
                          <div className="grid h-36 w-full place-items-center bg-panel2 px-3">
                            <audio
                              controls
                              preload="metadata"
                              src={e.img}
                              className="w-full"
                            />
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
                              {e.label ?? "Evidence"}
                            </b>
                            {e.ok != null && (
                              <span
                                className={
                                  "flex-none rounded-full px-2 py-0.5 text-[9.5px] font-bold " +
                                  (e.ok
                                    ? "bg-tealb/15 text-tealb"
                                    : "bg-mango/15 text-mango")
                                }
                              >
                                {e.ok ? "Checked" : "Awaiting check"}
                              </span>
                            )}
                          </div>
                          {e.created_at && (
                            <p className="mt-0.5 text-[11px] text-dim">
                              {stamp(e.created_at)}
                            </p>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>

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
