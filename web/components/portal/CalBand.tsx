import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { toggleDay, requestVisit, setVisitState } from "@/app/portal/calendar-actions";
import {
  buildStageEvents,
  eventsByDay,
  eventLabel,
  stageHistory,
  shortDay,
  type StageEventKind,
} from "@/lib/portal/stage-timeline";

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

/* One colour per kind of stage event, used for the dots on a day, the list
   under a selected day and the stage history, so a colour means the same
   thing in all three places. Money moving (a stage invoice paid, materials
   released) shares one colour: to the reader it is one kind of fact. */
const DOT: Record<StageEventKind, string> = {
  agreed: "bg-dim",
  arrived: "bg-green",
  evidence: "bg-purpleb",
  approved: "bg-goldb",
  paid: "bg-ink",
  materials: "bg-ink",
};

export async function CalBand({
  side,
  owner,
  jobId,
  kind,
  base,
  cal,
  sel,
  viewerEmail,
  stageNames,
}: {
  side: "worker" | "client" | "service";
  owner: string;            // whose diary this is
  jobId: string;            // the job or service this booking belongs to
  kind: "job" | "service";
  base: string;             // page path for links and revalidation
  cal?: string;             // "YYYY-M" month being viewed
  sel?: string;             // selected ISO day
  viewerEmail: string;
  /** the agreed pack's stage names, in order, so the history can name them */
  stageNames?: string[];
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
  /* A service has no stages, so every stage query is skipped rather than
     guessed at. Each one runs as the viewer, under RLS, and the invoice
     query also names the viewer's own side: a client sees the stage
     invoices they paid Yaadly, a worker sees their own pay invoices. */
  const isJob = kind === "job";
  const none = Promise.resolve({ data: [] as never[] });
  const [
    { data: avail },
    { data: visits },
    { data: arrivals },
    { data: evidence },
    { data: approvals },
    { data: paidInvoices },
    { data: materials },
    { data: packs },
  ] = await Promise.all([
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
       arrived_on is already the Jamaica-local date it happened on. */
    isJob ? supabase.from("arrival_log").select("arrived_at,arrived_on,stage").eq("job_id", jobId) : none,
    /* And, from 13 Sep 2026, every other dated step on each stage, so the
       calendar tracks when each stage took place, not only the site days. */
    isJob ? supabase.from("evidence").select("stage,created_at").eq("job_id", jobId) : none,
    isJob ? supabase.from("stage_approvals").select("stage,approved_at").eq("job_id", jobId) : none,
    isJob
      ? supabase
          .from("invoices")
          .select("stage,paid_at,status")
          .eq("job_id", jobId)
          .eq("payable_to", side === "worker" ? "worker" : "yaadly")
          .not("paid_at", "is", null)
      : none,
    isJob
      ? supabase.from("materials_releases").select("stage,released_at").eq("job_id", jobId).not("released_at", "is", null)
      : none,
    isJob
      ? supabase
          .from("kickoff_packs")
          .select("both_confirmed_at")
          .eq("job_id", jobId)
          .eq("status", "approved")
          .not("both_confirmed_at", "is", null)
          .order("both_confirmed_at", { ascending: false })
          .limit(1)
      : none,
  ]);

  const viewSide = side === "worker" ? "worker" : "client";
  const stageEvents = buildStageEvents({
    agreedAt: (packs?.[0] as { both_confirmed_at?: string } | undefined)?.both_confirmed_at ?? null,
    arrivals: arrivals ?? [],
    evidence: evidence ?? [],
    approvals: approvals ?? [],
    paidInvoices: paidInvoices ?? [],
    materials: materials ?? [],
  });
  const eventDays = eventsByDay(stageEvents);
  const presentKinds = new Set(
    stageEvents.filter((e) => e.day >= monthStart && e.day <= monthEnd).map((e) => e.kind),
  );
  const history = isJob ? stageHistory(stageEvents, stageNames ?? []) : [];
  const agreed = stageEvents.find((e) => e.kind === "agreed") ?? null;
  const HISTORY_STEPS: [Exclude<StageEventKind, "agreed">, string][] = [
    ["arrived", "First on site"],
    ["evidence", "First evidence"],
    ["approved", "Approved"],
    ["paid", viewSide === "worker" ? "Pay invoice paid" : "Invoice paid"],
    ["materials", "Materials released"],
  ];
  /* A date in the history jumps the calendar to its month with that day
     open, which is how a stage from last month stays one tap away. */
  const dayHref = (day: string) => {
    const [y, m] = day.split("-");
    return `${base}?cal=${y}-${Number(m)}&d=${day}`;
  };

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
  const selEvents = sel ? (eventDays.get(sel) ?? []) : [];

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
            const dayEvents = eventDays.get(k) ?? [];
            const didWork = dayEvents.some((e) => e.kind === "arrived");
            const state = didWork ? "worked" : hasConfirmed ? "booked" : hasPending ? "pending" : dayEvents.length ? "event" : openDays.has(k) ? "free" : "closed";
            const quiet = past && dayVisits.length === 0 && dayEvents.length === 0;
            const cls =
              "flex min-h-[32px] flex-col items-center justify-center gap-[2px] rounded-[7px] border text-[11.5px] transition " +
              (state === "worked" ? "border-green/45 bg-green/[0.14] font-bold text-green"
                : state === "booked" ? "border-mango/40 bg-mango/10 font-bold text-mango"
                : state === "pending" ? "border-coral/35 bg-coral/10 text-coral"
                : state === "event" ? "border-line2 bg-panel2 font-bold text-ink"
                : state === "free" ? "border-softline bg-soft text-tealb"
                : "border-line bg-bg text-mute") +
              (k === todayIso ? " ring-1 ring-inset ring-mango" : "") +
              (k === sel ? " ring-2 ring-tealb/50" : "") +
              (quiet ? " opacity-25" : " hover:border-line2");
            const kinds = [...new Set(dayEvents.map((e) => e.kind))];
            const body = (
              <>
                <span className="leading-none">{d}</span>
                {kinds.length > 0 && (
                  <span className="flex gap-[2px]" aria-hidden>
                    {kinds.map((kd) => <i key={kd} className={"size-[4px] rounded-full " + DOT[kd]} />)}
                  </span>
                )}
              </>
            );
            return quiet ? (
              <span key={k} className={cls}>{body}</span>
            ) : (
              <Link key={k} href={`${base}?cal=${cy}-${cm + 1}&d=${k === sel ? "" : k}`} className={cls}
                aria-label={dayEvents.length ? `${shortDay(k)}, ${dayEvents.length} stage event${dayEvents.length === 1 ? "" : "s"}` : undefined}>
                {body}
              </Link>
            );
          })}
        </div>
        <div className="mt-2.5 flex flex-wrap gap-2.5 border-t border-line pt-2 text-[10px] text-dim">
          <span className="flex items-center gap-1.5"><i className="size-2.5 rounded-[3px] bg-soft ring-1 ring-inset ring-softline" />Open</span>
          <span className="flex items-center gap-1.5"><i className="size-2.5 rounded-[3px] bg-mango/35" />Booked</span>
          <span className="flex items-center gap-1.5"><i className="size-2.5 rounded-[3px] bg-coral/30" />Pending</span>
          {presentKinds.has("arrived") && (
            <span className="flex items-center gap-1.5"><i className="size-2 rounded-full bg-green" />On site</span>
          )}
          {presentKinds.has("evidence") && (
            <span className="flex items-center gap-1.5"><i className="size-2 rounded-full bg-purpleb" />Evidence</span>
          )}
          {presentKinds.has("approved") && (
            <span className="flex items-center gap-1.5"><i className="size-2 rounded-full bg-goldb" />Approved</span>
          )}
          {(presentKinds.has("paid") || presentKinds.has("materials")) && (
            <span className="flex items-center gap-1.5"><i className="size-2 rounded-full bg-ink" />Paid or released</span>
          )}
          {presentKinds.has("agreed") && (
            <span className="flex items-center gap-1.5"><i className="size-2 rounded-full bg-dim" />Agreed</span>
          )}
        </div>
      </div>

      <div className="min-w-0">
        <h4 className="mb-2 text-[10px] font-bold uppercase tracking-[.2em] text-mango">
          {side === "worker" ? "Your diary" : side === "service" ? "Book time with Yaadly" : "Coming up"}
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
            <b className="text-[12.5px]">{shortDay(sel)}</b>
            {selEvents.length > 0 && (
              <ul className="mt-1.5 grid gap-1">
                {selEvents.map((e, i) => (
                  <li key={i} className="flex items-center gap-2 text-[11.5px] text-mute">
                    <i className={"size-2 shrink-0 rounded-full " + DOT[e.kind]} />
                    <span className="min-w-0 flex-1">{eventLabel(e, viewSide)}</span>
                    {e.time && <span className="shrink-0 font-mono-app text-[10.5px] text-dim">{e.time}</span>}
                  </li>
                ))}
              </ul>
            )}
            {/* A day that has gone cannot be opened or requested. Before
                stage history made past days clickable this never came up. */}
            {sel < todayIso ? (
              selEvents.length === 0 && (
                <p className="mt-1.5 text-[11.5px] text-dim">Nothing was recorded on this job this day.</p>
              )
            ) : side === "worker" ? (
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
                {side === "service" ? "Yaadly has" : "The worker has"} not opened this day. Teal days are the open ones.
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
                    ? "You get a confirmation once Yaadly accepts."
                    : "This goes to the worker as a request. Nothing is booked by you alone."}
                </p>
              </div>
            )}
          </div>
        )}
        {viewerEmail.toLowerCase() === owner.toLowerCase() && side !== "worker" ? null : null}
      </div>

      {history.length > 0 && (
        <div className="min-w-0 border-t border-line pt-3 md:col-span-2">
          <h4 className="text-[10px] font-bold uppercase tracking-[.2em] text-mango">Stage history</h4>
          <p className="mb-2 mt-0.5 text-[11px] text-dim">
            When each stage happened, by the day in Jamaica. Tap a date to see that day.
          </p>
          {agreed && (
            <Link href={dayHref(agreed.day)} className="mb-1.5 flex w-fit items-center gap-1.5 text-[11.5px] text-mute hover:text-tealb">
              <i className={"size-2 rounded-full " + DOT.agreed} />
              {eventLabel(agreed, viewSide)}
              <span className="font-mono-app text-[10.5px]">{shortDay(agreed.day)}</span>
            </Link>
          )}
          <ul className="grid gap-1.5">
            {history.map((r) => {
              const steps = HISTORY_STEPS.filter(([k]) => r.firsts[k]);
              return (
                <li key={r.stage} className="flex flex-wrap items-center gap-x-3.5 gap-y-1 rounded-xl border border-line bg-bg px-3 py-2 text-[11.5px]">
                  <b className="text-[12px] text-ink">
                    Stage {r.stage}{r.name ? " · " + r.name : ""}
                  </b>
                  {steps.length === 0 ? (
                    <span className="text-dim">Nothing recorded yet</span>
                  ) : (
                    steps.map(([k, label]) => {
                      const e = r.firsts[k]!;
                      return (
                        <Link key={k} href={dayHref(e.day)} className="flex items-center gap-1.5 text-mute hover:text-tealb">
                          <i className={"size-2 rounded-full " + DOT[k]} />
                          {label}
                          <span className="font-mono-app text-[10.5px]">{shortDay(e.day)}</span>
                        </Link>
                      );
                    })
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
