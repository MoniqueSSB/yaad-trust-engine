import { QuotePanel } from "@/components/QuotePanel";
import { declineJobRequest } from "@/app/jobs/actions";

/**
 * "A client asked for you by name."
 *
 * When somebody taps "Book <name> for a job" on a worker profile, the job is
 * held off the open board for 48 hours and only that worker can price it
 * (20260905a in supabase/migrations). Held means invisible: it is not in
 * open_jobs, so without this panel the one person allowed to quote it would
 * be the one person who could not find it.
 *
 * Sits at the top of the board, above everything, because a two day clock is
 * running and the whole value of the request to the client is speed.
 *
 * TWO ANSWERS, both typed by the worker. Price it, which is their yes and
 * ends the hold. Or pass on it, which opens the job to the board straight
 * away so the client is not left waiting on somebody who is busy. There is
 * deliberately no third button that means "yes but not yet": a maybe changes
 * nothing for the client and is one more thing to explain.
 *
 * Nothing here books anybody. The client still chooses a quote, by the same
 * route as every other job.
 */

export type RequestedJob = {
  id: string; title: string | null; parish: string | null; trade: string | null;
  descr: string | null; urgency: string | null; holds_until: string | null;
};

function hoursLeft(iso: string | null): string {
  if (!iso) return "";
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "the window has just run out";
  const h = Math.round(ms / 3600000);
  if (h >= 2) return `about ${h} hours left`;
  const m = Math.max(1, Math.round(ms / 60000));
  return `about ${m} minute${m === 1 ? "" : "s"} left`;
}

export function RequestedJobs({ jobs }: { jobs: RequestedJob[] }) {
  if (jobs.length === 0) return null;

  return (
    <section className="mb-8">
      <h2 className="font-display text-[clamp(20px,2.4vw,26px)] font-light tracking-[-0.01em]">
        A client asked for{" "}
        <em className="bg-linear-to-r from-purpleb to-gold bg-clip-text text-transparent">you, by name</em>
      </h2>
      <p className="mt-1.5 max-w-[70ch] text-[13.5px] leading-relaxed text-mute">
        They read your profile and picked you. Nobody else can price{" "}
        {jobs.length === 1 ? "this job" : "these jobs"} while the window is
        open. Put a price in, or say you cannot take it on and we will find
        them somebody else the same day.
      </p>

      <div className="mt-4 grid gap-4">
        {jobs.map((j) => (
          <div key={j.id} className="rounded-[18px] border-[1.5px] border-gold/40 bg-gold/[0.05] p-6">
            <div className="flex flex-wrap items-start gap-3.5">
              <h3 className="min-w-[240px] flex-1 font-display text-[20px] font-normal leading-[1.25] tracking-[-0.01em]">
                {j.title ?? "Job"}
              </h3>
              <span className="flex flex-wrap gap-1.5">
                <span className="rounded-full border border-gold/35 bg-gold/10 px-2.5 py-1 text-[11px] font-semibold text-goldb">
                  Yours first · {hoursLeft(j.holds_until)}
                </span>
                {j.trade && (
                  <span className="rounded-full border border-purple/30 bg-purple/10 px-2.5 py-1 text-[11px] font-semibold text-purpleb">{j.trade}</span>
                )}
              </span>
            </div>

            {j.descr && (
              <p className="mt-3 max-w-[78ch] whitespace-pre-wrap text-[13.5px] leading-relaxed text-mute">
                {j.descr.slice(0, 260)}{j.descr.length > 260 ? "..." : ""}
              </p>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-x-4.5 gap-y-1.5 border-t border-gold/20 pt-3.5 text-[12.5px] text-dim">
              {j.parish && <b className="font-semibold text-ink">{j.parish}</b>}
              {j.urgency && <span>{j.urgency}</span>}
              <span className="font-mono-app text-[10.5px] tracking-[0.06em]">{j.id}</span>
            </div>

            {/* The same quote form as every other job on this board. A request
                changes who may quote, never how a quote is made. */}
            <QuotePanel jobId={j.id} />

            <form action={declineJobRequest} className="mt-4 flex flex-wrap items-center gap-2.5 border-t border-gold/20 pt-4">
              <input type="hidden" name="jobId" value={j.id} />
              <label className="min-w-[220px] flex-1 text-[12.5px] text-dim">
                Cannot take this one on?
                <input
                  name="reason"
                  maxLength={200}
                  placeholder="Optional: one line the client can read, for example booked until the 20th"
                  className="mt-1.5 w-full rounded-xl border border-line bg-bg px-3 py-2 text-[13px] text-ink outline-none focus:border-purple"
                />
              </label>
              <button className="rounded-full border border-line2 px-4 py-2.5 text-[12.5px] font-bold text-ink transition hover:border-purple hover:text-purpleb">
                Pass on this job
              </button>
            </form>
          </div>
        ))}
      </div>
    </section>
  );
}
