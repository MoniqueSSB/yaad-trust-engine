import {
  requestWalkthrough,
  confirmWalkthrough,
  clearWalkthrough,
  recordWalkthroughNotes,
  confirmWalkthroughNotes,
} from "@/app/portal/walkthrough-actions";

/**
 * The video walkthrough, PORTAL-SPEC's own FAQ copy given a real path: "At
 * sign-off you can approve from the evidence package, or book a live video
 * walkthrough... whichever suits you." This is the "or": entirely
 * additional to the Approve button, never a gate on it.
 *
 * Three states, read straight off the job row rather than tracked
 * separately: nothing requested (walk_platform null), requested and waiting
 * on the worker (walk_platform set, walk_link null), confirmed (walk_link
 * set). Server component: every action here is a real Postgres function and
 * the whole panel re-renders from the row it wrote.
 */

const PLATFORM_LABEL: Record<string, string> = {
  whatsapp: "WhatsApp video",
  google_meet: "Google Meet",
  zoom: "Zoom",
};

export function WalkthroughPanel({
  jobId,
  role,
  walkPlatform,
  walkLink,
  walkDate,
  walkWho,
  walkNotes,
  walkCallNotes,
  walkNotesConfirmedAt,
}: {
  jobId: string;
  role: "client" | "worker";
  walkPlatform: string | null;
  walkLink: string | null;
  walkDate: string | null;
  walkWho: string | null;
  walkNotes: string | null;
  walkCallNotes: string | null;
  walkNotesConfirmedAt: string | null;
}) {
  const requested = !!walkPlatform;
  const confirmed = requested && !!walkLink;
  const notesConfirmed = !!walkNotesConfirmedAt;

  return (
    <section id="walkthrough" className="mt-4 rounded-2xl border border-line bg-panel p-4">
      <p className="text-[10.5px] font-bold uppercase tracking-[.2em] text-tealb">Video walkthrough</p>
      <p className="mt-1 text-[12px] leading-relaxed text-dim">
        {role === "client"
          ? "An alternative to approving straight off the evidence: the worker walks the site with you live, on WhatsApp video, Google Meet or Zoom, whichever suits you. This does not hold up the Approve button; use either."
          : "The client can ask to walk the site with you live instead of approving straight off the evidence. Nothing here changes what you owe on the evidence itself."}
      </p>

      {!requested && role === "client" && (
        <form action={requestWalkthrough} className="mt-3 grid gap-2.5 sm:grid-cols-[160px_1fr_auto]">
          <input type="hidden" name="jobId" value={jobId} />
          <select
            name="platform"
            required
            defaultValue=""
            className="rounded-xl border border-line bg-bg px-3 py-2.5 text-[13px] text-ink outline-none focus:border-teal"
          >
            <option value="" disabled>Platform</option>
            <option value="whatsapp">WhatsApp video</option>
            <option value="google_meet">Google Meet</option>
            <option value="zoom">Zoom</option>
          </select>
          <input
            name="date"
            placeholder='Preferred day and time, e.g. "Thursday afternoon"'
            maxLength={80}
            className="rounded-xl border border-line bg-bg px-3.5 py-2.5 text-[13px] text-ink outline-none focus:border-teal"
          />
          <button className="rounded-full bg-linear-to-r from-teal to-mango px-4 py-2.5 text-[13px] font-bold text-[#04211D]">
            Request
          </button>
          <textarea
            name="notes"
            rows={2}
            maxLength={400}
            placeholder="What you want walked through, optional"
            className="sm:col-span-3 rounded-xl border border-line bg-bg px-3.5 py-2.5 text-[13px] text-ink outline-none focus:border-teal"
          />
        </form>
      )}

      {!requested && role === "worker" && (
        <p className="mt-3 text-[12.5px] text-dim">Nothing requested yet.</p>
      )}

      {requested && !confirmed && (
        <div className="mt-3 rounded-xl border border-coral/30 bg-coral/10 px-3.5 py-3">
          <p className="text-[13px] text-mute">
            <b className="text-ink">Requested:</b> {PLATFORM_LABEL[walkPlatform!] ?? walkPlatform}
            {walkDate ? ", " + walkDate : ""}.{" "}
            {role === "client" ? "Waiting for the worker to confirm a link." : "Send a link once you have arranged it."}
          </p>
          {walkNotes && role === "worker" && (
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-dim">&ldquo;{walkNotes}&rdquo;</p>
          )}
          {role === "worker" && (
            <form action={confirmWalkthrough} className="mt-2.5 grid gap-2 sm:grid-cols-2">
              <input type="hidden" name="jobId" value={jobId} />
              <input
                name="link"
                required
                placeholder="Paste the call link"
                className="sm:col-span-2 rounded-xl border border-line bg-bg px-3.5 py-2.5 text-[13px] text-ink outline-none focus:border-teal"
              />
              <input
                name="who"
                placeholder="Who is on the call, optional"
                maxLength={140}
                className="rounded-xl border border-line bg-bg px-3.5 py-2.5 text-[13px] text-ink outline-none focus:border-teal"
              />
              <button className="rounded-full bg-linear-to-r from-teal to-mango px-4 py-2.5 text-[13px] font-bold text-[#04211D]">
                Confirm the call
              </button>
            </form>
          )}
        </div>
      )}

      {confirmed && (
        <div className="mt-3 rounded-xl border border-softline bg-soft px-3.5 py-3">
          <p className="text-[13px] text-mute">
            <b className="text-tealb">Confirmed:</b> {PLATFORM_LABEL[walkPlatform!] ?? walkPlatform}
            {walkDate ? ", " + walkDate : ""}
            {walkWho ? " · " + walkWho : ""}
          </p>
          <a
            href={walkLink!}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-block rounded-full bg-linear-to-r from-teal to-mango px-4 py-2 text-[12.5px] font-bold text-[#04211D]"
          >
            Join the call &rarr;
          </a>
          {walkNotes && (
            <p className="mt-2 text-[12.5px] leading-relaxed text-dim">&ldquo;{walkNotes}&rdquo;</p>
          )}

          {/* The other half of the FAQ's sentence: "the notes are recorded,
              you confirm them, and both land on your Completion Report."
              Worker writes, client confirms, editing after confirmation
              re-opens it, same rule as a fresh request outdating an old
              link. */}
          <div className="mt-3 border-t border-line pt-3">
            <p className="text-[10.5px] font-bold uppercase tracking-[.18em] text-mango">Notes from the call</p>
            {!walkCallNotes && role === "worker" && (
              <form action={recordWalkthroughNotes} className="mt-2">
                <input type="hidden" name="jobId" value={jobId} />
                <textarea
                  name="notes"
                  required
                  rows={3}
                  maxLength={2000}
                  placeholder="What you found and raised on the call"
                  className="w-full rounded-xl border border-line bg-bg px-3.5 py-2.5 text-[13px] text-ink outline-none focus:border-teal"
                />
                <button className="mt-2 rounded-full bg-linear-to-r from-teal to-mango px-4 py-2 text-[12.5px] font-bold text-[#04211D]">
                  Save notes
                </button>
              </form>
            )}
            {!walkCallNotes && role === "client" && (
              <p className="mt-1.5 text-[12.5px] text-dim">Waiting on the worker to write these up.</p>
            )}
            {walkCallNotes && (
              <>
                <p className="mt-1.5 whitespace-pre-wrap text-[12.5px] leading-relaxed text-mute">{walkCallNotes}</p>
                <p className={"mt-1.5 text-[11px] font-bold uppercase tracking-wide " + (notesConfirmed ? "text-tealb" : "text-coral")}>
                  {notesConfirmed ? "Confirmed by the client" : "Waiting on the client to confirm"}
                </p>
                {!notesConfirmed && role === "client" && (
                  <form action={confirmWalkthroughNotes} className="mt-2">
                    <input type="hidden" name="jobId" value={jobId} />
                    <button className="rounded-full bg-linear-to-r from-teal to-mango px-4 py-2 text-[12.5px] font-bold text-[#04211D]">
                      Confirm these notes
                    </button>
                  </form>
                )}
                {role === "worker" && (
                  <form action={recordWalkthroughNotes} className="mt-2.5">
                    <input type="hidden" name="jobId" value={jobId} />
                    <textarea
                      name="notes"
                      required
                      rows={3}
                      maxLength={2000}
                      defaultValue={walkCallNotes}
                      className="w-full rounded-xl border border-line bg-bg px-3.5 py-2.5 text-[13px] text-ink outline-none focus:border-teal"
                    />
                    <button className="mt-2 rounded-full border border-line2 px-4 py-2 text-[12.5px] font-bold text-ink">
                      {notesConfirmed ? "Edit (re-opens confirmation)" : "Save changes"}
                    </button>
                  </form>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {requested && (
        <form action={clearWalkthrough} className="mt-2.5">
          <input type="hidden" name="jobId" value={jobId} />
          <button className="text-[11.5px] text-dim underline-offset-2 hover:underline hover:text-coral">
            Cancel this {confirmed ? "call" : "request"}
          </button>
        </form>
      )}
    </section>
  );
}
