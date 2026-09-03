import Link from "next/link";
import { STATUS_TONE, type StatusLabel, type StatusTone } from "./statusTone";

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
};

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

/** "3 Sep 2026". Short, unambiguous across UK, US and Jamaican readers, which
 *  a numeric date is not. */
function when(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function JobList({
  title,
  jobs,
  labels,
  empty,
}: {
  title: string;
  jobs: Job[];
  labels: Record<string, StatusLabel>;
  empty?: string;
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
            const updated = when(j.updated_at);
            return (
              <li key={j.id}>
                <Link
                  href={"/portal/jobs/" + encodeURIComponent(j.id)}
                  className="block rounded-2xl border border-line bg-panel p-4 transition hover:border-line2"
                >
                  <div className="flex flex-wrap items-start gap-3">
                    <b className="min-w-[200px] flex-1 text-[15.5px] leading-snug">
                      {j.title ?? "Untitled job"}
                    </b>
                    <span
                      className={`rounded-full border px-2.5 py-1 text-[11px] font-bold ${STATUS_TONE[s.tone]}`}
                    >
                      {s.label}
                    </span>
                  </div>
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
                    {j.parish && <span>{j.parish}</span>}
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
