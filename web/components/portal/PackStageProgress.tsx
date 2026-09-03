import Link from "next/link";
import { jmd } from "@/lib/money";

/**
 * The current stage, read straight from the approved Kickoff Pack rather
 * than a generic label: what it is called, what proportion of the labour
 * price releases on it, what evidence proves it, and the programme it sits
 * inside. Renders nothing for a job with no pack stage to show, which is
 * exactly the state every job was in before the pack could be approved.
 */



type Phase = { name?: string; duration?: string; milestone?: string };

export function PackStageProgress({
  stage,
  amountDue,
  timelinePhases,
  packHref,
}: {
  stage: {
    stage: string;
    proportion_percent?: number;
    release_condition?: string;
    evidence_required?: string[];
  } | null;
  amountDue: number | null;
  timelinePhases: Phase[];
  packHref: string;
}) {
  if (!stage) return null;

  return (
    <section className="mt-4 rounded-2xl border border-line bg-panel p-5">
      <h2 className="mb-3 text-[10.5px] font-bold uppercase tracking-[.2em] text-tealb">
        This stage, from your Kickoff Pack
      </h2>
      <p className="text-[15px] font-bold text-ink">{stage.stage}</p>
      <div className="mt-1 flex flex-wrap items-center gap-3 text-[12.5px] text-dim">
        {stage.proportion_percent != null && (
          <span>{stage.proportion_percent}% of the labour price</span>
        )}
        {amountDue != null && (
          <span className="font-bold text-tealb">
            {jmd(amountDue)} releases on approval
          </span>
        )}
      </div>

      {stage.release_condition && (
        <p className="mt-3 text-[13px] leading-relaxed text-mute">
          {stage.release_condition}
        </p>
      )}

      {stage.evidence_required && stage.evidence_required.length > 0 && (
        <>
          <b className="mt-3.5 block text-[11px] font-bold uppercase tracking-wide text-ink">
            Evidence required
          </b>
          <ul className="mt-1.5 ml-4 list-disc text-[13px] leading-relaxed text-mute">
            {stage.evidence_required.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
        </>
      )}

      {timelinePhases.length > 0 && (
        <>
          <b className="mt-4 block text-[11px] font-bold uppercase tracking-wide text-ink">
            Programme
          </b>
          <ul className="mt-1.5 grid gap-1.5">
            {timelinePhases.map((p, i) => (
              <li key={i} className="text-[12.5px] text-mute">
                <span className="font-bold text-ink">{p.name}</span>
                {p.duration ? ` · ${p.duration}` : ""}
                {p.milestone && (
                  <span className="block text-[11.5px] text-dim">
                    {p.milestone}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      <p className="mt-3.5 text-[11.5px] text-dim">
        From the Kickoff Pack Yaadly approved when you chose your worker.{" "}
        <Link
          href={packHref}
          className="text-tealb underline-offset-2 hover:underline"
        >
          Read the whole pack
        </Link>
        .
      </p>
    </section>
  );
}
