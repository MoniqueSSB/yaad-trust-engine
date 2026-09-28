import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import legal from "@/lib/legal-copy.json";
import { PrintReport } from "@/components/portal/PrintReport";
import { WorkerSign, ClientReview } from "@/components/portal/CompletionReview";
import { phaseBadge } from "@/lib/portal/evidence-sections";
import {
  aftercareEnds, fmtDay, fmtWhen, outcomeLine, phaseCounts, trailLabel, trailWho, type TrailEvent,
} from "@/lib/portal/completion-report";

export const dynamic = "force-dynamic";

/**
 * The Completion Report, assembled from the job's own record.
 *
 * Rebuilt 28 Sep 2026 after a sweep of twenty two comparable documents and a
 * preview the founder approved. It now opens the way they all do: a one line
 * outcome, the dates that matter (started, completed, aftercare ends) and the
 * counts. Then what was agreed, what was done stage by stage and who approved
 * it, the before and after pairs, anything found on site, the materials, the
 * walkthrough, aftercare with its end date and its steps, the limitations,
 * and the signatures with the review trail. The evidence index is the
 * appendix.
 *
 * Every fact is read from the record here. The only stored words are the care
 * notes and the worker's own account (completion_reports). The report is the
 * worker's document (founder, 28 Sep 2026): they change the words and sign,
 * an automatic screen for money and banned wording can only hold it back,
 * and Yaadly steps in only when something goes wrong. No money anywhere.
 *
 * Who sees what: the client only once it is issued; the worker from the
 * moment it opens for them; an admin always, with its state on top.
 */

/* The decided text, verbatim. It carries its own "<h5>6 · ...</h5>" from the
   Kickoff Pack, where it is section 6; here the section number moves with the
   sections before it, so the page draws the heading and drops that one. The
   words themselves are untouched. */
const SECTION_NOT = legal.completion_section6.replace(/<h5>[\s\S]*?<\/h5>/, "");

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return { title: `Completion · ${id} · Yaadly` };
}

type Ev = {
  id: string; label: string | null; created_at: string; captured_at: string | null; sha256: string | null;
  stage: number | null; phase: string | null; kind: string | null; pairs_with: string | null;
  item_code: string | null; storage_path: string | null; img: string | null;
};

const h2 = "mb-2 flex flex-wrap items-baseline gap-2 border-b border-line pb-1.5 text-[15px] font-bold text-ink";
const lead = "mb-2.5 text-[12.5px] text-dim";
const card = "rounded-xl border border-line bg-bg px-3.5 py-2.5 text-[12.5px] text-mute";
const label = "font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-dim";

export default async function Completion({
  params, searchParams,
}: { params: Promise<{ id: string }>; searchParams: Promise<{ code?: string }> }) {
  const user = await getUser();
  if (!user) redirect("/portal/sign-in");
  const { id } = await params;
  const { code } = await searchParams;
  const supabase = await createClient();

  const { data: job } = await supabase
    .from("jobs")
    .select(
      "id,title,trade,parish,addr,descr,status,client_name,client_email,worker_name,worker_email,updated_at,walk_platform,walk_date,walk_who,walk_call_notes,walk_notes_confirmed_at",
    )
    .eq("id", id).maybeSingle();
  if (!job || job.status !== "complete") notFound();

  const email = (user.email ?? "").toLowerCase();
  const isClient = (job.client_email ?? "").toLowerCase() === email;
  const isWorker = (job.worker_email ?? "").toLowerCase() === email;
  const { data: adminFlag } = await supabase.rpc("is_admin");
  const isAdmin = adminFlag === true;

  const { data: report } = await supabase
    .from("completion_reports")
    .select("*")
    .eq("job_id", id).maybeSingle();

  const status: string = report?.status ?? "not_drafted";
  const back = (
    <Link href={"/portal/jobs/" + encodeURIComponent(id)} className="text-[13px] text-tealb underline-offset-2 hover:underline">&larr; Back to the job</Link>
  );

  // Not yet theirs to read. The client waits for issue; the worker waits to be
  // sent it. Said plainly, not as a 404, because the job IS complete.
  const canRead = isAdmin || (isClient && status === "issued") ||
    (isWorker && ["with_worker", "worker_signed", "held", "issued"].includes(status));
  if (!canRead) {
    return (
      <div className="rounded-2xl border border-line bg-panel p-6">
        {back}
        <h1 className="mt-3 font-display text-[clamp(22px,3.5vw,30px)] uppercase leading-tight">Completion Report</h1>
        <p className="mt-3 max-w-[60ch] text-[13.5px] leading-relaxed text-mute">
          {isClient
            ? "Your report is being prepared. The worker who did the job reads it and signs it, then it comes to you. You will get a message when it is ready."
            : "The report for this job is being prepared. You will get a WhatsApp message with a link when it is ready for you to read and sign."}
        </p>
      </div>
    );
  }

  const [evR, apR, arR, qR, kR, dR, mR, tR] = await Promise.all([
    supabase.from("evidence")
      .select("id,label,created_at,captured_at,sha256,stage,phase,kind,pairs_with,item_code,storage_path,img")
      .eq("job_id", id).order("created_at"),
    supabase.from("stage_approvals").select("stage,approved_by,approved_at,confirmed_method").eq("job_id", id).order("stage"),
    supabase.from("arrival_log").select("stage,arrived_at,far_from_site").eq("job_id", id).order("arrived_at"),
    supabase.from("job_quotes")
      .select("scope_summary,included_note,excluded_note,days_estimate,earliest_start,status")
      .eq("job_id", id).eq("status", "accepted").limit(1),
    supabase.from("kickoff_packs").select("both_confirmed_at").eq("job_id", id).not("both_confirmed_at", "is", null)
      .order("both_confirmed_at", { ascending: false }).limit(1),
    supabase.from("disputes").select("id", { count: "exact", head: true }).eq("job_id", id),
    supabase.from("materials_releases").select("stage,receipt_ref,receipt_at").eq("job_id", id).order("stage"),
    supabase.from("completion_report_events").select("step,actor_name,actor_email,at,detail").eq("job_id", id).order("at"),
  ]);

  const ev = (evR.data ?? []) as Ev[];
  const approvals = apR.data ?? [];
  const arrivals = arR.data ?? [];
  const quote = qR.data?.[0] ?? null;
  const kickoffAt = kR.data?.[0]?.both_confirmed_at ?? null;
  const disputes = dR.count ?? 0;
  const materials = mR.data ?? [];
  const trail = (tR.data ?? []) as TrailEvent[];

  // Thumbnails for the before and after pairs only, short-lived, same as the
  // job page: nothing in the evidence bucket is public.
  const pairs = ev.filter((e) => e.pairs_with && e.kind !== "materials")
    .map((after) => ({ after, before: ev.find((b) => b.id === after.pairs_with) }))
    .filter((p): p is { after: Ev; before: Ev } => !!p.before);
  const toSign = [...new Set(pairs.flatMap((p) => [p.before, p.after]).filter((e) => e.storage_path).map((e) => e.storage_path as string))];
  if (toSign.length) {
    const { data: signed } = await supabase.storage.from("evidence").createSignedUrls(toSign, 600);
    const byPath = new Map((signed ?? []).map((r) => [r.path, r.signedUrl]));
    for (const p of pairs) for (const e of [p.before, p.after]) if (e.storage_path) e.img = byPath.get(e.storage_path) ?? null;
  }

  const started = arrivals[0]?.arrived_at ?? ev[0]?.created_at ?? null;
  const completed = approvals.length ? approvals.map((a) => a.approved_at).sort().at(-1) : job.updated_at;
  const endsDay = aftercareEnds(completed);
  const ends = endsDay ? fmtDay(endsDay + "T17:00:00Z") : "";
  const problems = ev.filter((e) => e.phase === "issue");
  const finds = ev.filter((e) => e.phase === "new");
  const farArrivals = arrivals.filter((a) => a.far_from_site === true).length;
  const who = (addr: string | null) =>
    addr && addr.toLowerCase() === (job.client_email ?? "").toLowerCase() ? (job.client_name || "The owner") : (addr ?? "");
  const code_ = (e: Ev) => (e.item_code ? e.item_code + " " : "");
  const stages = [...new Set([...approvals.map((a) => a.stage), ...ev.map((e) => e.stage).filter((s): s is number => s != null)])].sort((a, b) => a - b);

  const outcome = outcomeLine({
    stagesApproved: approvals.length,
    methods: approvals.map((a) => a.confirmed_method),
    problems: problems.length,
    newFinds: finds.length,
    farArrivals,
    disputes,
  });

  let n = 0;
  const next = () => ++n;
  const careNotes: string[] = report?.care_notes ?? [];

  return (
    <div className="grid gap-4">
      {isAdmin && status !== "issued" && (
        <div className="rounded-2xl border border-gold/40 bg-gold/[0.07] px-5 py-3 text-[13px] text-mute print:hidden">
          <b className="text-goldb">Desk view.</b> This report is <b>{status.replace(/_/g, " ")}</b>
          {status === "held" && report?.hold_reason ? <> (held for: {report.hold_reason})</> : null}. The client cannot see it until it is issued.
        </div>
      )}
      {isWorker && status === "with_worker" && report?.return_reason && (
        <div className="rounded-2xl border border-gold/40 bg-gold/[0.07] px-5 py-3 text-[13px] text-mute print:hidden">
          <b className="text-goldb">Sent back to you{report.returned_name ? " by " + report.returned_name : ""}:</b> &ldquo;{report.return_reason}&rdquo;
        </div>
      )}
      {isWorker && status === "with_worker" && (
        <WorkerSign jobId={job.id} code={code ?? ""} careNotes={careNotes} account={report?.worker_account ?? ""} workerName={job.worker_name ?? ""} />
      )}
      {isWorker && (status === "worker_signed" || status === "held") && (
        <div className="rounded-2xl border border-line bg-bg p-4 text-[13px] text-mute print:hidden">
          You signed this report {fmtWhen(report?.worker_signed_at)}.{" "}
          {status === "held"
            ? "It has been held before going to the owner, and Yaadly is looking at it. If anything needs changing, it comes back to you with the reason."
            : "It goes to the owner in a moment."}
        </div>
      )}

      <div id="completion-report" className="rounded-2xl border border-line bg-panel p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
          {back}
          <PrintReport jobId={job.id} targetId="completion-report" />
        </div>

        <div className="mt-3 border-b-2 border-teal pb-4">
          <p className={label}>Completion Report · {job.id}{report?.issued_at ? " · issued " + fmtDay(report.issued_at) : ""}</p>
          <h1 className="mt-1 font-display text-[clamp(22px,3.5vw,30px)] uppercase leading-tight">Completion Report</h1>
          <p className="mt-1 text-[14px] text-mute">{job.title}{job.parish ? ", " + job.parish : ""}</p>
        </div>

        {/* At a glance */}
        <div className="mt-4 rounded-xl border border-teal/50 bg-teal/[0.06] px-4 py-3">
          <p className={label + " text-tealb"}>Outcome</p>
          <p className="mt-1 text-[15px] leading-snug text-ink">{outcome}</p>
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-x-5 gap-y-2 rounded-xl border border-line bg-bg px-4 py-3 sm:grid-cols-3">
          <div><dt className={label}>Property</dt><dd className="text-[13px] text-ink">{job.addr || job.parish || "Not given"}</dd></div>
          <div><dt className={label}>Owner</dt><dd className="text-[13px] text-ink">{job.client_name || "Not named"}</dd></div>
          <div><dt className={label}>Carried out by</dt><dd className="text-[13px] text-ink">{job.worker_name || "Not named"}{job.trade ? ", " + job.trade.toLowerCase() : ""}, vetted by Yaadly</dd></div>
          <div><dt className={label}>Work started</dt><dd className="text-[13px] text-ink">{fmtWhen(started) || "Not recorded"}</dd></div>
          <div><dt className={label}>Work completed</dt><dd className="text-[13px] text-ink">{fmtWhen(completed) || "Not recorded"}</dd></div>
          <div><dt className={label}>Aftercare runs to</dt><dd className="text-[13px] font-bold text-ink">{ends || "Not recorded"}</dd></div>
        </dl>
        <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5">
          {[
            [approvals.length, "Stages approved"],
            [arrivals.length, "Site arrivals logged"],
            [ev.length, "Evidence items"],
            [pairs.length, "Before and after pairs"],
            [finds.length, "New finds"],
          ].map(([v, l]) => (
            <div key={String(l)} className="rounded-xl border border-line px-2 py-2 text-center">
              <b className="block font-display text-[22px] font-normal text-ink">{v}</b>
              <span className="font-mono text-[9px] font-bold uppercase tracking-[0.08em] text-dim">{l}</span>
            </div>
          ))}
        </div>

        {/* What was agreed */}
        <section className="mt-6">
          <h2 className={h2}>{next()} · What was agreed</h2>
          <p className={lead}>
            {kickoffAt ? "The scope both sides confirmed on the Kickoff Pack, " + fmtDay(kickoffAt) + ". " : ""}
            This is what the work below is measured against.
          </p>
          {quote ? (
            <div className="grid gap-2.5 sm:grid-cols-2">
              {quote.scope_summary && <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-mute sm:col-span-2">{quote.scope_summary}</p>}
              <div className="rounded-xl border border-line border-l-[3px] border-l-teal bg-bg px-3.5 py-2.5">
                <p className={label}>Included</p>
                <p className="mt-1 whitespace-pre-wrap text-[12.5px] text-mute">{quote.included_note || "Not itemised on the quote."}</p>
              </div>
              <div className="rounded-xl border border-line border-l-[3px] border-l-coral bg-bg px-3.5 py-2.5">
                <p className={label}>Not included</p>
                <p className="mt-1 whitespace-pre-wrap text-[12.5px] text-mute">{quote.excluded_note || "Not itemised on the quote."}</p>
              </div>
              {(quote.days_estimate || quote.earliest_start) && (
                <p className="text-[12.5px] text-dim sm:col-span-2">
                  Estimated {quote.days_estimate ? quote.days_estimate + " working day" + (quote.days_estimate === 1 ? "" : "s") : ""}
                  {quote.earliest_start ? (quote.days_estimate ? ", from " : "from ") + fmtDay(quote.earliest_start) : ""}.
                </p>
              )}
            </div>
          ) : (
            <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-mute">{job.descr}</p>
          )}
        </section>

        {/* Stage by stage */}
        <section className="mt-6">
          <h2 className={h2}>{next()} · What was done, stage by stage</h2>
          {report?.worker_account && (
            <div className="mb-3 rounded-xl border border-line bg-bg px-3.5 py-2.5">
              <p className={label}>In {job.worker_name ? job.worker_name.split(" ")[0] + "'s" : "the worker's"} own words</p>
              <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-mute">{report.worker_account}</p>
            </div>
          )}
          <div className="grid gap-2.5">
            {stages.map((s) => {
              const a = approvals.find((x) => x.stage === s);
              const arr = arrivals.filter((x) => x.stage === s);
              const items = ev.filter((e) => e.stage === s);
              return (
                <div key={s} className="break-inside-avoid rounded-xl border border-line bg-bg">
                  <div className="flex flex-wrap items-center gap-2 border-b border-line px-3.5 py-2">
                    <b className="text-[13.5px] text-ink">Stage {s}</b>
                    <span className={"rounded-full px-2 py-0.5 font-mono text-[9.5px] font-bold uppercase " + (a ? "bg-teal text-white" : "border border-line2 text-dim")}>
                      {a ? "Approved" : "No approval on record"}
                    </span>
                  </div>
                  <div className="grid gap-1 px-3.5 py-2.5 text-[12.5px] text-mute">
                    <div className="grid gap-x-3 sm:grid-cols-[130px_1fr]"><span className={label}>Arrived</span><span>
                      {arr.length ? arr.map((x, i) => (
                        <span key={i} className="mr-3 inline-block">
                          {fmtWhen(x.arrived_at)}
                          {x.far_from_site === true && <span className="ml-1.5 rounded-full bg-gold px-2 py-0.5 font-mono text-[9.5px] font-bold uppercase text-white">Logged away from the site</span>}
                          {x.far_from_site === false && <span className="ml-1.5 rounded-full bg-teal px-2 py-0.5 font-mono text-[9.5px] font-bold uppercase text-white">On site</span>}
                        </span>
                      )) : "No arrival logged"}
                    </span></div>
                    <div className="grid gap-x-3 sm:grid-cols-[130px_1fr]"><span className={label}>Evidence</span><span>{items.length ? items.length + " item" + (items.length === 1 ? "" : "s") + ": " + phaseCounts(items) : "None filed"}</span></div>
                    {a && (
                      <div className="grid gap-x-3 sm:grid-cols-[130px_1fr]"><span className={label}>Approved by</span><span>
                        {who(a.approved_by)}, {a.confirmed_method === "in_person" ? "in person at the property" : "from the evidence"}, {fmtWhen(a.approved_at)}
                      </span></div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Before and after */}
        {pairs.length > 0 && (
          <section className="mt-6">
            <h2 className={h2}>{next()} · Before and after</h2>
            <p className={lead}>Photographs the worker paired on site: the same spot, before the work and after it.</p>
            <div className="grid gap-3">
              {pairs.map(({ before, after }) => (
                <div key={after.id} className="break-inside-avoid">
                  <div className="grid grid-cols-2 gap-2.5">
                    {[["Before", before], ["After", after]].map(([t, e]) => {
                      const x = e as Ev;
                      return (
                        <figure key={x.id} className="m-0">
                          {x.img
                            // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed URL, not a static asset
                            ? <img src={x.img} alt={String(t) + ": " + (x.label ?? "")} className="aspect-[4/3] w-full rounded-lg border border-line object-cover" />
                            : <div className="flex aspect-[4/3] w-full items-center justify-center rounded-lg border border-dashed border-line2 text-[11px] text-dim">In the portal</div>}
                          <figcaption className="mt-1 text-[11.5px] text-mute"><b className="text-ink">{String(t)}</b> · {code_(x)}{x.label} · {fmtWhen(x.captured_at || x.created_at)}</figcaption>
                        </figure>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Found on site */}
        {(problems.length > 0 || finds.length > 0) && (
          <section className="mt-6">
            <h2 className={h2}>{next()} · Found on site</h2>
            <p className={lead}>Anything the worker found that nobody knew about when the job was agreed.</p>
            <div className="grid gap-2.5">
              {problems.map((e) => (
                <div key={e.id} className="break-inside-avoid rounded-xl border border-line border-l-4 border-l-coral bg-bg px-3.5 py-2.5 text-[12.5px] text-mute">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-coral px-2 py-0.5 font-mono text-[9.5px] font-bold uppercase text-white">Problem</span>
                    <b className="text-[13.5px] text-ink">{e.label}</b>
                  </div>
                  <p className="mt-1">Recorded {fmtWhen(e.captured_at || e.created_at)}{e.item_code ? " (" + e.item_code + ")" : ""}{e.stage ? ", stage " + e.stage : ""}. Within the agreed job, so it does not change what the job is.</p>
                </div>
              ))}
              {finds.map((e) => (
                <div key={e.id} className="break-inside-avoid rounded-xl border border-line border-l-4 border-l-gold bg-bg px-3.5 py-2.5 text-[12.5px] text-mute">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-gold px-2 py-0.5 font-mono text-[9.5px] font-bold uppercase text-white">New find</span>
                    <b className="text-[13.5px] text-ink">{e.label}</b>
                    <span className="rounded-full border border-line2 px-2 py-0.5 font-mono text-[9.5px] font-bold uppercase text-dim">Not part of this job</span>
                  </div>
                  <p className="mt-1">Recorded {fmtWhen(e.captured_at || e.created_at)}{e.item_code ? " (" + e.item_code + ")" : ""}. Not quoted and not agreed. Recorded here so the owner knows about it. Nothing has been done and nothing is owed for it.</p>
                  {isClient && (
                    <Link
                      href={"/jobs/new?" + new URLSearchParams({
                        ...(job.trade ? { trade: job.trade } : {}),
                        ...(job.parish ? { parish: job.parish } : {}),
                        about: "Found during job " + job.id + " on " + fmtDay(e.captured_at || e.created_at) + ": " + (e.label ?? "") + ".",
                      }).toString()}
                      className="mt-2 inline-block rounded-full bg-gold px-4 py-1.5 text-[12.5px] font-bold text-white print:hidden"
                    >
                      Ask for a quote for this
                    </Link>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Materials */}
        {(materials.length > 0 || ev.some((e) => e.kind === "materials")) && (
          <section className="mt-6">
            <h2 className={h2}>{next()} · Materials bought for the job</h2>
            <ul className="grid gap-1.5">
              {materials.map((m, i) => (
                <li key={"m" + i} className={card}>
                  <b className="text-ink">Stage {m.stage}</b>
                  {m.receipt_ref ? " · receipt " + m.receipt_ref : ""}
                  {m.receipt_at ? " · filed " + fmtDay(m.receipt_at) : " · receipt not filed yet"}
                </li>
              ))}
              {ev.filter((e) => e.kind === "materials").map((e) => (
                <li key={e.id} className={card}><b className="text-ink">{code_(e)}{e.label}</b>{e.stage ? " · stage " + e.stage : ""} · {fmtDay(e.created_at)}</li>
              ))}
            </ul>
            <p className="mt-1.5 text-[12px] text-dim">The receipts are in the evidence index.</p>
          </section>
        )}

        {/* Walkthrough, only the confirmed loop counts */}
        {job.walk_notes_confirmed_at && (
          <section className="mt-6">
            <h2 className={h2}>{next()} · Video walkthrough</h2>
            <p className={lead}>
              {job.walk_platform ?? "A call"}{job.walk_date ? ", " + job.walk_date : ""}
              {job.walk_who ? " · " + job.walk_who : ""}
            </p>
            <p className="whitespace-pre-wrap rounded-xl border border-line bg-bg px-3.5 py-2.5 text-[13px] leading-relaxed text-mute">{job.walk_call_notes}</p>
            <p className="mt-1.5 text-[11px] text-dim">Confirmed by the owner {fmtWhen(job.walk_notes_confirmed_at)}</p>
          </section>
        )}

        {/* Aftercare */}
        <section className="mt-6">
          <h2 className={h2}>{next()} · Aftercare</h2>
          {ends && <p className="mb-2 text-[13px] text-ink">Covered until <b>{ends}</b>.</p>}
          <p className="text-[13px] leading-relaxed text-mute">
            Any defect in this work, raised within 12 months, is put right at the worker&apos;s cost.
          </p>
          <p className="mt-3 text-[13px] font-bold text-ink">If something goes wrong</p>
          <ol className="mt-1 list-decimal pl-5 text-[13px] leading-relaxed text-mute">
            <li>Photograph it and message Yaadly through the portal or on WhatsApp, quoting {job.id}.</li>
            <li>We send it to the worker, who is given the chance to put it right first.</li>
            <li>If it is not put right, a named person at Yaadly reviews the evidence on both sides and decides.</li>
          </ol>
          {careNotes.length > 0 && (
            <>
              <p className="mt-3 text-[13px] font-bold text-ink">Looking after it</p>
              <ul className="mt-1 list-disc pl-5 text-[13px] leading-relaxed text-mute">
                {careNotes.map((c, i) => <li key={i}>{c}</li>)}
              </ul>
            </>
          )}
          <p className="mt-3 text-[13px] leading-relaxed text-mute">
            Keep this report with the house papers. Forward it to family, or show it to the next contractor: it is
            the only proof most Jamaican property work never generates.
          </p>
        </section>

        {/* The decided legal text, verbatim */}
        <section className="mt-6">
          <h2 className={h2}>{next()} · What this report is not</h2>
          <div className="text-[13px] leading-relaxed" dangerouslySetInnerHTML={{ __html: SECTION_NOT }} />
        </section>

        {/* Signatures and the review trail */}
        <section className="mt-6">
          <h2 className={h2}>{next()} · Signed and issued</h2>
          {report?.worker_signed_at ? (
            <div className="break-inside-avoid rounded-xl border border-line border-l-[3px] border-l-ink bg-bg px-4 py-3">
              <p className={label}>Worker&apos;s declaration</p>
              <p className="mt-1 text-[13px] text-mute">
                I carried out the work described in this report. The account of what was done is accurate, and the
                photographs and video were taken by me on this property on the dates shown.
              </p>
              <p className="mt-2 font-display text-[20px] text-ink">{report.worker_signed_name}</p>
              <p className="text-[11.5px] text-dim">Signed {fmtWhen(report.worker_signed_at)}</p>
            </div>
          ) : (
            <p className="text-[12.5px] text-dim">Not signed by the worker yet.</p>
          )}
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="border-t-2 border-ink pt-1.5 text-[13px] text-ink">
              <p className={label}>Sent to the owner</p>
              {/* Honest about who read it. A report released from hold carries
                  the name of the person who released it; one that passed the
                  automatic screen says so, and never implies a person at
                  Yaadly reviewed the worker's words. */}
              {!report?.issued_at ? <span className="text-dim">Not sent yet</span>
                : report.issued_name
                  ? <>Released by {report.issued_name}, Yaadly Ltd<br /><span className="text-[11.5px] text-dim">{fmtWhen(report.issued_at)}</span></>
                  : <>When the worker signed<br /><span className="text-[11.5px] text-dim">{fmtWhen(report.issued_at)}. The report is the worker&apos;s own; Yaadly does not edit it.</span></>}
            </div>
            <div className="border-t-2 border-ink pt-1.5 text-[13px] text-ink">
              <p className={label}>Work approved by the owner</p>
              {approvals.length ? <>{who(approvals.at(-1)!.approved_by)}<br /><span className="text-[11.5px] text-dim">{fmtWhen(completed)}</span></> : <span className="text-dim">No approval on record</span>}
            </div>
          </div>
          {trail.length > 0 && (
            <>
              <p className="mt-4 text-[13px] font-bold text-ink">Review trail</p>
              <ol className="mt-1 grid gap-1">
                {trail.map((e, i) => (
                  <li key={i} className="grid gap-x-3 border-b border-line py-1.5 text-[12px] text-mute sm:grid-cols-[1fr_180px_150px]">
                    <span>{i + 1} · {trailLabel(e)}</span>
                    <span className="text-ink">{trailWho(e)}</span>
                    <span className="text-dim">{fmtWhen(e.at)}</span>
                  </li>
                ))}
              </ol>
            </>
          )}
        </section>

        {/* Appendix: the evidence index */}
        <section className="mt-6">
          <h2 className={h2}>A · Evidence index · {ev.length} items</h2>
          <p className={lead}>
            Every file, when it was taken, when it was filed, and its fingerprint. Change one pixel and it stops matching.
          </p>
          <ul className="grid gap-1.5">
            {ev.map((e) => (
              <li key={e.id} className={card}>
                <b className="text-ink">{code_(e)}{e.label}</b>
                {phaseBadge(e.phase, e.kind) && <span className="text-ink"> · {phaseBadge(e.phase, e.kind)}</span>}
                {e.stage != null && <span> · Stage {e.stage}</span>}
                {e.captured_at && <span> · taken {fmtWhen(e.captured_at)}</span>}
                <span> · filed {fmtWhen(e.created_at)}</span>
                {e.sha256 && <span className="mt-1 block break-all font-mono text-[9px] text-dim">sha256 · {e.sha256}</span>}
              </li>
            ))}
          </ul>
        </section>
      </div>

      {isClient && status === "issued" && !report?.client_confirmed_at && !report?.client_flagged_at && (
        <ClientReview jobId={job.id} />
      )}
      {isClient && report?.client_confirmed_at && (
        <p className="text-[12.5px] text-dim print:hidden">You confirmed this report {fmtWhen(report.client_confirmed_at)}.</p>
      )}
      {isClient && report?.client_flagged_at && !report?.client_confirmed_at && (
        <p className="text-[12.5px] text-dim print:hidden">You raised a point on {fmtDay(report.client_flagged_at)}. A person at Yaadly is looking at it.</p>
      )}
    </div>
  );
}
