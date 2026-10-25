import { createClient } from "@/lib/supabase/server";
import { WorkerSign } from "@/components/portal/CompletionReview";
import { DocLogo } from "@/components/portal/DocLogo";
import { fmtDay, fmtWhen, phaseCounts } from "@/lib/portal/completion-report";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Your Completion Report · Yaadly",
  robots: { index: false, follow: false },
};

/* ── The worker's Completion Report, with no login ──────────────────────────
 *
 * Founder, 28 Sep 2026, after signing the test report from her phone: "there
 * is no way to edit", "or raise and issue", "on whatsapp or portal", "fix
 * that". She chose a link that opens without signing in, alongside the
 * WhatsApp buttons.
 *
 * The code in the WhatsApp link is the key, the same pattern as
 * /jobs/[id]/quotes. completion_report_for_code() checks it in Postgres,
 * counts a wrong one, and locks the link after ten; the code changes every
 * revision. What comes back is only what the worker needs to see what they are
 * signing: the words, and a plain summary of the record. No address, no
 * contact details, no money, and the owner's first name only. The photographs
 * stay in the portal, where the worker can see them when signed in.
 */
type Payload = {
  error?: string;
  job?: { id: string; title: string; parish: string | null; trade: string | null; worker_name: string | null; descr: string | null; owner_first: string | null };
  report?: { status: string; rev: number; care_notes: string[] | null; worker_account: string | null; return_reason: string | null; worker_issue: string | null; worker_signed_at: string | null };
  stages?: { stage: number; approved_at: string; method: string | null }[];
  arrivals?: { stage: number | null; at: string; far: boolean | null }[];
  evidence?: { label: string | null; phase: string | null; kind: string | null; stage: number | null; at: string }[];
};

const shell = "mx-auto max-w-[760px] px-5 py-8";
const label = "font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-dim";

export default async function WorkerReport({
  params, searchParams,
}: { params: Promise<{ id: string }>; searchParams: Promise<{ code?: string }> }) {
  const { id } = await params;
  const { code = "" } = await searchParams;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("completion_report_for_code", { p_job: id, p_code: code });
  const p = (data ?? {}) as Payload;

  if (error || p.error || !p.job || !p.report) {
    return (
      <div className={shell}>
        <DocLogo />
        <h1 className="mt-5 font-display text-[26px] uppercase">Completion Report</h1>
        <p className="mt-3 text-[14px] text-mute">{p.error || "That link is not valid, or it is out of date. Open the latest link from your WhatsApp."}</p>
      </div>
    );
  }

  const { job, report } = p;
  const ev = p.evidence ?? [];
  const finds = ev.filter((e) => e.phase === "new");
  const problems = ev.filter((e) => e.phase === "issue");

  return (
    <div className={shell + " grid gap-4"}>
      {/* Every document carries the logo (founder, 28 Sep 2026). This page
          had none until 25 Oct 2026: it has no header by design, so the
          mark is set in by hand, the same way the signed-in copy does. */}
      <DocLogo />
      <div>
        <p className={label}>Completion Report · {job.id}</p>
        <h1 className="mt-1 font-display text-[clamp(22px,3.5vw,30px)] uppercase leading-tight">{job.title}</h1>
        <p className="text-[13px] text-mute">{job.parish}{job.owner_first ? " · for " + job.owner_first : ""}</p>
      </div>

      {report.status === "with_worker" && report.return_reason && (
        <div className="rounded-2xl border border-gold/40 bg-gold/[0.07] px-5 py-3 text-[13px] text-mute">
          <b className="text-goldb">Sent back to you by Yaadly:</b> &ldquo;{report.return_reason}&rdquo;
        </div>
      )}

      {report.status === "with_worker" ? (
        <WorkerSign jobId={job.id} code={code} careNotes={report.care_notes ?? []} account={report.worker_account ?? ""} workerName={job.worker_name ?? ""} />
      ) : (
        <div className="rounded-2xl border border-line bg-bg p-4 text-[13.5px] text-mute">
          {report.status === "worker_raised"
            ? <>You raised an issue: &ldquo;{report.worker_issue}&rdquo;. The report is waiting. Yaadly will come back to you.</>
            : <>You signed this report {fmtWhen(report.worker_signed_at)}. Nothing more is needed from you.</>}
        </div>
      )}

      {/* What they are signing: the record, in plain words. */}
      <section className="rounded-2xl border border-line bg-panel p-5">
        <h2 className="text-[15px] font-bold text-ink">What the report says happened</h2>
        <p className="mt-1 text-[12.5px] text-dim">From the record. Nobody can change this part.</p>
        {job.descr && <p className="mt-3 whitespace-pre-wrap text-[13px] text-mute"><b className="text-ink">The job: </b>{job.descr}</p>}
        <ul className="mt-3 grid gap-1.5 text-[13px] text-mute">
          {(p.stages ?? []).map((s) => (
            <li key={s.stage}><b className="text-ink">Stage {s.stage}</b> approved by the owner {s.method === "in_person" ? "in person" : "from the evidence"}, {fmtWhen(s.approved_at)}</li>
          ))}
          {(p.arrivals ?? []).length > 0 && (
            <li>{(p.arrivals ?? []).length} arrival{(p.arrivals ?? []).length === 1 ? "" : "s"} logged, first on {fmtDay(p.arrivals![0].at)}
              {(p.arrivals ?? []).some((a) => a.far) ? ", one or more logged away from the site" : ""}</li>
          )}
          <li>{ev.length} evidence item{ev.length === 1 ? "" : "s"}{ev.length ? ": " + phaseCounts(ev) : ""}</li>
          {problems.map((e, i) => <li key={"p" + i}>Problem found: {e.label}</li>)}
          {finds.map((e, i) => <li key={"f" + i}>New find, not part of this job: {e.label}</li>)}
        </ul>
      </section>
    </div>
  );
}
