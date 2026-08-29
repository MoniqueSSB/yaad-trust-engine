import { parseBrief } from "@/lib/portal/job-brief";

/**
 * The job card, as the intake agent actually wrote it.
 *
 * The agent already does this work. It reads a WhatsApp voice note or a
 * forwarded email and returns a structured card: scope, trade, parish,
 * urgency, access, and the questions worth asking before anybody quotes. Then
 * yaad-inbound and yaad-whatsapp-webhook join all of it into one text column
 * and the portal printed that column raw, so the structure the agent produced
 * was thrown away at the last step and the reader got a wall.
 *
 * Worse, that wall carried lines meant for the desk. A real job on the live
 * site was showing its client, and the tradesperson, this:
 *
 *   [No email yet. Reply on the same channel to get one, so they can see
 *    this in the client portal.]
 *
 * That is an instruction to Yaadly, not information for either party, and it
 * reads as though the job is broken. Square bracketed lines are desk notes by
 * convention in both intake functions, and they stop here.
 *
 * This parses rather than reads columns, which is a presentation-layer patch
 * over a data-model problem: the structured card should be persisted as JSON
 * at intake and read back, instead of being flattened and reconstructed. That
 * is the right fix and it is worth doing. This one earns its place in the
 * meantime because it needs no migration and no intake redeploy, and it works
 * on every job already in the database, which a new column would not.
 *
 * The prefixes below are exactly the ones the two intake functions write.
 */

const chip =
  "rounded-full border border-softline bg-soft px-3 py-1 text-[11.5px] font-bold text-tealb";

export function JobBrief({
  descr,
  trade,
  parish,
}: {
  descr: string;
  trade?: string | null;
  parish?: string | null;
}) {
  const { scope, sections } = parseBrief(descr);

  // Semicolons are how yaad-inbound joins them; the WhatsApp path writes one
  // per line. Both end up as a list rather than a paragraph, because these are
  // the things somebody has to answer, not prose to skim.
  const questions = sections.questions
    ? sections.questions
        .split(/;|\n/)
        .map((q) => q.trim())
        .filter(Boolean)
    : [];

  const facts = [
    trade,
    parish,
    sections.urgency,
    sections.wanted && `Wanted by ${sections.wanted}`,
  ].filter(Boolean) as string[];

  return (
    <div className="mt-6 rounded-2xl border border-line bg-panel p-5">
      <h2 className="mb-3 text-[10.5px] font-bold uppercase tracking-[.2em] text-tealb">
        The job, as agreed
      </h2>

      {scope && (
        <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-ink">
          {scope}
        </p>
      )}

      {facts.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {facts.map((f) => (
            <span key={f} className={chip}>
              {f}
            </span>
          ))}
        </div>
      )}

      {sections.access && (
        <div className="mt-5">
          <h3 className="mb-1.5 text-[10.5px] font-bold uppercase tracking-[.2em] text-mango">
            Getting in
          </h3>
          <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-mute">
            {sections.access}
          </p>
        </div>
      )}

      {questions.length > 0 && (
        <div className="mt-5">
          <h3 className="mb-1.5 text-[10.5px] font-bold uppercase tracking-[.2em] text-mango">
            Worth settling before anybody quotes
          </h3>
          <ul className="grid gap-1.5">
            {questions.map((q) => (
              <li
                key={q}
                className="text-[13.5px] leading-relaxed text-mute before:mr-2 before:text-tealb before:content-['·']"
              >
                {q}
              </li>
            ))}
          </ul>
        </div>
      )}

      {sections.verbatim && (
        <details className="mt-5 rounded-xl border border-softline bg-soft px-3.5 py-3">
          <summary className="cursor-pointer text-[12.5px] font-bold text-tealb">
            In their own words
          </summary>
          <p className="mt-2.5 whitespace-pre-wrap text-[13px] leading-relaxed text-mute">
            {sections.verbatim}
          </p>
          {/*
            Folded, not dropped. The summary above is a model's reading of what
            somebody said, and anybody about to price the work is entitled to
            check it against the words themselves.
          */}
        </details>
      )}

      {(sections.arrival || sections.source) && (
        <p className="mt-4 text-[12px] leading-relaxed text-dim">
          {[sections.arrival && `Arrived by ${sections.arrival}`, sections.source]
            .filter(Boolean)
            .join(" ")}
        </p>
      )}
    </div>
  );
}
