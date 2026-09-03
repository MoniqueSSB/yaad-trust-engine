import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { toggleDay, requestVisit, setVisitState } from "@/app/portal/calendar-actions";

/**
 * The calendar band, PORTAL-SPEC.md 5.1. Always visible, never behind a
 * click. Three views of one calendar:
 *   worker  - their own diary, toggling days open or closed
 *   client  - only days their worker has opened; requests a slot
 *   service - the provider's open days; books a call or a visit
 *
 * Server component. Month and selected day travel in the URL (cal, d), so
 * there is no client state to lose and the back button works.
 */

const SLOTS_JOB = ["08:00 to 12:00", "13:00 to 17:00", "08:00 to 17:00"];
const SLOTS_SVC = ["15 minutes", "30 minutes", "Half day on site"];
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DOW = ["M", "T", "W", "T", "F", "S", "S"];

function iso(y: number, m: number, d: number) {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export async function CalBand({
  side,
  owner,
  jobId,
  kind,
  base,
  cal,
  sel,
  viewerEmail,
}: {
  side: "worker" | "client" | "service";
  owner: string;            // whose diary this is
  jobId: string;            // the job or service this booking belongs to
  kind: "job" | "service";
  base: string;             // page path for links and revalidation
  cal?: string;             // "YYYY-M" month being viewed
  sel?: string;             // selected ISO day
  viewerEmail: string;
}) {
  const now = new Date();
  const [cy, cm] = (() => {
    const m = /^(\d{4})-(\d{1,2})$/.exec(cal ?? "");
    if (m) return [Number(m[1]), Number(m[2]) - 1] as const;
    return [now.getUTCFullYear(), now.getUTCMonth()] as const;
  })();
  const todayIso = iso(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const first = new Date(Date.UTC(cy, cm, 1));
  const daysIn = new Date(Date.UTC(cy, cm + 1, 0)).getUTCDate();
  const pad = (first.getUTCDay() + 6) % 7;
  const monthStart = iso(cy, cm, 1);
  const monthEnd = iso(cy, cm, daysIn);

  const supabase = await createClient();
  const [{ data: avail }, { data: visits }, { data: worked }] = await Promise.all([
    supabase
      .from("worker_availability")
      .select("day,open")
      .eq("owner_email", owner)
      .gte("day", monthStart)
      .lte("day", monthEnd),
    supabase
      .from("visits")
      .select("id,day,slot,what,state,job_id,requested_by")
      .eq("owner_email", owner)
      .neq("state", "cancelled")
      .order("day", { ascending: true }),
    /* The days work actually happened on this job. Founder's instruction,
       2 Sep 2026: the calendar should track the day the work took place.
       arrival_log is the geotagged on-site check-in (20260901za) and
       arrived_on is already the Jamaica-local date it happened on, so no
       timezone is re-derived here. A service has no arrival log, and the
       query is skipped rather than guessed at. */
    kind === "job"
      ? supabase.from("arrival_log").select("arrived_on,stage").eq("job_id", jobId)
      : Promise.resolve({ data: [] as { arrived_on: string; stage: number }[] }),
  ]);

  /* Day -> the stage that was worked on it, so the calendar can say what
     the visit was for rather than only that somebody attended. */
  const workedDays = new Map<string, number>();
  for (const w of (worked ?? []) as { arrived_on: string; stage: number }[]) {
    if (w.arrived_on && !workedDays.has(w.arrived_on)) workedDays.set(w.arrived_on, w.stage);
  }

  const openDays = new Set(
    (avail ?? []).filter((a) => a.open).map((a) => a.day as string),
  );
  const byDay = new Map<string, { id: string; slot: string; state: string; job_id: string }[]>();
  for (const v of visits ?? []) {
    const list = byDay.get(v.day as string) ?? [];
    list.push(v as never);
    byDay.set(v.day as string, list);
  }

  const prev = cm === 0 ? `${cy - 1}-12` : `${cy}-${cm}`;
  const next = cm === 11 ? `${cy + 1}-1` : `${cy}-${cm + 2}`;
  const keepSel = sel ? `&d=${sel}` : "";
  const slots = side === "service" ? SLOTS_SVC : SLOTS_JOB;
  const upcoming = (visits ?? [])
    .filter((v) => v.state !== "done" && (v.day as string) >= todayIso)
    .slice(0, 4);

  const selVisits = sel ? (byDay.get(sel) ?? []) : [];
  const selOpen = sel ? openDays.has(sel) : false;
  const selConfirmed = selVisits.some((v) => v.state === "confirmed");

  return (
    <section className="mt-5 grid gap-4 rounded-2xl border border-line bg-panel p-3.5 md:grid-cols-[262px_1fr]">
      <div>
        <div className="mb-2 flex items-center gap-2">
          <h3 className="font-display text-[15px] uppercase">
            {MONTHS[cm].slice(0, 3)} {cy}
          </h3>
          <div className="ml-auto flex gap-1.5">
            <Link href={`${base}?cal=${prev}${keepSel}`} aria-label="Previous month"
              className="grid size-7 place-items-center rounded-lg border border-line text-mute hover:border-teal hover:text-tealb">&lsaquo;</Link>
            <Link href={`${base}?cal=${next}${keepSel}`} aria-label="Next month"
              className="grid size-7 place-items-center rounded-lg border border-line text-mute hover:border-teal hover:text-tealb">&rsaquo;</Link>
          </div>
        </div>
        <div className="grid grid-cols-7 gap-[3px] text-center text-[8px] font-bold uppercase tracking-widest text-dim">
          {DOW.map((d, i) => <span key={i} className="py-0.5">{d}</span>)}
        </div>
        <div className="mt-1 grid grid-cols-7 gap-[3px]">
          {Array.from({ length: pad }).map((_, i) => <span key={"p" + i} />)}
          {Array.from({ length: daysIn }).map((_, i) => {
            const d = i + 1;
            const k = iso(cy, cm, d);
            const past = k < todayIso;
            const dayVisits = byDay.get(k) ?? [];
            const hasConfirmed = dayVisits.some((v) => v.state === "confirmed" || v.state === "done");
            const hasPending = dayVisits.some((v) => v.state === "pending");
            const didWork = workedDays.has(k);
            const state = didWork ? "worked" : hasConfirmed ? "booked" : hasPending ? "pending" : openDays.has(k) ? "free" : "closed";
            const cls =
              "grid min-h-[32px] place-items-center rounded-[7px] border text-[11.5px] transition " +
              (state === "worked" ? "border-green/45 bg-green/[0.14] font-bold text-green"
                : state === "booked" ? "border-mango/40 bg-mango/10 font-bold text-mango"
                : state === "pending" ? "border-coral/35 bg-coral/10 text-coral"
                : state === "free" ? "border-softline bg-soft text-tealb"
                : "border-line bg-bg text-mute") +
              (k === todayIso ? " ring-1 ring-inset ring-mango" : "") +
              (k === sel ? " ring-2 ring-tealb/50" : "") +
              (past && dayVisits.length === 0 && !didWork ? " opacity-25" : " hover:border-line2");
            return past && dayVisits.length === 0 && !didWork ? (
              <span key={k} className={cls}>{d}</span>
            ) : (
              <Link key={k} href={`${base}?cal=${cy}-${cm + 1}&d=${k === sel ? "" : k}`} className={cls}>{d}</Link>
            );
          })}
        </div>
        <div className="mt-2.5 flex flex-wrap gap-2.5 border-t border-line pt-2 text-[10px] text-dim">
          <span className="flex items-center gap-1.5"><i className="size-2.5 rounded-[3px] bg-soft ring-1 ring-inset ring-softline" />Open</span>
          <span className="flex items-center gap-1.5"><i className="size-2.5 rounded-[3px] bg-mango/35" />Booked</span>
          <span className="flex items-center gap-1.5"><i className="size-2.5 rounded-[3px] bg-coral/30" />Pending</span>
          {workedDays.size > 0 && (
            <span className="flex items-center gap-1.5"><i className="size-2.5 rounded-[3px] bg-green/40" />Worked on site</span>
          )}
        </div>
      </div>

      <div className="min-w-0">
        <h4 className="mb-2 text-[10px] font-bold uppercase tracking-[.2em] text-mango">
          {side === "worker" ? "Your diary" : side === "service" ? "Book time with Monique" : "Coming up"}
        </h4>

        {upcoming.length === 0 ? (
          <p className="rounded-xl border border-line bg-bg px-3 py-2.5 text-[12px] text-dim">
            Nothing booked yet.{" "}
            {side === "worker"
              ? "Tap a day to open it; clients can only request days you have opened."
              : "Teal days are open. Tap one to " + (side === "service" ? "book." : "request a time.")}
          </p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {upcoming.map((v) => (
              <li key={v.id} className={"rounded-xl border border-line bg-bg px-3 py-2.5 border-l-[3px] " + (v.state === "pending" ? "border-l-coral" : "border-l-tealb")}>
                <b className="block text-[12.5px] tabular-nums">{v.day} · {v.slot}</b>
                <span className="mt-0.5 block text-[11px] text-dim">{v.job_id}{v.what ? " · " + v.what : ""}</span>
                <span className={"mt-1 inline-block text-[9.5px] font-bold uppercase tracking-wide " + (v.state === "pending" ? "text-coral" : "text-tealb")}>
                  {v.state === "pending" ? "Awaiting confirmation" : "Confirmed"}
                </span>
                {side === "worker" && v.state === "pending" && (
                  <form action={setVisitState} className="mt-1.5 flex gap-1.5">
                    <input type="hidden" name="id" value={v.id} />
                    <input type="hidden" name="path" value={base} />
                    <button name="state" value="confirmed" className="rounded-full bg-linear-to-r from-teal to-mango px-3 py-1 text-[11px] font-bold text-onbrand">Confirm</button>
                    <button name="state" value="cancelled" className="rounded-full border border-line px-3 py-1 text-[11px] text-mute hover:border-coral hover:text-coral">Decline</button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}

        {sel && (
          <div className="mt-3 border-t border-line pt-2.5">
            <b className="text-[12.5px]">{sel}</b>
            {workedDays.has(sel) && (
              <p className="mt-1.5 flex items-center gap-2 text-[11.5px] text-green">
                <svg viewBox="0 0 24 24" className="size-3.5 shrink-0 fill-none stroke-green stroke-2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 21s7-5.2 7-11a7 7 0 1 0-14 0c0 5.8 7 11 7 11Z" /><circle cx="12" cy="10" r="2.6" />
                </svg>
                Worked on site this day · stage {workedDays.get(sel)}
              </p>
            )}
            {side === "worker" ? (
              <form action={toggleDay} className="mt-1.5">
                <input type="hidden" name="day" value={sel} />
                <input type="hidden" name="path" value={base} />
                <button className={"rounded-full px-4 py-1.5 text-[12px] font-bold " + (openDays.has(sel) ? "border border-line2 text-ink hover:border-coral hover:text-coral" : "bg-linear-to-r from-teal to-mango text-onbrand")}>
                  {openDays.has(sel) ? "Close this day" : "Open this day"}
                </button>
                <p className="mt-1.5 text-[11px] leading-relaxed text-dim">
                  Opening a day is not a promise. Every request still needs your confirmation.
                </p>
              </form>
            ) : selConfirmed ? (
              <p className="mt-1.5 text-[11.5px] text-dim">This day is booked and closed to new requests.</p>
            ) : !selOpen ? (
              <p className="mt-1.5 text-[11.5px] text-dim">
                {side === "service" ? "Monique has" : "The worker has"} not opened this day. Teal days are the open ones.
              </p>
            ) : (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {slots.map((slot) => (
                  <form key={slot} action={requestVisit}>
                    <input type="hidden" name="day" value={sel} />
                    <input type="hidden" name="slot" value={slot} />
                    <input type="hidden" name="jobId" value={jobId} />
                    <input type="hidden" name="kind" value={kind} />
                    <input type="hidden" name="owner" value={owner} />
                    <input type="hidden" name="path" value={base} />
                    <button className="rounded-full border border-line px-3.5 py-1.5 text-[12px] font-bold text-mute transition hover:border-teal hover:text-tealb">
                      {slot}
                    </button>
                  </form>
                ))}
                <p className="w-full text-[11px] leading-relaxed text-dim">
                  {side === "service"
                    ? "You get a confirmation once Monique accepts."
                    : "This goes to the worker as a request. Nothing is booked by you alone."}
                </p>
              </div>
            )}
          </div>
        )}
        {viewerEmail.toLowerCase() === owner.toLowerCase() && side !== "worker" ? null : null}
      </div>
    </section>
  );
}
