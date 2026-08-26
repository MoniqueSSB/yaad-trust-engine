"use client";

import { useState } from "react";
import { submitReview } from "@/app/portal/review-actions";

/**
 * The review form, MARKETPLACE-BUILD-SPEC 5.2. Stars, then criteria as
 * tappable chips (a worker on a phone will not write an essay), then free
 * text. The four rules are enforced in Postgres; this form can only ask.
 */

const CRITERIA: Record<"client_of_worker" | "worker_of_client", string[]> = {
  client_of_worker: [
    "Turned up when he said",
    "Work matched what was agreed",
    "Kept me updated",
    "Cleaned up after himself",
  ],
  worker_of_client: [
    "Access was there when agreed",
    "Clear about what they wanted",
    "Approved the evidence promptly",
    "Fair to deal with",
  ],
};

export function ReviewForm({
  jobId,
  direction,
  subjectEmail,
  subjectName,
}: {
  jobId: string;
  direction: "client_of_worker" | "worker_of_client";
  subjectEmail: string;
  subjectName: string;
}) {
  const [stars, setStars] = useState(0);
  const [picked, setPicked] = useState<string[]>([]);
  const [body, setBody] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "sent" | "error">("idle");

  if (state === "sent") {
    return (
      <div className="mt-4 rounded-2xl border border-mango/30 bg-mango/5 p-4 text-[13.5px] leading-relaxed text-mute">
        <b className="text-mango">Written, and held.</b>
        <p className="mt-1.5">
          Tied to {jobId} and to your sign-off. It publishes the moment the
          other side writes theirs, or in fourteen days if they do not.
          Neither of you can see the other&apos;s until then. {subjectName} gets
          one public reply and no way to remove it.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-2xl border border-mango/30 bg-mango/[.04] p-5">
      <p className="text-[10.5px] font-bold uppercase tracking-[.2em] text-mango">One thing left</p>
      <h3 className="mt-1 font-display text-[19px] uppercase">Review {subjectName} for {jobId}</h3>
      <p className="mt-1.5 text-[12px] text-dim">
        This is the only job you can review them for, and you can do it once.
        Sealed until both sides have written, or fourteen days.
      </p>

      <div className="mt-3.5" role="radiogroup" aria-label="Overall rating">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" onClick={() => setStars(n)}
            aria-label={n + " star" + (n === 1 ? "" : "s")}
            className={"px-0.5 text-[22px] " + (n <= stars ? "text-mango" : "text-line2")}>
            ★
          </button>
        ))}
      </div>

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {CRITERIA[direction].map((c) => {
          const on = picked.includes(c);
          return (
            <button key={c} type="button"
              onClick={() => setPicked(on ? picked.filter((x) => x !== c) : [...picked, c])}
              className={"rounded-full border px-3 py-1.5 text-[12px] font-bold transition " + (on ? "border-teal bg-soft text-tealb" : "border-line text-mute hover:border-teal")}>
              {on ? "✓ " : ""}{c}
            </button>
          );
        })}
      </div>

      <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} maxLength={1200}
        placeholder="In your own words. What would somebody in your position want to know?"
        className="mt-3 w-full rounded-xl border border-line bg-bg px-3.5 py-3 text-[13.5px] leading-relaxed text-ink outline-none focus:border-teal" />

      {state === "error" && (
        <p role="alert" className="mt-2.5 rounded-xl border border-coral/30 bg-coral/10 px-3.5 py-2.5 text-[13px] text-mute">
          The database refused this review. It only accepts one per side, from
          a party of a completed job.
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={stars < 1 || state === "busy"}
          onClick={async () => {
            setState("busy");
            try {
              await submitReview({ jobId, direction, subjectEmail, stars, criteria: picked, body });
              setState("sent");
            } catch {
              setState("error");
            }
          }}
          className="rounded-full bg-linear-to-r from-teal to-mango px-4.5 py-2.5 text-[13.5px] font-bold text-[#04211D] transition hover:brightness-110 disabled:opacity-40"
        >
          {state === "busy" ? "Posting..." : "Post review"}
        </button>
        <span className="text-[11.5px] text-dim">
          {stars < 1 ? "Pick a rating to continue" : "Published under your first name. It cannot be edited after."}
        </span>
      </div>
    </div>
  );
}
