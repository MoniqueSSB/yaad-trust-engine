import Link from "next/link";
import { STATUS_DOT, STATUS_RAIL, type StatusLabel, type StatusTone } from "./statusTone";
import { whenDate } from "@/lib/date";

/**
 * One job row, shared by the client portal and the worker portal.
 *
 * It lives here rather than inside a page because the two portals are two
 * different products that happen to render the same row. Keeping the row in
 * one file is what lets them diverge everywhere else without drifting on the
 * thing a client and a worker both have to read the same way: which job,
 * what stage, and who it is waiting on.
 */

export type Job = {
  id: string;
  title: string | null;
  trade: string | null;
  parish: string | null;
  stage: number | null;
  status: string;
  client_email: string | null;
  worker_email: string | null;
  updated_at: string | null;
  /** Who picks the tradesperson, 'yaadly' or 'client'. Optional: the worker
   *  list never selects it and never shows it. */
  worker_choice?: string | null;
  /** The street address, free text. Only ever set for the job's client or
   *  its booked worker; the page blanks it for anybody else before it gets
   *  here. Mostly empty today: the job form never asks for it. */
  addr?: string | null;
  /** True when the reader is a worker who has quoted but is not booked, so
   *  the address exists and is deliberately not theirs to see yet. */
  addr_hidden?: boolean;
};

/**
 * Where a job is, in one line: the street address and the parish when there
 * is an address, the parish and a plain note about the address when there is
 * not. Shared with the job room's summary card so the list and the room say
 * the same thing about the same property.
 */
export function WhereText({
  addr,
  parish,
  hidden = false,
}: {
  addr?: string | null;
  parish: string | null;
  hidden?: boolean;
}) {
  const a = (addr ?? "").trim();
  const p = (parish ?? "").trim();
  if (a) {
    // "12 Main St, Portmore, St Catherine" already names the parish; saying
    // it twice reads as two places.
    const withParish = p && !a.toLowerCase().includes(p.toLowerCase()) ? a + ", " + p : a;
    return <>{withParish}</>;
  }
  return (
    <>
      {p || "Parish not given"}
      <span className="text-dim">
        {" · "}
        {hidden ? "street address shown once you are booked" : "street address not added yet"}
      </span>
    </>
  );
}

/**
 * The wording of a status, and its tone.
 *
 * The tone vocabulary and its colours live in ./statusTone, shared with the
 * invoice rows so the desk, the job list and the money trail cannot describe
 * the same job three different ways. What stays here is the wording, because
 * that genuinely is per audience.
 */
/** Client-facing wording. A worker reads the same status differently, so the
 *  worker portal passes its own map rather than reusing this one. */
export const CLIENT_STATUS: Record<string, StatusLabel> = {
  awaiting_client_setup: { label: "Waiting on your portal setup", tone: "waiting" },
  draft: { label: "Draft, not live yet", tone: "idle" },
  open: { label: "Open for quotes", tone: "moving" },
  open_for_quotes: { label: "Open for quotes", tone: "moving" },
  quoted: { label: "Quotes in, waiting on you", tone: "waiting" },
  confirmed: { label: "Confirmed", tone: "moving" },
  in_progress: { label: "Work under way", tone: "moving" },
  evidence: { label: "Evidence waiting on you", tone: "waiting" },
  complete: { label: "Closed", tone: "done" },
};

export const WORKER_STATUS: Record<string, StatusLabel> = {
  awaiting_client_setup: { label: "Client still setting up", tone: "idle" },
  draft: { label: "Not live yet", tone: "idle" },
  open: { label: "Open, you can quote", tone: "waiting" },
  open_for_quotes: { label: "Open, you can quote", tone: "waiting" },
  quoted: { label: "You have quoted, waiting on the client", tone: "moving" },
  confirmed: { label: "Won, not started", tone: "moving" },
  in_progress: { label: "On site", tone: "moving" },
  evidence: { label: "Evidence with the client", tone: "moving" },
  complete: { label: "Paid and closed", tone: "done" },
};

export type { StatusLabel, StatusTone };

/** A status the maps above have never heard of still has to render. It gets
 *  the raw value and the neutral tone, rather than a colour that would be a
 *  guess about what it means. */
function statusOf(status: string, labels: Record<string, StatusLabel>): StatusLabel {
  return labels[status] ?? { label: status, tone: "idle" };
}

export function JobList({
  title,
  jobs,
  labels,
  empty,
  rail = false,
}: {
  title: string;
  jobs: Job[];
  labels: Record<string, StatusLabel>;
  empty?: string;
  /** A coloured left edge in the status tone, so the card reads before the
   *  pill does. Off by default: the client portal keeps its existing rows. */
  rail?: boolean;
}) {
  return (
    <section className="mt-8">
      <h2 className="mb-3 text-[10.5px] font-bold uppercase tracking-[.2em] text-tealb">
        {title}
      </h2>
      {jobs.length === 0 && empty ? (
        <div className="rounded-2xl border border-line bg-panel p-6">
          <p className="text-[13.5px] leading-relaxed text-mute">{empty}</p>
        </div>
      ) : (
        <ul className="grid gap-3">
          {jobs.map((j) => {
            const s = statusOf(j.status, labels);
            const updated = whenDate(j.updated_at);
            return (
              <li key={j.id}>
                <Link
                  href={"/portal/jobs/" + encodeURIComponent(j.id)}
                  className={
                    "block rounded-2xl border border-line bg-panel p-4 transition hover:border-line2" +
                    (rail ? " border-l-4 " + STATUS_RAIL[s.tone] : "")
                  }
                >
                  <b className="block text-[15.5px] leading-snug">
                    {j.title ?? "Untitled job"}
                  </b>
                  {/*
                    Where the job is and what stage it is at, as two labelled
                    lines rather than a small pill and a parish in the grey
                    footer. Founder's instruction, 13 Sep 2026: both have to be
                    readable at a glance, the stage in bold. The dot keeps the
                    status colour the pill used to carry.
                  */}
                  <dl className="mt-2.5 grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1.5 text-[13.5px]">
                    <dt className="text-dim">Stage</dt>
                    <dd className="flex items-center gap-2">
                      <span className={"size-2 shrink-0 rounded-full " + STATUS_DOT[s.tone]} aria-hidden />
                      <b className="font-extrabold text-ink">{s.label}</b>
                    </dd>
                    <dt className="text-dim">Where</dt>
                    <dd className="text-ink">
                      <WhereText addr={j.addr} parish={j.parish} hidden={j.addr_hidden} />
                    </dd>
                  </dl>
                  {/*
                    "Stage 0" used to sit in this row. It is the rail's internal
                    counter, it means nothing to the person reading it, and on a
                    job that has not started it says "0", which reads as a
                    failure rather than as a beginning. The pill above already
                    says where the job is, in words. The date it last moved is
                    the thing this row was missing: it was fetched to sort by
                    and then never shown.
                  */}
                  <div className="mt-3 flex flex-wrap gap-3.5 border-t border-line pt-3 text-[12.5px] text-dim">
                    <span className="font-mono-app">{j.id}</span>
                    {j.trade && <span>{j.trade}</span>}
                    {/* Only on the client's list, only while nobody is booked:
                        once a worker is on the job the question is answered. */}
                    {j.worker_choice != null && !j.worker_email && (
                      <span className="text-tealb">
                        {j.worker_choice === "client" ? "You choose from the quotes" : "Yaadly picks the tradesperson"}
                      </span>
                    )}
                    {updated && <span className="ml-auto">Last moved {updated}</span>}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
