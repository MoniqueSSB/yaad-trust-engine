"use client";

import { useState } from "react";
import { JobDescrEditor } from "@/components/portal/JobDescrEditor";
import { JobPhotoUpload, type JobPhoto } from "@/components/portal/JobPhotoUpload";

/**
 * Two small buttons on the board preview: change the words, add a picture.
 *
 * The first version of these was two full sections stacked above the
 * preview, each with its own heading and paragraph, and Monique's reaction
 * was the right one: "too big, just buttons on what the worker sees". The
 * preview is already the thing being edited, so the controls belong on it,
 * folded away until pressed. Both panels are the same components as before,
 * in their embedded form; the rules behind them did not move.
 */
export function JobEditTools({
  jobId,
  descr,
  photos,
  quotesIn,
  canEditDescr,
  openPhotos = false,
}: {
  jobId: string;
  descr: string;
  photos: JobPhoto[];
  quotesIn: number;
  canEditDescr: boolean;
  /** Start with the photo panel already open. Set from ?photos=1, which is
   *  where the job form's confirmation screen sends somebody who has just
   *  been told that a photograph is what turns a guess into a quote. Folded
   *  away is right for a job somebody is browsing; it is wrong for somebody
   *  who arrived holding four pictures of a roof. */
  openPhotos?: boolean;
}) {
  const [open, setOpen] = useState<"none" | "descr" | "photos">(openPhotos ? "photos" : "none");
  const btn =
    "rounded-full border px-3 py-1.5 text-[11.5px] font-bold transition ";
  const on = "border-teal bg-teal/10 text-tealb";
  const off = "border-line2 text-mute hover:border-teal hover:text-ink";

  return (
    <div className="mt-3">
      <div className="flex flex-wrap gap-2">
        {canEditDescr && (
          <button
            type="button"
            onClick={() => setOpen(open === "descr" ? "none" : "descr")}
            className={btn + (open === "descr" ? on : off)}
          >
            Edit the description
          </button>
        )}
        <button
          type="button"
          onClick={() => setOpen(open === "photos" ? "none" : "photos")}
          className={btn + (open === "photos" ? on : off)}
        >
          {photos.length > 0 ? "Photos (" + photos.length + ")" : "Add a photo"}
        </button>
      </div>

      {open === "descr" && (
        <JobDescrEditor
          jobId={jobId}
          descr={descr}
          quotesIn={quotesIn}
          embedded
          onClose={() => setOpen("none")}
        />
      )}
      {open === "photos" && <JobPhotoUpload jobId={jobId} photos={photos} embedded />}
    </div>
  );
}
