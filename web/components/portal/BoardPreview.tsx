import type React from "react";

/**
 * The job as the public board will show it, rendered for the client before
 * they put it there.
 *
 * The privacy rules have always been real: open_jobs has no address column,
 * strips Address and Access contact lines out of the description, masks
 * phone numbers, and carries the materials store as a type rather than a
 * place. But every one of those protections is enforced in a view the
 * client never looks at, so at the exact moment they are asked to publish
 * a description of their mother's empty house to strangers, the strongest
 * thing on their side is invisible. This card is that view, shown.
 *
 * Two rules keep it honest:
 *
 *   1. It renders ONLY fields open_jobs exposes, laid out the way
 *      app/jobs/page.tsx lays them out. Nothing is mocked up.
 *   2. The scrubbed text is computed BY POSTGRES and handed in as
 *      `descr`. There is no JavaScript copy of the rule any more.
 *
 * It is a preview, not the enforcement. The enforcement stays in Postgres,
 * where a rule about who sees somebody's property belongs.
 *
 * Rule 2 used to say the opposite: boardDescr() lived here and mirrored the
 * view's regexp_replace chain "verbatim", with a comment telling the next
 * person to change both in the same commit. It was mirrored faithfully and it
 * was wrong in both places, which is the failure a mirror cannot catch. The
 * chain matched "Address:" and "Access contact:" and not a plain "Access:",
 * and it had no email pattern at all, so on 6 September 2026 this card showed
 * a client her own access arrangements and her own email address while the
 * list underneath told her both were stripped. The scrub is now one Postgres
 * function, public.board_descr(), called through rpc by the page above. A
 * third copy cannot drift because there is no third copy.
 */

/** board_ok is whether this photograph is on the public board. A photograph
 *  sent into a WhatsApp conversation is not published by default, so most of
 *  these are false, and the card says so rather than implying otherwise. */
type PreviewPhoto = { caption: string; img: string | null; board_ok?: boolean | null };

// Same answer-to-label map the board uses (app/jobs/page.tsx). The place
// itself never appears; a worker needs the answer to price the trips, not
// the location of the lockable room.
const STORE_LABEL: Record<string, string> = {
  lockable: "Lockable store on site",
  indoors: "Materials kept indoors",
  none_available: "No secure store, buy in drops",
};

export function BoardPreview({
  job,
  boardDescr,
  signed,
  photos,
  tools,
}: {
  /** The description as the board will show it, straight out of
   *  public.board_descr() in Postgres, which is the same function open_jobs
   *  itself calls. null means the scrub could not be computed, and this card
   *  then shows no description at all rather than falling back to the raw
   *  text: a preview that quietly prints the unscrubbed version is the exact
   *  failure this component exists to prevent. */
  boardDescr: string | null;
  job: {
    id: string;
    title: string | null;
    trade: string | null;
    parish: string | null;
    descr: string | null;
    job_type: string | null;
    size_band: string | null;
    access_type: string | null;
    materials_by: string | null;
    urgency: string | null;
    materials_store_type: string | null;
  };
  signed: boolean;
  photos: PreviewPhoto[];
  /** The client's own controls for this card (JobEditTools): edit the words,
   *  add a picture. Rendered inside the card, folded until pressed, because
   *  the card is the thing being edited. Absent for anyone who is not the
   *  client. */
  tools?: React.ReactNode;
}) {
  const descr = boardDescr;
  const scrubbed = (job.descr ?? null) !== boardDescr;
  const failed = boardDescr === null && !!job.descr;
  const sp = [
    job.job_type,
    job.size_band,
    job.access_type,
    job.materials_by,
    STORE_LABEL[job.materials_store_type ?? ""],
  ].filter(Boolean) as string[];

  return (
    <section className="mt-5 rounded-2xl border border-softline bg-soft p-5">
      <h2 className="text-[10.5px] font-bold uppercase tracking-[.2em] text-tealb">
        What a worker will see
      </h2>
      <p className="mt-2 max-w-[62ch] text-[13.5px] leading-relaxed text-mute">
        Your job, exactly as the public board will show it. It is drawn from
        the same columns a worker reads and from nothing else.
      </p>

      {/* The card itself, in the board's own clothes. */}
      <div className="mt-4 rounded-2xl border border-line bg-panel p-5">
        <div className="flex flex-wrap items-start gap-3">
          <h3 className="min-w-[220px] flex-1 text-[16.5px] font-bold leading-snug">
            {job.title ?? "Job"}
          </h3>
          {job.trade && (
            <span className="rounded-full border border-softline bg-soft px-2.5 py-1 text-[11px] font-bold text-tealb">
              {job.trade}
            </span>
          )}
        </div>

        {tools}

        {sp.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-x-3.5 gap-y-1 text-[12.5px] text-dim">
            {sp.map((x) => (
              <span key={x}>{x}</span>
            ))}
          </div>
        )}

        {/* The WHOLE description, not the first 260 characters. The board's
            own card truncates, and this preview used to truncate with it,
            which is a large part of why nobody noticed what was going out:
            on 6 September 2026 the live board carried a client's email
            address and her full name, and both sat past the cut, so the one
            screen built to show her what was published was the screen that
            hid it. open_jobs returns the whole column to anyone with the
            publishable key, so the truncation was never a control anyway.
            Whatever is below is published. Show all of it. */}
        {descr && (
          <p className="mt-2 whitespace-pre-wrap text-[13.5px] leading-relaxed text-mute">
            {descr}
          </p>
        )}
        {failed && (
          <p className="mt-2 rounded-xl border border-mango/40 bg-mango/10 p-3 text-[13px] leading-relaxed text-mango">
            The preview of your description could not be built just now, so it
            is not shown here rather than shown unchecked. Nothing about your
            job has changed. Try reloading, and tell us if it keeps happening.
          </p>
        )}

        {photos.length > 0 && (
          <>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {photos.slice(0, 3).map((p, i) => (
                <figure
                  key={i}
                  className={
                    "relative h-16 overflow-hidden rounded-lg border bg-linear-to-br from-panel2 to-soft " +
                    (p.board_ok ? "border-softline" : "border-dashed border-line")
                  }
                >
                  {p.img && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={p.img}
                      alt={p.caption}
                      className={"h-full w-full object-cover " + (p.board_ok ? "" : "opacity-40")}
                    />
                  )}
                  <figcaption className="absolute inset-x-0 bottom-0 bg-bg/70 px-1.5 py-0.5 text-[9.5px] leading-tight text-dim">
                    {p.board_ok ? p.caption : "Not on the board"}
                  </figcaption>
                </figure>
              ))}
            </div>
            {photos.some((p) => !p.board_ok) && (
              <p className="mt-2 text-[11.5px] leading-relaxed text-dim">
                The faded ones are private: only you, Yaadly and the booked
                worker see them. Open Photos above and press &quot;Show on
                marketplace&quot; on any you want workers to see. Ones you sent
                on WhatsApp are published by us, when you ask.
              </p>
            )}
          </>
        )}

        <div className="mt-3 flex flex-wrap gap-3.5 border-t border-line pt-3 text-[12.5px] text-dim">
          {job.parish && <b className="font-medium text-mute">{job.parish}</b>}
          {job.urgency && <span>{job.urgency}</span>}
          <span>
            {signed ? "✓ Client guidelines signed" : "Awaiting client signature"}
          </span>
          <span>{job.id}</span>
        </div>
      </div>

      {/* Each line below is a fact about the view, not a promise. The board
          cannot leak an address because it has no address column to leak. */}
      <div className="mt-4">
        <h3 className="text-[10.5px] font-bold uppercase tracking-[.2em] text-tealb">
          What stays off the board
        </h3>
        <ul className="mt-2 grid gap-1.5 text-[13px] leading-relaxed text-mute">
          <li>
            Your address and your phone number. The public board has no
            column for either, and any Address or Access line typed into
            your description is removed before a worker reads it.
            {scrubbed && (
              <b className="text-tealb">
                {" "}
                Your description above has already had that scrub applied.
              </b>
            )}
          </li>
          <li>
            Your name, your email and your phone number, wherever they appear
            in the words themselves, along with anything else shaped like an
            email address or a phone number.
          </li>
          {/* Said out loud rather than left for somebody to discover. The
              scrub removes identifiers; it cannot know that "my cousin Andre
              next door has the key" is an access arrangement, because that is
              a sentence and not a pattern. A client deciding what to publish
              is owed that distinction, and they can act on it: the description
              is theirs to edit, with the tools in this very card. */}
          <li>
            Not everything. If your description names another person, or says
            who holds a key or who is usually home, those words go up as you
            wrote them. Read what is above and edit it if it says more than
            you want strangers to read.
          </li>
          <li>
            Where things are kept on the property. The board carries the
            storage answer a worker needs to price the job, never your
            description of the place.
          </li>
          <li>Any budget. Workers price the work, not your wallet.</li>
        </ul>
      </div>
    </section>
  );
}
