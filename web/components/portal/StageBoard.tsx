import Link from "next/link";
import { STATUS_DOT, type StatusLabel, type StatusTone } from "./statusTone";
import { WhereText, type Job } from "./JobList";
import { whenDate } from "@/lib/date";
import {
  CLIENT_BOARD_COLUMNS,
  CLIENT_STEPS,
  clientStepOf,
  groupForBoard,
  type BoardColumnKey,
} from "@/lib/portal/board";

/**
 * The client's jobs as three columns by stage, 17 Sep 2026, from the Portal
 * Overview design.
 *
 * It replaces the pill strip and the two stacked lists (live, then closed)
 * for jobs. Services keep their own list below it: they have a six step
 * track of their own and do not fit these columns.
 *
 * Every card carries what the old row carried: the job, where, what stage in
 * words, the agreed price when there is one, and what is next, and the whole
 * card still opens the exact section that next step lives in. What the design
 * had and this does not: photo and message counts, worker avatars and a
 * "more" menu. None of them is loaded by this page, and a menu that opens
 * nothing is worse than no menu.
 *
 * A card that is waiting on the client is gold and says so in its tag. That
 * is the same "waiting" tone as everywhere else in the portal (statusTone.ts),
 * not a new colour rule.
 */

const COLUMN_DOT: Record<BoardColumnKey, string> = {
  quotes: "bg-purple",
  under_way: "bg-gold",
  closed: "bg-green",
};

/** Closed jobs beyond this many fold away, so a long history does not push
 *  the live columns' height out of proportion. */
const CLOSED_SHOWN = 3;

const CARD: Record<StatusTone, string> = {
  waiting: "border-gold/45 bg-gold/[0.06] shadow-[0_0_22px_rgba(245,158,11,.07)] hover:border-gold/70",
  moving: "border-line2 bg-panel hover:border-softline",
  done: "border-green/25 bg-green/[0.04] hover:border-green/45",
  idle: "border-line bg-panel hover:border-line2",
};

const TAG: Record<StatusTone, string> = {
  waiting: "border-gold/30 bg-gold/15 text-goldb",
  moving: "border-softline bg-soft text-purpleb",
  done: "border-green/30 bg-green/12 text-green",
  idle: "border-line bg-panel2 text-mute",
};

const BAR: Record<StatusTone, string> = {
  waiting: "bg-linear-to-r from-goldb to-gold",
  moving: "bg-purple",
  done: "bg-green",
  idle: "bg-dim",
};

function BoardCard({ job, labels }: { job: Job; labels: Record<string, StatusLabel> }) {
  const s = labels[job.status] ?? { label: job.status, tone: "idle" as StatusTone };
  const step = clientStepOf(job.status);
  const updated = whenDate(job.updated_at);
  const tag = s.tone === "waiting" ? "Needs you" : job.trade;

  return (
    <li>
      <Link
        href={job.next?.href ?? "/portal/jobs/" + encodeURIComponent(job.id)}
        className={"flex flex-col gap-2.5 rounded-2xl border px-4 py-3.5 transition " + CARD[s.tone]}
      >
        {tag && (
          <span
            className={
              "self-start rounded-full border px-2.5 py-1 font-mono-app text-[9.5px] font-semibold uppercase tracking-[.1em] " +
              TAG[s.tone]
            }
          >
            {tag}
          </span>
        )}

        <b className="text-[14.5px] leading-snug text-ink">{job.title ?? "Untitled job"}</b>

        <p className="text-[12.5px] leading-relaxed text-mute">
          <WhereText addr={job.addr} parish={job.parish} hidden={job.addr_hidden} />
        </p>

        <div className="flex items-baseline justify-between gap-3 text-[12px]">
          <span className="flex items-center gap-2">
            <span className={"size-2 shrink-0 rounded-full " + STATUS_DOT[s.tone]} aria-hidden />
            <b className={s.tone === "waiting" ? "text-goldb" : "text-ink"}>{s.label}</b>
          </span>
          {step != null && (
            <span className="shrink-0 font-mono-app text-[11px] text-dim">
              Step {step} of {CLIENT_STEPS}
            </span>
          )}
        </div>

        {step != null && (
          <div
            className="h-[5px] overflow-hidden rounded-full bg-panel2"
            role="img"
            aria-label={`Step ${step} of ${CLIENT_STEPS}`}
          >
            <span
              className={"block h-full rounded-full " + BAR[s.tone]}
              style={{ width: Math.round((step / CLIENT_STEPS) * 100) + "%" }}
            />
          </div>
        )}

        {job.money && <p className="text-[12.5px] text-ink">{job.money}</p>}

        {job.next && (
          <p className={"text-[12.5px] font-bold " + (s.tone === "waiting" ? "text-goldb" : "text-tealb")}>
            {job.next.label} &rarr;
          </p>
        )}

        <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-line pt-2.5 text-[11.5px] text-dim">
          <span className="font-mono-app">{job.id}</span>
          {job.worker_choice != null && !job.worker_email && (
            <span className="text-tealb">
              {job.worker_choice === "client" ? "You choose from the quotes" : "Yaadly picks the tradesperson"}
            </span>
          )}
          {updated && <span className="ml-auto">Last moved {updated}</span>}
        </div>
      </Link>
    </li>
  );
}

export function StageBoard({
  jobs,
  labels,
  empty,
}: {
  jobs: Job[];
  labels: Record<string, StatusLabel>;
  empty: string;
}) {
  if (jobs.length === 0) {
    return (
      <section className="mt-8 lg:mt-0">
        <h2 className="mb-3 text-[10.5px] font-bold uppercase tracking-[.2em] text-tealb">Your jobs</h2>
        <div className="rounded-2xl border border-line bg-panel p-6">
          <p className="text-[13.5px] leading-relaxed text-mute">{empty}</p>
        </div>
      </section>
    );
  }

  const groups = groupForBoard(jobs);

  return (
    <section className="mt-8 lg:mt-0">
      <h2 className="mb-3 text-[10.5px] font-bold uppercase tracking-[.2em] text-tealb">
        Your jobs, by stage
      </h2>
      <div className="grid items-start gap-3 md:grid-cols-3">
        {CLIENT_BOARD_COLUMNS.map((col) => {
          const list = groups[col.key];
          const folded = col.key === "closed" && list.length > CLOSED_SHOWN;
          const shown = folded ? list.slice(0, CLOSED_SHOWN) : list;
          const rest = folded ? list.slice(CLOSED_SHOWN) : [];
          return (
            <div key={col.key} className="flex min-w-0 flex-col gap-2.5">
              <div className="flex items-center gap-2 px-0.5">
                <span className={"size-[7px] rounded-[2px] " + COLUMN_DOT[col.key]} aria-hidden />
                <b className="text-[13px] font-semibold">{col.title}</b>
                <span className="rounded-full bg-soft px-2 py-px font-mono-app text-[10px] font-semibold text-dim">
                  {list.length}
                </span>
              </div>

              {list.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-line2 px-4 py-3.5 text-center text-[12px] text-dim">
                  Nothing here right now
                </p>
              ) : (
                <ul className="flex flex-col gap-2.5">
                  {shown.map((j) => (
                    <BoardCard key={j.id} job={j} labels={labels} />
                  ))}
                </ul>
              )}

              {rest.length > 0 && (
                <details className="group">
                  <summary className="cursor-pointer list-none rounded-2xl border border-dashed border-line2 px-3 py-3 text-center text-[12px] font-semibold text-mute transition hover:border-softline hover:text-purpleb">
                    <span className="group-open:hidden">Show {rest.length} more closed</span>
                    <span className="hidden group-open:inline">Show fewer</span>
                  </summary>
                  <ul className="mt-2.5 flex flex-col gap-2.5">
                    {rest.map((j) => (
                      <BoardCard key={j.id} job={j} labels={labels} />
                    ))}
                  </ul>
                </details>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
