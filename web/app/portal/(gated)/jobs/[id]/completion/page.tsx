import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import legal from "@/lib/legal-copy.json";
import { PrintReport } from "@/components/portal/PrintReport";

export const dynamic = "force-dynamic";

/**
 * The Completion Report, assembled from the job's own record: the agreed
 * description, the evidence index with its fingerprints, and the
 * confirmations that exist. Section 6 is legally load-bearing and is the
 * decided text, verbatim. Renders only once the job is complete: a report
 * for unfinished work would be fiction.
 */

/* Its own title, so two job tabs are two different words in the tab strip.
   The id rather than the job's name because it is already on the page, it is
   what the client quotes when they message, and reading it costs no query. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return { title: `Completion · ${id} · Yaadly` };
}

export default async function Completion({ params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) redirect("/portal/sign-in");
  const { id } = await params;
  const supabase = await createClient();

  const { data: job } = await supabase
    .from("jobs")
    .select(
      "id,title,trade,parish,descr,status,worker_name,updated_at,walk_platform,walk_date,walk_who,walk_call_notes,walk_notes_confirmed_at",
    )
    .eq("id", id).maybeSingle();
  if (!job || job.status !== "complete") notFound();

  const { data: evidence } = await supabase
    .from("evidence")
    .select("label,created_at,sha256,stage,ok,phase")
    .eq("job_id", id).order("created_at");

  const { data: approvals } = await supabase
    .from("stage_approvals")
    .select("stage,approved_by,approved_at,confirmed_method")
    .eq("job_id", id).order("stage");

  const ev = evidence ?? [];
  const stageApprovals = approvals ?? [];

  // Sections after the fixed first two are conditional on what actually
  // happened on this job, so the numbering counts up rather than being
  // hardcoded per section: adding or skipping one never leaves a report
  // that reads "3 · ... 5 · ..." with no 4.
  let sectionNo = 2;
  const nextSection = () => ++sectionNo;

  return (
    <div className="rounded-2xl border border-line bg-panel p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={"/portal/jobs/" + encodeURIComponent(id)} className="text-[13px] text-tealb underline-offset-2 hover:underline">&larr; Back to the job</Link>
        <PrintReport />
      </div>
      <div className="mt-3 border-b-2 border-teal pb-4">
        <h1 className="font-display text-[clamp(22px,3.5vw,30px)] uppercase leading-tight">Completion Report</h1>
        <p className="mt-1 text-[12px] text-dim">{job.id} · {job.trade ?? ""} {job.parish ? "· " + job.parish : ""} · closed {String(job.updated_at).slice(0, 10)}</p>
      </div>

      <section className="mt-5">
        <h2 className="mb-1.5 text-[14px] font-bold text-ink">1 · What was done</h2>
        <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-mute">{job.descr}</p>
        {job.worker_name && <p className="mt-1.5 text-[12.5px] text-dim">Carried out by {job.worker_name}.</p>}
      </section>

      <section className="mt-5">
        <h2 className="mb-1.5 text-[14px] font-bold text-ink">2 · Evidence index · {ev.length} items</h2>
        <p className="mb-2.5 text-[12.5px] text-dim">
          Every file, when it was filed, and its fingerprint. Change one pixel
          and it stops matching.
        </p>
        <ul className="grid gap-1.5">
          {ev.map((e, i) => (
            <li key={i} className="rounded-xl border border-line bg-bg px-3.5 py-2.5 text-[12.5px] text-mute">
              <b className="text-ink">{e.label}</b>
              {/* The worker's own declaration of which half of the pair this
                  is, printed on the record the client keeps. Absent on items
                  filed before 5 Sep 2026 and on anything nobody marked, which
                  is the honest reading: not marked, rather than not a before. */}
              {(e.phase === "before" || e.phase === "after") && (
                <span className="text-ink"> · the {e.phase}</span>
              )}
              {e.stage != null && <span> · Stage {e.stage}</span>}
              <span> · {String(e.created_at).slice(0, 16).replace("T", " ")}</span>
              {e.sha256 && <span className="mt-1 block break-all font-mono text-[9px] text-dim">sha256 · {e.sha256}</span>}
            </li>
          ))}
        </ul>
      </section>

      {/* How each stage was actually confirmed: reviewing the evidence
          remotely, or standing on the property and looking at it. A
          stronger record than a bare approval, and the whole reason
          confirmed_method exists (31 Aug 2026). */}
      {stageApprovals.length > 0 && (
        <section className="mt-5">
          <h2 className="mb-1.5 text-[14px] font-bold text-ink">{nextSection()} · How each stage was confirmed</h2>
          <ul className="grid gap-1.5">
            {stageApprovals.map((a, i) => (
              <li key={i} className="rounded-xl border border-line bg-bg px-3.5 py-2.5 text-[12.5px] text-mute">
                <b className="text-ink">Stage {a.stage}</b> · {a.confirmed_method === "in_person" ? "confirmed in person" : "confirmed from the evidence"}
                <span> · {String(a.approved_at).slice(0, 16).replace("T", " ")}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Only the confirmed loop counts. An unconfirmed set of notes, or a
          walkthrough requested but never followed through, is not a record
          either side has agreed to, and a report is not the place to show
          something nobody signed off on. */}
      {job.walk_notes_confirmed_at && (
        <section className="mt-5">
          <h2 className="mb-1.5 text-[14px] font-bold text-ink">{nextSection()} · Video walkthrough</h2>
          <p className="mb-2 text-[12.5px] text-dim">
            {job.walk_platform ?? "A call"}{job.walk_date ? ", " + job.walk_date : ""}
            {job.walk_who ? " · " + job.walk_who : ""}
          </p>
          <p className="whitespace-pre-wrap rounded-xl border border-line bg-bg px-3.5 py-2.5 text-[13px] leading-relaxed text-mute">
            {job.walk_call_notes}
          </p>
          <p className="mt-1.5 text-[11px] text-dim">
            Confirmed {String(job.walk_notes_confirmed_at).slice(0, 16).replace("T", " ")}
          </p>
        </section>
      )}

      <section className="mt-5">
        <h2 className="mb-1.5 text-[14px] font-bold text-ink">{nextSection()} · What this report is not</h2>
        <div className="text-[13px] leading-relaxed" dangerouslySetInnerHTML={{ __html: legal.completion_section6 }} />
      </section>

      <section className="mt-5 border-t border-line pt-3.5">
        <h2 className="mb-1.5 text-[14px] font-bold text-ink">{nextSection()} · Aftercare</h2>
        <p className="text-[13px] leading-relaxed text-mute">
          Any defect in this work, raised within 12 months, is put right at
          the worker&apos;s cost. Keep this report with the house papers. Forward
          it to family, or show it to the next contractor: it is the only
          proof most Jamaican property work never generates.
        </p>
      </section>
    </div>
  );
}
