import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { STAGES, jobStage } from "@/lib/portal/journey";
import { StageRail } from "@/components/portal/StageRail";
import { CalBand } from "@/components/portal/CalBand";
import { ReviewForm } from "@/components/portal/ReviewForm";
import { EvidenceUpload } from "@/components/portal/EvidenceUpload";
import { ChatThread } from "@/components/portal/ChatThread";
import { DisputePanel } from "@/components/portal/DisputePanel";
import { PortalTiles, type Tile } from "@/components/portal/PortalTiles";
import { FeeBreakdown } from "@/components/portal/FeeBreakdown";
import { agreeScope, chooseQuote } from "@/app/portal/job-actions";
import { scrub } from "@/lib/scrub";

export const dynamic = "force-dynamic";

/**
 * One job, one room, one real address: /portal/jobs/JOB-0002 is a link you
 * can put in a WhatsApp message. The single-file site could never do that.
 *
 * Same rule as the list page: no email filters here. Row level security
 * decides whether this user may see this job at all. If Postgres says no,
 * the query returns nothing and the visitor gets a 404, not somebody
 * else's job.
 */

type Evidence = {
  id: string;
  label: string | null;
  meta: string | null;
  img: string | null;
  ok: boolean | null;
  created_at: string | null;
  uploaded_by: string | null;
  sha256: string | null;
  stage: number | null;
};

type Quote = {
  id: string;
  worker_name: string | null;
  labour_jmd: number | null;
  materials_jmd: number | null;
  materials_at_cost: boolean | null;
  earliest_start: string | null;
  days_estimate: string | null;
  note: string | null;
  status: string | null;
};

type Pack = {
  id: string;
  project_title: string | null;
  status: string | null;
  rev: number | null;
  updated_at: string | null;
};

const STATUS_LABEL: Record<string, string> = {
  awaiting_client_setup: "Waiting on your portal setup",
  draft: "Draft, not live yet",
  open: "Open for quotes",
  quoted: "Quotes in, waiting on you",
  confirmed: "Confirmed",
  in_progress: "Work under way",
  evidence: "Evidence waiting on you",
  complete: "Closed",
};

function jmd(n: number | null) {
  return n == null ? null : "J$" + n.toLocaleString("en-US");
}

export default async function JobRoom({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ s?: string; cal?: string; d?: string }>;
}) {
  const user = await getUser();
  if (!user) redirect("/portal/sign-in");

  const { id } = await params;
  const { s: sParam, cal, d } = await searchParams;
  const supabase = await createClient();

  const { data: job } = await supabase
    .from("jobs")
    .select(
      "id,title,trade,parish,stage,status,descr,client_email,worker_email,worker_name,updated_at,signoff_method,walk_platform,walk_date",
    )
    .eq("id", id)
    .maybeSingle();

  // RLS returning nothing and the job not existing look identical from here.
  // That is correct: a stranger probing ids learns nothing either way.
  if (!job) notFound();

  const email = (user.email ?? "").toLowerCase();
  const role =
    job.client_email?.toLowerCase() === email ? "client" : "worker";

  const [{ data: evidence }, { data: quotes }, { data: packs }, { data: scopeRows }, { data: msgRows }, { data: disputeRow }] =
    await Promise.all([
      supabase
        .from("evidence")
        .select("id,label,meta,img,ok,created_at,uploaded_by,sha256,stage")
        .eq("job_id", id)
        .order("created_at", { ascending: true }),
      supabase
        .from("job_quotes")
        .select(
          "id,worker_name,labour_jmd,materials_jmd,materials_at_cost,earliest_start,days_estimate,note,status",
        )
        .eq("job_id", id)
        .order("created_at", { ascending: true }),
      supabase
        .from("kickoff_packs")
        .select("id,project_title,status,rev,updated_at")
        .eq("job_id", id)
        .order("updated_at", { ascending: false }),
      supabase.from("scope_agreements").select("side,email").eq("job_id", id),
      supabase.from("messages").select("id,sender_email,body,created_at").eq("job_id", id).order("created_at").limit(200),
      supabase.from("disputes").select("id,state,body,reply,kinds").eq("job_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ]);

  const current = jobStage(job.status);
  const viewing = (() => {
    const n = Number(sParam);
    return Number.isInteger(n) && n >= 0 && n < STAGES.length ? n : current;
  })();

  const { data: myReview } = await supabase
    .from("reviews")
    .select("id")
    .eq("job_id", id)
    .ilike("author_email", email)
    .maybeSingle();

  const ev = (evidence ?? []) as Evidence[];
  const stageCount = Math.max(job.stage ?? 0, ...ev.map((e) => e.stage ?? 1), 1);
  const stages = Array.from({ length: stageCount }, (_, k) => k + 1);
  const qs = (quotes ?? []) as Quote[];
  const scopeTicks = scopeRows ?? [];
  const clientTicked = scopeTicks.some((t) => t.side === "client");
  const iTicked = scopeTicks.some((t) => t.email.toLowerCase() === email);
  const chooseOpen = !job.worker_email && job.status !== "complete";
  const chat = (msgRows ?? []).map((m) => ({
    id: m.id,
    mine: m.sender_email.toLowerCase() === email,
    body: scrub(m.body).clean,
    at: String(m.created_at).slice(0, 16).replace("T", " "),
  }));
  const dispute = disputeRow
    ? { id: disputeRow.id, state: disputeRow.state, body: disputeRow.body, reply: disputeRow.reply, kinds: (disputeRow.kinds ?? []) as string[] }
    : null;
  const pk = (packs ?? []) as Pack[];

  /* The accepted quote is what the money panels read from. Before a worker is
     chosen there is no agreed number, and the panels stay away rather than
     inventing one. */
  const won =
    qs.find((q) => q.status === "accepted") ??
    (job.worker_email
      ? qs.find(
          (q) =>
            (q as { worker_email?: string }).worker_email?.toLowerCase() ===
            job.worker_email?.toLowerCase(),
        )
      : undefined);

  const money = (n: number | null | undefined) =>
    n == null ? null : "J$" + Math.round(n).toLocaleString("en-JM");

  const labour = won?.labour_jmd ?? null;
  const allIn = labour == null ? null : Math.round(labour * 1.15) + (won?.materials_jmd ?? 0);
  const takeHome = labour == null ? null : Math.round(labour * 0.88) + (won?.materials_jmd ?? 0);

  const evidenceThisStage = ev.filter((e) => (e.stage ?? 1) === Math.max(job.stage ?? 1, 1)).length;

  const tiles: Tile[] = [
    {
      label: role === "client" ? "You pay, all in" : "You receive",
      value: (role === "client" ? money(allIn) : money(takeHome)) ?? "Not agreed yet",
      held: job.status !== "complete",
      note:
        labour == null
          ? "Agreed once you choose a quote"
          : job.status === "complete"
            ? "Released"
            : "Held until you approve the evidence",
    },
    {
      label: "Stage",
      value: String(Math.max(job.stage ?? 0, 0)) + " of " + String(stageCount),
      note: STAGES[current] ?? "",
    },
    {
      label: "Evidence on this stage",
      value: String(evidenceThisStage),
      note: evidenceThisStage === 0 ? "Nothing uploaded yet" : "Timestamped and fingerprinted",
    },
    {
      label: "Waiting on",
      value:
        job.status === "complete"
          ? "Nobody"
          : job.status === "evidence"
            ? role === "client" ? "You" : "The client"
            : job.worker_email ? "The work" : "Quotes",
      held: job.status === "evidence" && role === "client",
      note: job.status === "complete" ? "Closed and paid" : "",
    },
  ];

  return (
    <>
      <Link
        href="/portal"
        className="text-[13px] text-tealb underline-offset-2 hover:underline"
      >
        &larr; All your jobs
      </Link>

      {job.worker_email && (
        <CalBand
          side={role === "worker" ? "worker" : "client"}
          owner={job.worker_email.toLowerCase()}
          jobId={job.id}
          kind="job"
          base={"/portal/jobs/" + encodeURIComponent(job.id)}
          cal={cal}
          sel={d}
          viewerEmail={email}
        />
      )}

      <div className="mt-4 flex flex-wrap items-start gap-3">
        <h1 className="min-w-[240px] flex-1 font-display text-[clamp(24px,3.6vw,34px)] uppercase leading-none">
          {job.title ?? "Untitled job"}
        </h1>
        <span className="rounded-full border border-softline bg-soft px-3 py-1.5 text-[11.5px] font-bold text-tealb">
          {STATUS_LABEL[job.status] ?? job.status}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap gap-3.5 text-[12.5px] text-dim">
        <span>{job.id}</span>
        {job.trade && <span>{job.trade}</span>}
        {job.parish && <span>{job.parish}</span>}
        <span>
          You are the {role === "client" ? "client" : "tradesperson"} on this
          job
        </span>
      </div>

      <StageRail
        stages={STAGES}
        current={current}
        viewing={viewing}
        base={"/portal/jobs/" + encodeURIComponent(job.id)}
      />

      <PortalTiles tiles={tiles} />

      <FeeBreakdown
        side={role === "worker" ? "worker" : "client"}
        labour={labour}
        materials={won?.materials_jmd ?? null}
        materialsAtCost={won?.materials_at_cost ?? null}
        workerName={won?.worker_name ?? job.worker_name}
      />

      {job.descr && (
        <div className="mt-6 rounded-2xl border border-line bg-panel p-5">
          <h2 className="mb-2 text-[10.5px] font-bold uppercase tracking-[.2em] text-tealb">
            The job, as agreed
          </h2>
          <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-mute">
            {job.descr}
          </p>
        </div>
      )}

      <section className="mt-8">
        <h2 className="mb-1 text-[10.5px] font-bold uppercase tracking-[.2em] text-tealb">
          Evidence ledger · {ev.length} item{ev.length === 1 ? "" : "s"}
        </h2>
        <p className="mb-4 max-w-[62ch] text-[13px] leading-relaxed text-mute">
          Each stage has its own checklist, its own proof and its own release.
          Money moves once per stage, never as one lump at the end.
        </p>

        {stages.map((stageNo) => {
          const items = ev.filter((e) => (e.stage ?? 1) === stageNo);
          const state = stageNo < (job.stage ?? 0) ? "done" : stageNo === (job.stage ?? 0) || (job.stage ?? 0) === 0 ? "now" : "todo";
          return (
            <div
              key={stageNo}
              className={
                "mb-3 rounded-2xl border p-4 " +
                (state === "done"
                  ? "border-softline bg-soft"
                  : state === "now"
                    ? "border-mango/40 bg-mango/5"
                    : "border-line bg-panel opacity-70")
              }
            >
              <div className="flex flex-wrap items-center gap-3">
                <b className="text-[14px]">Stage {stageNo}</b>
                <span
                  className={
                    "rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide " +
                    (state === "done"
                      ? "bg-tealb/15 text-tealb"
                      : state === "now"
                        ? "bg-mango/15 text-mango"
                        : "bg-panel2 text-dim")
                  }
                >
                  {state === "done" ? "Signed off · released" : state === "now" ? "In progress" : "Not started"}
                </span>
                <span className="ml-auto text-[11.5px] text-dim">
                  {items.length} item{items.length === 1 ? "" : "s"} filed
                </span>
              </div>

              {items.length === 0 ? (
                <p className="mt-2.5 text-[12.5px] text-dim">
                  Nothing filed against this stage yet.
                </p>
              ) : (
                <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {items.map((e) => (
                    <li key={e.id} className="overflow-hidden rounded-xl border border-line bg-panel">
                      {e.img ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={e.img} alt={e.label ?? "Evidence photo"} className="h-36 w-full object-cover" />
                      ) : (
                        <div className="grid h-16 w-full place-items-center bg-panel2 text-[11.5px] text-dim">
                          Filed without an image
                        </div>
                      )}
                      <div className="p-3">
                        <div className="flex items-start justify-between gap-2">
                          <b className="text-[13px] leading-snug">{e.label ?? "Evidence"}</b>
                          {e.ok != null && (
                            <span className={"rounded-full px-2 py-0.5 text-[9.5px] font-bold " + (e.ok ? "bg-tealb/15 text-tealb" : "bg-mango/15 text-mango")}>
                              {e.ok ? "Checked" : "Awaiting check"}
                            </span>
                          )}
                        </div>
                        {e.created_at && (
                          <p className="mt-0.5 text-[11px] text-dim">
                            {new Date(e.created_at).toISOString().slice(0, 16).replace("T", " ")}
                          </p>
                        )}
                        {e.sha256 && (
                          <p className="mt-1.5 break-all font-mono text-[9px] leading-relaxed text-dim">
                            sha256 · {e.sha256}
                          </p>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}

        {job.status !== "complete" && (
          <EvidenceUpload jobId={job.id} maxStage={stages.length} />
        )}
      </section>

      {chooseOpen && (
        <section className="mt-8 rounded-2xl border border-line2 bg-panel p-4">
          <h2 className="mb-1 text-[10.5px] font-bold uppercase tracking-[.2em] text-tealb">
            The scope gate
          </h2>
          <p className="mb-3 max-w-[62ch] text-[13px] leading-relaxed text-mute">
            Nobody is chosen on a price alone. Both sides tick the written
            scope; until both ticks land there is no Choose button, and the
            database refuses even if there were.
          </p>
          <div className="flex flex-wrap items-center gap-2.5">
            <span className={"rounded-full border px-3 py-1.5 text-[12px] font-bold " + (clientTicked ? "border-softline bg-soft text-tealb" : "border-line text-dim")}>
              {clientTicked ? "✓ Client agreed" : "Client not yet agreed"}
            </span>
            <span className={"rounded-full border px-3 py-1.5 text-[12px] font-bold " + (scopeTicks.some((t) => t.side === "worker") ? "border-softline bg-soft text-tealb" : "border-line text-dim")}>
              {scopeTicks.some((t) => t.side === "worker") ? "✓ A worker agreed" : "No worker agreed yet"}
            </span>
            {!iTicked && (role === "client" || qs.length > 0) && (
              <form action={agreeScope}>
                <input type="hidden" name="jobId" value={job.id} />
                <input type="hidden" name="side" value={role} />
                <button className="rounded-full bg-linear-to-r from-teal to-mango px-4 py-2 text-[13px] font-bold text-[#04211D]">
                  I agree to this scope
                </button>
              </form>
            )}
          </div>
        </section>
      )}

      {qs.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-4 text-[10.5px] font-bold uppercase tracking-[.2em] text-tealb">
            Quotes · {qs.length}
          </h2>
          <ul className="grid gap-3">
            {qs.map((q) => (
              <li
                key={q.id}
                className="rounded-2xl border border-line bg-panel p-4"
              >
                <div className="flex flex-wrap items-center gap-3">
                  <b className="text-[14.5px]">{q.worker_name ?? "Worker"}</b>
                  {q.status && (
                    <span className="rounded-full border border-line bg-panel2 px-2.5 py-1 text-[10.5px] font-bold text-mute">
                      {q.status}
                    </span>
                  )}
                  <span className="ml-auto text-[15px] font-bold text-tealb">
                    {jmd(q.labour_jmd) ?? "No labour figure"}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-3.5 text-[12.5px] text-dim">
                  {q.materials_jmd != null && (
                    <span>
                      Materials {jmd(q.materials_jmd)}
                      {q.materials_at_cost ? ", at cost" : ""}
                    </span>
                  )}
                  {q.earliest_start && <span>Start: {q.earliest_start}</span>}
                  {q.days_estimate && <span>{q.days_estimate}</span>}
                </div>
                {q.note && (
                  <p className="mt-2 text-[13px] leading-relaxed text-mute">
                    {q.note}
                  </p>
                )}
                {role === "client" && chooseOpen && q.status === "submitted" && (
                  clientTicked && scopeTicks.some((t) => t.side === "worker") ? (
                    <form action={chooseQuote} className="mt-3">
                      <input type="hidden" name="jobId" value={job.id} />
                      <input type="hidden" name="quoteId" value={q.id} />
                      <button className="rounded-full bg-linear-to-r from-teal to-mango px-4 py-2 text-[13px] font-bold text-[#04211D]">
                        Choose this worker
                      </button>
                    </form>
                  ) : (
                    <span className="mt-3 inline-block rounded-full border border-line bg-panel2 px-3.5 py-2 text-[12px] font-bold text-dim">
                      Choose unlocks when both have agreed
                    </span>
                  )
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {job.status === "complete" && !myReview && (
        <ReviewForm
          jobId={job.id}
          direction={role === "client" ? "client_of_worker" : "worker_of_client"}
          subjectEmail={(role === "client" ? job.worker_email : job.client_email) ?? ""}
          subjectName={role === "client" ? (job.worker_name ?? "the worker") : "the client"}
        />
      )}
      {job.status === "complete" && myReview && (
        <p className="mt-4 rounded-2xl border border-softline bg-soft px-4 py-3 text-[13px] text-mute">
          Your review of this job is in. It publishes when the other side
          writes theirs, or after fourteen days.
        </p>
      )}

      {pk.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-4 text-[10.5px] font-bold uppercase tracking-[.2em] text-tealb">
            Documents
          </h2>
          <ul className="grid gap-3">
            {pk.map((p) => (
              <li key={p.id}>
              <Link
                href={"/portal/jobs/" + encodeURIComponent(job.id) + "/pack"}
                className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-panel px-4 py-3.5 transition hover:border-teal"
              >
                <b className="text-[14px]">
                  Kickoff Pack{p.rev != null ? ` · rev ${p.rev}` : ""}
                </b>
                <span className="text-[12.5px] text-dim">
                  {p.project_title}
                </span>
                <span className="ml-auto rounded-full border border-softline bg-soft px-2.5 py-1 text-[10.5px] font-bold text-tealb">
                  {p.status}
                </span>
              </Link>
              </li>
            ))}
            {job.status === "complete" && (
              <li>
                <Link href={"/portal/jobs/" + encodeURIComponent(job.id) + "/completion"}
                  className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-panel px-4 py-3.5 transition hover:border-teal">
                  <b className="text-[14px]">Completion Report</b>
                  <span className="text-[12.5px] text-dim">Yours to keep, with the evidence index and fingerprints</span>
                </Link>
              </li>
            )}
          </ul>
        </section>
      )}

      {job.worker_email && (
        <>
          <ChatThread jobId={job.id} messages={chat} self={role === "client" ? "the client" : "the worker"} />
          <DisputePanel jobId={job.id} role={role} dispute={dispute} workerName={job.worker_name ?? "the worker"} />
        </>
      )}
    </>
  );
}
