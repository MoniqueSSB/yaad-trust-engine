/**
 * The conversation that started the job, shown back to the person who had it.
 *
 * JobBrief renders what the intake agent made of the message. This is the
 * message. They are different things and both are worth having: the brief is
 * what everybody will be held to, and this is where it came from, so a client
 * reading "Trade: Roofing" can see the sentence that produced it rather than
 * taking it on trust.
 *
 * CLIENT ONLY, and enforced twice.
 *
 * The policy added in 20260829q lets the client of the job read this row and
 * nobody else, so a worker's query returns nothing whatever this component
 * does. The `role` check here is the second line, not the first: the reason
 * is that the transcript carries the access contact's phone number and the
 * address, which open_jobs strips from the board deliberately. A component
 * that renders whatever it is handed would leak both the day somebody passes
 * it worker-side data.
 *
 * Collapsed by default. It is provenance, not the job: useful when a client
 * wants to check something, in the way rather than the rest of the time.
 */

export function IntakeThread({
  transcript,
  channel,
  turns,
  role,
}: {
  transcript: string | null;
  channel: string | null;
  turns: number | null;
  role: "client" | "worker";
}) {
  if (role !== "client") return null;
  const text = (transcript ?? "").trim();
  if (!text) return null;

  const where =
    channel === "whatsapp"
      ? "on WhatsApp"
      : channel === "email"
        ? "by email"
        : channel
          ? "on " + channel
          : "when you got in touch";

  return (
    <section className="mt-6 rounded-2xl border border-line bg-panel p-5">
      <h2 className="mb-2 text-[10.5px] font-bold uppercase tracking-[.2em] text-tealb">
        How this job started
      </h2>
      <p className="max-w-[62ch] text-[13px] leading-relaxed text-mute">
        The brief above is what we made of your message. This is the message,
        {" "}{where}
        {turns ? ", over " + turns + (turns === 1 ? " exchange" : " exchanges") : ""}.
        Nothing here is on the marketplace: the board never carries your
        address or anybody&rsquo;s phone number.
      </p>
      <details className="mt-3">
        <summary className="cursor-pointer list-none text-[12.5px] font-bold text-tealb underline-offset-2 hover:underline">
          Read the conversation
        </summary>
        <pre className="mt-3 max-h-[420px] overflow-auto whitespace-pre-wrap rounded-xl border border-line bg-bg p-4 font-body text-[13px] leading-relaxed text-mute">
          {text}
        </pre>
        <p className="mt-2 text-[11.5px] leading-relaxed text-dim">
          Only you can see this. The tradesperson quoting sees the brief and
          the photos, never this thread.
        </p>
      </details>
    </section>
  );
}
