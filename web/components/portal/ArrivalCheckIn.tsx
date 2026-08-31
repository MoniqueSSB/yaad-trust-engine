import { logArrival } from "@/app/portal/arrival-actions";

/**
 * The Arrival Log, given a face. CLAUDE.md's own glossary defined it and
 * the stage rail has said "Stage 1 · on site" since journey.ts was
 * written; neither ever pointed at a real event before this. One tap when
 * the worker arrives, once per stage per Jamaica-local day, and the client
 * is told (yaad-notify-client, kind worker_on_site).
 */

export function ArrivalCheckIn({
  jobId,
  role,
  stage,
  checkedInToday,
  recent,
}: {
  jobId: string;
  role: "client" | "worker";
  stage: number;
  checkedInToday: boolean;
  recent: { stage: number; arrivedAt: string }[];
}) {
  if (role === "worker") {
    return (
      <section className="mt-4 rounded-2xl border border-line bg-panel p-4">
        <p className="text-[10.5px] font-bold uppercase tracking-[.2em] text-tealb">On site</p>
        {checkedInToday ? (
          <p className="mt-1.5 text-[13px] text-mute">
            Checked in for stage {stage} today. The client has been told.
          </p>
        ) : (
          <>
            <p className="mt-1.5 text-[12px] leading-relaxed text-dim">
              One tap when you arrive. The client is told you are on site
              for stage {stage}, once per day.
            </p>
            <form action={logArrival} className="mt-2.5">
              <input type="hidden" name="jobId" value={jobId} />
              <button className="rounded-full bg-linear-to-r from-teal to-mango px-4.5 py-2.5 text-[13.5px] font-bold text-[#04211D] transition hover:brightness-110">
                I&rsquo;m on site
              </button>
            </form>
          </>
        )}
      </section>
    );
  }

  // Client side: only shown when there is something to say. Silence is the
  // honest answer on a day nobody checked in.
  if (!checkedInToday && recent.length === 0) return null;

  return (
    <section className="mt-4 rounded-2xl border border-line bg-panel p-4">
      <p className="text-[10.5px] font-bold uppercase tracking-[.2em] text-tealb">On site</p>
      {checkedInToday && (
        <p className="mt-1.5 text-[13px] text-mute">
          Your worker checked in on site today for stage {stage}.
        </p>
      )}
      {recent.length > 0 && (
        <ul className="mt-2 grid gap-1 text-[12px] text-dim">
          {recent.slice(0, 5).map((r, i) => (
            <li key={i}>
              Stage {r.stage} · {r.arrivedAt}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
