"use client";

import { useState } from "react";
import { logArrival } from "@/app/portal/arrival-actions";

/**
 * The Arrival Log, given a face. CLAUDE.md's own glossary defined it and
 * the stage rail has said "Stage 1 · on site" since journey.ts was
 * written; neither ever pointed at a real event before this. One tap when
 * the worker arrives, once per stage per Jamaica-local day, and the client
 * is told (yaad-notify-client, kind worker_on_site).
 *
 * One GPS reading rides along with that tap (founder's own instruction,
 * 1 Sep 2026), read once from the browser and handed to log_arrival()
 * exactly the way an in-person confirmation checkbox rides along with an
 * approval: it strengthens the record, it never gates it. A worker who
 * declines the browser's location prompt, whose phone has no fix, or
 * whose browser has no geolocation at all still checks in the same way,
 * with lat/lon simply left null. Nothing here reads location at any other
 * moment than this one tap.
 */

async function readLocation(): Promise<{ lat: number; lon: number; accuracy: number } | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return null;
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 },
    );
  });
}

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
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");
  const [msg, setMsg] = useState("");

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
              for stage {stage}, once per day. This also reads your phone&rsquo;s
              location once, at the moment you tap, to back up that you were
              there. If you say no to the location prompt, the check-in
              still goes through.
            </p>
            <form
              action={async (fd) => {
                setState("busy");
                setMsg("");
                const loc = await readLocation();
                if (loc) {
                  fd.set("lat", String(loc.lat));
                  fd.set("lon", String(loc.lon));
                  fd.set("accuracy", String(loc.accuracy));
                }
                try {
                  await logArrival(fd);
                } catch (e) {
                  setState("error");
                  setMsg(e instanceof Error ? e.message : "That did not go through.");
                }
              }}
              className="mt-2.5"
            >
              <input type="hidden" name="jobId" value={jobId} />
              <button
                disabled={state === "busy"}
                className="rounded-full bg-linear-to-r from-teal to-mango px-4.5 py-2.5 text-[13.5px] font-bold text-[#04211D] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {state === "busy" ? "Checking in…" : "I'm on site"}
              </button>
              {state === "error" && (
                <p role="alert" className="mt-1.5 text-[12.5px] leading-relaxed text-coral">
                  {msg}
                </p>
              )}
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
