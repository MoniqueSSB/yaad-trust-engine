import Link from "next/link";

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

/** Client-facing wording. A worker reads the same status differently, so the
 *  worker portal passes its own map rather than reusing this one. */
export const CLIENT_STATUS: Record<string, string> = {
  awaiting_client_setup: "Waiting on your portal setup",
  draft: "Draft, not live yet",
  open: "Open for quotes",
  open_for_quotes: "Open for quotes",
  quoted: "Quotes in, waiting on you",
  confirmed: "Confirmed",
  in_progress: "Work under way",
  evidence: "Evidence waiting on you",
  complete: "Closed",
};

export const WORKER_STATUS: Record<string, string> = {
  awaiting_client_setup: "Client still setting up",
  draft: "Not live yet",
  open: "Open, you can quote",
  open_for_quotes: "Open, you can quote",
  quoted: "You have quoted, waiting on the client",
  confirmed: "Won, not started",
  in_progress: "On site",
  evidence: "Evidence with the client",
  complete: "Paid and closed",
};

export function JobList({
  title,
  jobs,
  labels,
  empty,
}: {
  title: string;
  jobs: Job[];
  labels: Record<string, string>;
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
          {jobs.map((j) => (
            <li key={j.id}>
              <Link
                href={"/portal/jobs/" + encodeURIComponent(j.id)}
                className="block rounded-2xl border border-line bg-panel p-4 transition hover:border-line2"
              >
                <div className="flex flex-wrap items-start gap-3">
                  <b className="min-w-[200px] flex-1 text-[15.5px] leading-snug">
                    {j.title ?? "Untitled job"}
                  </b>
                  <span className="rounded-full border border-softline bg-soft px-2.5 py-1 text-[11px] font-bold text-tealb">
                    {labels[j.status] ?? j.status}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-3.5 border-t border-line pt-3 text-[12.5px] text-dim">
                  <span>{j.id}</span>
                  {j.trade && <span>{j.trade}</span>}
                  {j.parish && <span>{j.parish}</span>}
                  {j.stage != null && <span>Stage {j.stage}</span>}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
