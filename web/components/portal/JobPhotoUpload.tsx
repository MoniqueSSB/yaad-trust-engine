"use client";

import { useState } from "react";
import { removeJobPhoto, setJobPhotoBoard, uploadJobPhoto } from "@/app/portal/job-photo-actions";

export type JobPhoto = {
  id: string;
  caption: string;
  img: string | null;
  board_ok: boolean | null;
  source: string | null;
};

/**
 * The client's own photographs of the job, and the way to send more.
 *
 * This exists because the only route a picture had into Yaadly was a WhatsApp
 * message, and the job wizard said as much. A photograph is the single thing
 * that turns a guess into a quote, so asking for one should not depend on
 * whether somebody happens to use WhatsApp.
 *
 * Two things are said plainly here rather than buried in a policy: a picture
 * goes on the public board only if this person says so, at upload or later,
 * and it can be taken off or taken back at any time. Both are true in
 * Postgres as well (20260903b); this is just where the person reading it
 * finds out. WhatsApp photographs are the desk's to publish and remove, and
 * the buttons simply do not appear on those.
 */
export function JobPhotoUpload({
  jobId,
  photos,
  embedded = false,
}: {
  jobId: string;
  photos: JobPhoto[];
  /** Inside the board preview (JobEditTools): no heading or intro, a lighter
   *  box, one line of footer. Same form, same rules. */
  embedded?: boolean;
}) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [msg, setMsg] = useState("");

  return (
    <section
      className={embedded ? "mt-3 rounded-xl border border-line bg-bg/40 p-3" : "mt-4 rounded-2xl border border-line bg-panel p-4"}
    >
      {!embedded && (
        <>
          <p className="text-[10.5px] font-bold uppercase tracking-[.2em] text-tealb">
            Photos of the job
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-dim">
            Photographs help more than anything else you can send: they are what
            turns a guess into a quote. Wide shot first, then close up on the
            problem. Whoever is at the property can take them.
          </p>
        </>
      )}
      {embedded && (
        <p className="text-[12px] leading-relaxed text-dim">
          Wide shot first, then close up on the problem. A photo is what turns
          a guess into a quote.
        </p>
      )}

      {photos.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2.5">
          {photos.map((p) => (
            <figure
              key={p.id}
              className="relative h-[92px] w-[136px] shrink-0 overflow-hidden rounded-xl border border-softline bg-soft"
            >
              {p.img && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.img} alt={p.caption} className="size-full object-cover" />
              )}
              <figcaption className="absolute inset-x-0 bottom-0 bg-bg/80 px-2 py-1 text-[9px] leading-tight text-mute">
                {p.board_ok ? "On the marketplace · " : "Private · "}
                {p.caption}
              </figcaption>
              {/* Only what this person sent. Postgres refuses the rest, and
                  the form would simply come back with the reason. */}
              {p.source === "client" && (
                <form
                  action={async (fd) => {
                    setState("busy");
                    try {
                      await removeJobPhoto(fd);
                      setState("done");
                      setMsg("Taken off the job, and the file with it.");
                    } catch (e) {
                      setState("error");
                      setMsg(e instanceof Error ? e.message : "That did not go through.");
                    }
                  }}
                >
                  <input type="hidden" name="jobId" value={jobId} />
                  <input type="hidden" name="photoId" value={p.id} />
                  <button
                    aria-label={"Remove the photo captioned " + p.caption}
                    className="absolute right-1 top-1 grid size-[22px] place-items-center rounded-full bg-bg/85 text-[13px] leading-none text-mute transition hover:text-coral"
                  >
                    ×
                  </button>
                </form>
              )}
              {/* The client's own call, both ways, for a photo they sent.
                  set_job_photo_board_as_me() is what decides; this only
                  asks. */}
              {p.source === "client" && (
                <form
                  action={async (fd) => {
                    setState("busy");
                    try {
                      await setJobPhotoBoard(fd);
                      setState("done");
                      setMsg(
                        p.board_ok
                          ? "Taken off the marketplace. Only you, Yaadly and the worker booked on this job can see it now."
                          : "On the marketplace now, with the job. No address, no name, no phone number goes with it.",
                      );
                    } catch (e) {
                      setState("error");
                      setMsg(e instanceof Error ? e.message : "That did not go through.");
                    }
                  }}
                >
                  <input type="hidden" name="jobId" value={jobId} />
                  <input type="hidden" name="photoId" value={p.id} />
                  <input type="hidden" name="on" value={p.board_ok ? "false" : "true"} />
                  <button
                    className="absolute left-1 top-1 rounded-full bg-bg/85 px-2 py-0.5 text-[9.5px] font-bold text-tealb transition hover:brightness-125"
                  >
                    {p.board_ok ? "Take off marketplace" : "Show on marketplace"}
                  </button>
                </form>
              )}
            </figure>
          ))}
        </div>
      )}

      <form
        action={async (fd) => {
          setState("busy");
          try {
            await uploadJobPhoto(fd);
            setState("done");
            setMsg(
              fd.get("board") === "on"
                ? "Sent, and on the marketplace with the job. No address, no name, no phone number goes with it."
                : "Sent. Only you, Yaadly and the worker booked on this job can see it.",
            );
          } catch (e) {
            setState("error");
            setMsg(e instanceof Error ? e.message : "That did not go through.");
          }
        }}
      >
        <input type="hidden" name="jobId" value={jobId} />
        <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto]">
          <input
            name="caption"
            maxLength={140}
            placeholder='What this shows, e.g. "The back roof from the yard"'
            className="rounded-xl border border-line bg-bg px-3.5 py-2.5 text-[13.5px] text-ink outline-none focus:border-teal"
          />
          <input
            type="file"
            name="photo"
            accept="image/jpeg,image/png,image/webp"
            className="text-[12.5px] text-mute file:mr-3 file:rounded-full file:border file:border-line2 file:bg-transparent file:px-3.5 file:py-2 file:text-[12.5px] file:font-bold file:text-ink"
          />
        </div>
        {/* Ticked by default: the reason a client sends a photograph is so
            tradespeople can quote against it, and the marketplace is where
            they look. The sentence beside it says what that means, and the
            button on the thumbnail undoes it in one click. */}
        <label className="mt-3 flex items-start gap-2.5 text-[12.5px] leading-relaxed text-mute">
          <input type="checkbox" name="board" defaultChecked className="mt-0.5 accent-teal" />
          <span>
            Show it on the marketplace with the job, so tradespeople can quote
            against it. Your address, your name and your phone number never go
            with it. Untick to keep it between you, Yaadly and the worker booked
            on this job.
          </span>
        </label>
        {state !== "idle" && state !== "busy" && (
          <p
            role="status"
            className={
              "mt-2.5 rounded-xl px-3.5 py-2.5 text-[13px] " +
              (state === "done"
                ? "border border-softline bg-soft text-mute"
                : "border border-coral/30 bg-coral/10 text-mute")
            }
          >
            {msg}
          </p>
        )}
        <button
          disabled={state === "busy"}
          className="mt-3 rounded-full bg-linear-to-r from-teal to-mango px-4.5 py-2.5 text-[13.5px] font-bold text-onbrand transition hover:brightness-110 disabled:opacity-40"
        >
          {state === "busy" ? "Sending..." : "Send a photo"}
        </button>
      </form>

      <p className="mt-3 text-[12px] leading-relaxed text-dim">
        {embedded
          ? "Stored privately, location data stripped. On the marketplace only if you say so, and off again in one click."
          : "Every photo is stored privately and the location the phone wrote into the file is stripped before it is saved. A photo reaches the public marketplace only if you say so, at upload or with the button on it later, and you can take it off the marketplace, or off the job entirely, at any time. Photos you sent on WhatsApp are shown only if you ask us to."}
      </p>
    </section>
  );
}
