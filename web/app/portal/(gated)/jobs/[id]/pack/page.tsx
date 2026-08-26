import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * The Kickoff Pack as a rendered document, from the real kickoff_packs row
 * (shape read off production, not assumed): cover_note, scope_of_works,
 * payment_schedule, evidence_checklist, timeline, risk_register,
 * communications_list, document_pack, open_questions. Only approved packs
 * are readable by the parties; drafts stay internal.
 */

type Dict = Record<string, unknown>;
const S = (v: unknown) => (typeof v === "string" ? v : "");
const L = (v: unknown): Dict[] => (Array.isArray(v) ? (v as Dict[]) : []);

function Sec({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="mt-5 border-t border-softline pt-4">
      <h2 className="mb-2 flex items-center gap-2.5 text-[14px] font-bold text-ink">
        <span className="grid size-6 place-items-center rounded-[7px] border border-softline bg-soft font-mono text-[11px] text-tealb">{n}</span>
        {title}
      </h2>
      <div className="text-[13px] leading-relaxed text-mute">{children}</div>
    </section>
  );
}

export default async function Pack({ params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) redirect("/portal/sign-in");
  const { id } = await params;
  const supabase = await createClient();
  const { data: pack } = await supabase
    .from("kickoff_packs")
    .select("id,project_title,client_name,parish,status,rev,updated_at,docs,approved_by,approved_at")
    .eq("job_id", id)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!pack) notFound();

  const d = (pack.docs ?? {}) as Dict;
  const scope = (d.scope_of_works ?? {}) as Dict;
  const pay = (d.payment_schedule ?? {}) as Dict;
  const timeline = (d.timeline ?? {}) as Dict;

  return (
    <div className="rounded-2xl border border-line bg-panel p-6">
      <Link href={"/portal/jobs/" + encodeURIComponent(id)} className="text-[13px] text-tealb underline-offset-2 hover:underline">&larr; Back to the job</Link>
      <div className="mt-3 border-b-2 border-teal pb-4">
        <h1 className="font-display text-[clamp(22px,3.5vw,30px)] uppercase leading-tight">Kickoff Pack</h1>
        <p className="mt-1 text-[12px] text-dim">
          {pack.id} · rev {pack.rev ?? 1} · {pack.project_title}
          {pack.parish ? " · " + pack.parish : ""} ·{" "}
          {pack.status === "approved" ? "Approved for issue" : pack.status}
        </p>
      </div>

      {S(d.cover_note) && <Sec n={1} title="Cover note"><p className="whitespace-pre-wrap">{S(d.cover_note)}</p></Sec>}

      <Sec n={2} title="What is being done, and what is not">
        {S(scope.summary) && <p className="whitespace-pre-wrap">{S(scope.summary)}</p>}
        {L(scope.included).length > 0 && (<><b className="mt-2.5 block text-ink">Included</b><ul className="ml-4 list-disc">{L(scope.included).map((x, i) => <li key={i}>{S(x) || S((x as Dict).item) || JSON.stringify(x)}</li>)}</ul></>)}
        {L(scope.excluded).length > 0 && (<><b className="mt-2.5 block text-coral">Not included</b><ul className="ml-4 list-disc">{L(scope.excluded).map((x, i) => <li key={i}>{S(x) || S((x as Dict).item) || JSON.stringify(x)}</li>)}</ul></>)}
        {L(scope.assumptions).length > 0 && (<><b className="mt-2.5 block text-ink">Assumptions</b><ul className="ml-4 list-disc">{L(scope.assumptions).map((x, i) => <li key={i}>{S(x)}</li>)}</ul></>)}
      </Sec>

      {L(pay.stages).length > 0 && (
        <Sec n={3} title="The money, stage by stage">
          {S(pay.note) && <p className="mb-2">{S(pay.note)}</p>}
          <ul className="grid gap-2">
            {L(pay.stages).map((st, i) => (
              <li key={i} className="rounded-xl border border-line bg-bg px-3.5 py-2.5">
                <b className="text-ink">{S(st.name) || S(st.stage) || `Stage ${i + 1}`}</b>
                {" "}{S(st.percent) || S(st.pct) ? `· ${S(st.percent) || S(st.pct)}` : ""}
                {S(st.trigger) || S(st.release_condition) ? <span className="block text-[12px] text-dim">Releases on: {S(st.trigger) || S(st.release_condition)}</span> : null}
              </li>
            ))}
          </ul>
        </Sec>
      )}

      {L(d.evidence_checklist).length > 0 && (
        <Sec n={4} title="Evidence required">
          <ul className="grid gap-2">
            {L(d.evidence_checklist).map((st, i) => (
              <li key={i}><b className="text-ink">{S(st.stage) || `Stage ${i + 1}`}:</b> {L(st.items).map((x) => S(x)).filter(Boolean).join(" · ") || S(st.items)}</li>
            ))}
          </ul>
        </Sec>
      )}

      {L(timeline.phases).length > 0 && (
        <Sec n={5} title="Programme">
          {S(timeline.basis) && <p className="mb-2">{S(timeline.basis)}</p>}
          <ul className="grid gap-2">
            {L(timeline.phases).map((ph, i) => (
              <li key={i} className="rounded-xl border border-line bg-bg px-3.5 py-2.5">
                <b className="text-ink">{S(ph.name)}</b> · {S(ph.duration)}
                {S(ph.milestone) && <span className="block text-[12px] text-dim">{S(ph.milestone)}</span>}
              </li>
            ))}
          </ul>
        </Sec>
      )}

      {L(d.risk_register).length > 0 && (
        <Sec n={6} title="Risk register">
          <ul className="grid gap-1.5">
            {L(d.risk_register).map((r, i) => (
              <li key={i}><b className="text-ink">{S(r.risk)}</b>{S(r.mitigation) ? ` · ${S(r.mitigation)}` : ""}</li>
            ))}
          </ul>
        </Sec>
      )}

      {L(d.communications_list).length > 0 && (
        <Sec n={7} title="Who talks to whom">
          <ul className="grid gap-1.5">
            {L(d.communications_list).map((c, i) => (
              <li key={i}><b className="text-ink">{S(c.who)}</b> · {S(c.role)} · {S(c.update_cadence)}</li>
            ))}
          </ul>
        </Sec>
      )}

      <p className="mt-5 border-t border-line pt-3.5 text-[11.5px] leading-relaxed text-dim">
        Prepared from the written intake. It is not a survey, a valuation, a
        quantity surveyor&apos;s estimate or legal advice, and it contains no
        prices set by Yaadly. A change after issue creates a new revision and
        both sides re-sign; earlier revisions stay readable forever.
      </p>
    </div>
  );
}
