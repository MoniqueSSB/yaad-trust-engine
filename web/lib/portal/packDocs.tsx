/**
 * The Kickoff Pack, one document at a time. Split out of a single
 * long-scroll page (31 Aug 2026, founder instruction: "it shouldn't just be
 * one big massive page of information") into ten addressable stops, same
 * shape the concierge desk's KICK_DOCS list already uses, so the admin view
 * and the client view name the same nine things the same way.
 *
 * human_review_notes is deliberately left out of PACK_DOC_ORDER. Its own
 * schema description is "specific things the project manager must
 * personally verify or correct before issuing this to the client" - it is
 * Monique's checklist against her own draft, not something a client should
 * ever read. The concierge desk shows it; this list does not.
 */
import type { ReactNode } from "react";

export type Dict = Record<string, unknown>;
export const S = (v: unknown) => (typeof v === "string" ? v : "");
export const L = (v: unknown): Dict[] => (Array.isArray(v) ? (v as Dict[]) : []);

export const PACK_DOC_ORDER: { slug: string; title: string }[] = [
  { slug: "cover", title: "Cover note" },
  { slug: "scope", title: "Works scope" },
  { slug: "timeline", title: "Timeline" },
  { slug: "payment", title: "Payment stages" },
  { slug: "evidence", title: "Evidence checklist" },
  { slug: "documents", title: "Document pack" },
  { slug: "risks", title: "Risk register" },
  { slug: "comms", title: "Who to call" },
  { slug: "questions", title: "Open questions" },
];

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mt-4">
      <b className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-ink">
        {label}
      </b>
      <div className="text-[13px] leading-relaxed text-mute">{children}</div>
    </div>
  );
}

/** Whether a document has anything worth a page, for the index's ticks. */
export function packDocHasContent(slug: string, d: Dict): boolean {
  switch (slug) {
    case "cover": return S(d.cover_note).trim().length > 0;
    case "scope": return S((d.scope_of_works as Dict)?.summary).trim().length > 0;
    case "timeline": return L((d.timeline as Dict)?.phases).length > 0;
    case "payment": return L((d.payment_schedule as Dict)?.stages).length > 0;
    case "evidence": return L(d.evidence_checklist).length > 0;
    case "documents": return L(d.document_pack).length > 0;
    case "risks": return L(d.risk_register).length > 0;
    case "comms": return L(d.communications_list).length > 0;
    case "questions": return L(d.open_questions).length > 0;
    default: return false;
  }
}

/** One document, rendered on its own page. */
export function renderPackDoc(slug: string, d: Dict): ReactNode {
  if (slug === "cover") {
    const note = S(d.cover_note);
    return note ? <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-ink">{note}</p>
      : <p className="text-mute">Nothing drafted yet.</p>;
  }

  if (slug === "scope") {
    const scope = (d.scope_of_works ?? {}) as Dict;
    return (
      <>
        {S(scope.summary) && <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-ink">{S(scope.summary)}</p>}
        {L(scope.included).length > 0 && (
          <Field label="Included">
            <ul className="ml-4 list-disc">{L(scope.included).map((x, i) => <li key={i}>{S(x) || S((x as Dict).item) || JSON.stringify(x)}</li>)}</ul>
          </Field>
        )}
        {L(scope.excluded).length > 0 && (
          <Field label="Not included">
            <ul className="ml-4 list-disc text-coral">{L(scope.excluded).map((x, i) => <li key={i}>{S(x) || S((x as Dict).item) || JSON.stringify(x)}</li>)}</ul>
          </Field>
        )}
        {L(scope.assumptions).length > 0 && (
          <Field label="Assumptions"><ul className="ml-4 list-disc">{L(scope.assumptions).map((x, i) => <li key={i}>{S(x)}</li>)}</ul></Field>
        )}
        {L(scope.acceptance_criteria).length > 0 && (
          <Field label="How you will know it is done"><ul className="ml-4 list-disc">{L(scope.acceptance_criteria).map((x, i) => <li key={i}>{S(x)}</li>)}</ul></Field>
        )}
      </>
    );
  }

  if (slug === "timeline") {
    const tl = (d.timeline ?? {}) as Dict;
    const phases = L(tl.phases);
    return (
      <>
        {S(tl.basis) && <p className="text-[14px] leading-relaxed text-ink">{S(tl.basis)}</p>}
        {phases.length > 0 && (
          <ul className="mt-4 grid gap-2.5">
            {phases.map((p, i) => (
              <li key={i} className="rounded-xl border border-line bg-bg px-3.5 py-3">
                <b className="text-ink">{S(p.name)}</b>{S(p.duration) ? ` · ${S(p.duration)}` : ""}
                {S(p.depends_on) && <span className="block text-[12px] text-dim">Depends on: {S(p.depends_on)}</span>}
                {S(p.milestone) && <span className="block text-[12px] text-dim">{S(p.milestone)}</span>}
              </li>
            ))}
          </ul>
        )}
      </>
    );
  }

  if (slug === "payment") {
    const pay = (d.payment_schedule ?? {}) as Dict;
    const stages = L(pay.stages);
    return (
      <>
        {S(pay.note) && <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-ink">{S(pay.note)}</p>}
        {stages.length > 0 && (
          <ul className="mt-4 grid gap-2.5">
            {stages.map((st, i) => (
              <li key={i} className="rounded-xl border border-line bg-bg px-3.5 py-3">
                <div className="flex flex-wrap items-baseline gap-2">
                  <b className="text-ink">{S(st.stage) || `Stage ${i + 1}`}</b>
                  {st.proportion_percent != null && <span className="text-tealb font-bold">{String(st.proportion_percent)}%</span>}
                </div>
                {S(st.release_condition) && <p className="mt-1 text-[12.5px] text-dim">{S(st.release_condition)}</p>}
                {L(st.evidence_required).length > 0 && (
                  <ul className="mt-1.5 ml-4 list-disc text-[12.5px] text-dim">
                    {L(st.evidence_required).map((x, j) => <li key={j}>{S(x)}</li>)}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </>
    );
  }

  if (slug === "evidence") {
    const stages = L(d.evidence_checklist);
    return (
      <ul className="grid gap-3">
        {stages.map((st, i) => (
          <li key={i} className="rounded-xl border border-line bg-bg px-3.5 py-3">
            <b className="block text-ink">{S(st.stage) || `Stage ${i + 1}`}</b>
            <ul className="mt-1.5 ml-4 list-disc text-[13px] text-mute">
              {L(st.items).map((it, j) => (
                <li key={j}>{S((it as Dict).item) || S(it)}{(it as Dict).why ? ` — ${S((it as Dict).why)}` : ""}</li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    );
  }

  if (slug === "documents") {
    const items = L(d.document_pack);
    return (
      <ul className="grid gap-2.5">
        {items.map((x, i) => (
          <li key={i} className="rounded-xl border border-line bg-bg px-3.5 py-3">
            <b className="text-ink">{S(x.document)}</b>
            <span className="ml-2 text-[12px] text-dim">provided by {S(x.who_provides) || "not stated"}</span>
            {S(x.why) && <p className="mt-1 text-[12.5px] text-mute">{S(x.why)}</p>}
            {S(x.risk_if_missing) && <p className="mt-1 text-[12px] text-coral">If missing: {S(x.risk_if_missing)}</p>}
          </li>
        ))}
      </ul>
    );
  }

  if (slug === "risks") {
    const items = L(d.risk_register);
    return (
      <ul className="grid gap-2.5">
        {items.map((r, i) => (
          <li key={i} className="rounded-xl border border-line bg-bg px-3.5 py-3">
            <b className="text-ink">{S(r.risk)}</b>
            <span className="ml-2 text-[11px] uppercase tracking-wide text-dim">{S(r.category)}</span>
            {S(r.mitigation) && <p className="mt-1 text-[12.5px] text-mute">{S(r.mitigation)}</p>}
            {S(r.owner) && <p className="mt-1 text-[12px] text-dim">Owner: {S(r.owner)}</p>}
          </li>
        ))}
      </ul>
    );
  }

  if (slug === "comms") {
    const items = L(d.communications_list);
    return (
      <ul className="grid gap-2">
        {items.map((c, i) => (
          <li key={i} className="rounded-xl border border-line bg-bg px-3.5 py-3">
            <b className="text-ink">{S(c.role)}</b> · {S(c.who) || "TBC"}
            {S(c.responsibility) && <p className="mt-1 text-[12.5px] text-mute">{S(c.responsibility)}</p>}
            <p className="mt-1 text-[12px] text-dim">{S(c.contact_method)}{S(c.update_cadence) ? ` · ${S(c.update_cadence)}` : ""}</p>
          </li>
        ))}
      </ul>
    );
  }

  if (slug === "questions") {
    const items = L(d.open_questions).length ? L(d.open_questions) : (Array.isArray(d.open_questions) ? d.open_questions as unknown[] : []);
    return (
      <ol className="grid list-decimal gap-2 pl-5 text-[13.5px] leading-relaxed text-ink">
        {(items as unknown[]).map((q, i) => <li key={i}>{typeof q === "string" ? q : JSON.stringify(q)}</li>)}
      </ol>
    );
  }

  return <p className="text-mute">Nothing drafted yet.</p>;
}
