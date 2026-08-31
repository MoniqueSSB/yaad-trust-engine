import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { STAGES, jobStage } from "@/lib/portal/journey";
import { StageRail } from "@/components/portal/StageRail";
import { CalBand } from "@/components/portal/CalBand";
import { ReviewForm } from "@/components/portal/ReviewForm";
import { EvidenceUpload } from "@/components/portal/EvidenceUpload";
import { MaterialsStore } from "@/components/portal/MaterialsStore";
import { ChatThread } from "@/components/portal/ChatThread";
import { DisputePanel } from "@/components/portal/DisputePanel";
import { PortalTiles, type Tile } from "@/components/portal/PortalTiles";
import { FeeBreakdown } from "@/components/portal/FeeBreakdown";
import { PortalCard } from "@/components/portal/PortalCard";
import { JobBrief } from "@/components/portal/JobBrief";
import { IntakeThread } from "@/components/portal/IntakeThread";
import { jobGates } from "@/lib/portal/gates";
import { DocStrip, type Doc } from "@/components/portal/DocStrip";
import { TabBar, TABS, type TabKey } from "@/components/portal/TabBar";
import { EvidenceLedger } from "@/components/portal/EvidenceLedger";
import { GoLive, type Gate } from "@/components/portal/GoLive";
import { BoardPreview } from "@/components/portal/BoardPreview";
import legal from "@/lib/legal-copy.json";
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
  storage_path: string | null;
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
  searchParams: Promise<{ s?: string; cal?: string; d?: string; tab?: string }>;
}) {
  const user = await getUser();
  if (!user) redirect("/portal/sign-in");

  const { id } = await params;
  const { s: sParam, cal, d, tab: tabParam } = await searchParams;
  const supabase = await createClient();

  const { data: job } = await supabase
    .from("jobs")
    .select(
      "id,title,trade,parish,stage,status,descr,open,client_email,worker_email,worker_name,updated_at,signoff_method,walk_platform,walk_date,portal_code,materials_store,materials_store_type,materials_store_set_at,materials_store_set_by,job_type,size_band,access_type,materials_by,urgency",
    )
    .eq("id", id)
    .maybeSingle();

  // RLS returning nothing and the job not existing look identical from here.
  // That is correct: a stranger probing ids learns nothing either way.
  if (!job) notFound();

  const email = (user.email ?? "").toLowerCase();
  const role =
    job.client_email?.toLowerCase() === email ? "client" : "worker";

  const [{ data: evidence }, { data: quotes }, { data: packs }, { data: scopeRows }, { data: msgRows }, { data: disputeRow }, { data: intakeRow }, { data: boardPhotos }] =
    await Promise.all([
      supabase
        .from("evidence")
        .select("id,label,meta,img,storage_path,ok,created_at,uploaded_by,sha256,stage")
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
      /* The conversation this job came out of. Row level security returns
         nothing here unless the signed-in address is this job's client
         (20260829q), so a worker's copy of this query is empty and the
         component below never has worker-side data to mishandle. */
      supabase.from("intake_threads").select("transcript,channel,turns").eq("job_id", id).maybeSingle(),
      /* The photos the public board shows, from the same table the board
         reads, so the preview below cannot show a photo the board would
         not. */
      supabase.from("job_photos").select("caption,img").eq("job_id", id).order("position"),
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

  /* The signature that opens the board, at the exact version in force. A
     signature on an older version is not a signature for this purpose:
     client_go_live() compares doc_version to current_doc_version() with =,
     so "signed, but 1.2" and "never signed" are the same answer to Postgres
     and must be the same answer here. */
  const { data: cgSig } = await supabase
    .from("doc_signatures")
    .select("id")
    .eq("doc_type", "client_guidelines")
    .eq("doc_version", legal.CG_VERSION)
    .ilike("signer_email", email)
    .limit(1)
    .maybeSingle();

  const ev = (evidence ?? []) as Evidence[];

  /* Evidence filed since the bucket move lives in private storage, so the page
     mints a short-lived signed URL per object as it renders. Nothing in that
     bucket is public and no URL here outlives the page it was drawn on. Rows
     filed before the move still carry their base64 data URL in img and are
     left exactly as they were. */
  const inBucket = ev.filter((e) => e.storage_path);
  if (inBucket.length) {
    const { data: signed } = await supabase.storage
      .from("evidence")
      .createSignedUrls(inBucket.map((e) => e.storage_path as string), 300);
    const byPath = new Map((signed ?? []).map((r) => [r.path, r.signedUrl]));
    for (const e of inBucket) e.img = byPath.get(e.storage_path) ?? null;
  }
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

  const jobBase = "/portal/jobs/" + encodeURIComponent(job.id);

  /* THE GO LIVE GATES.
     Read off the triggers, in the order Postgres applies them, so the list a
     client works through is the list the database is actually holding them
     on. Each line here has a migration behind it; none of it is a house
     style rule that could be relaxed in this file. */
  const emailConfirmed = !!user.email_confirmed_at;
  const signed = !!cgSig;
  /* open_jobs is open = true AND no worker AND stage 0. Past that point the
     job is not "not live", it has moved on, and the checklist retires. */
  const onBoard =
    job.open === true && !job.worker_email && (job.stage ?? 0) === 0;
  const movedOn = !!job.worker_email || (job.stage ?? 0) > 0 || job.status === "complete";

  const gates: Gate[] = jobGates({
    job,
    jobBase,
    emailConfirmed,
    signed,
  });

  /* The board carries the trade filter so the job is not one card in a list
     of everything, and the anchor puts it under the reader's eye rather than
     somewhere on the page. */
  const marketplaceHref =
    "/jobs?" +
    (job.trade ? "trade=" + encodeURIComponent(job.trade) + "&" : "") +
    "q=" + encodeURIComponent(job.id) +
    "#" + encodeURIComponent(job.id);
  const approvedPack = pk.find((x) => x.status === "approved") ?? pk[0];
  /* Every document the job will ever have, each carrying the state it is
     actually in. "Not completed" is a fact about a document that is going to
     exist; a blank row is not, and the client had been reading blank rows as
     breakage. */
  const docs: Doc[] = [
    {
      icon: "\u2713",
      title: "Client Guidelines",
      note: signed
        ? "Signed, immutable, version " + legal.CG_VERSION
        : "Sign these and the job can go to workers",
      state: signed ? "ready" : "not_completed",
      href: "/portal/guidelines",
    },
    {
      icon: "\ud83d\udcc4",
      title: "Kickoff Pack",
      note: approvedPack
        ? "Scope, milestones and the evidence checklist"
        : "Written once a worker is chosen and the scope is agreed",
      state: approvedPack
        ? approvedPack.status === "approved"
          ? "ready"
          : "in_progress"
        : "not_completed",
      href: approvedPack ? jobBase + "/pack" : undefined,
    },
    {
      icon: job.status === "complete" ? "\ud83d\udcc4" : "\u25cb",
      title: "Completion Report",
      note:
        job.status === "complete"
          ? "Before and after, the evidence record and your approval"
          : "Written when the job closes",
      state: job.status === "complete" ? "ready" : "not_completed",
      href: job.status === "complete" ? jobBase + "/completion" : undefined,
    },
  ];

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

  /* The tab is a search param, so every pane is a real address that survives
     a reload and can be pasted into a message. Anything unrecognised falls
     back to the job itself rather than an empty screen. */
  const tab: TabKey = (TABS.find((t) => t.key === tabParam)?.key ?? "job");

  /* Counts sit on the tabs so a client can see there is something to look at
     without opening each one. Zero is never shown: a badge reading 0 is worse
     than no badge, because it draws the eye to nothing. */
  const docsReady = docs.filter((x) => x.state === "ready").length + pk.length;
  const tabCounts = { evidence: ev.length, documents: docsReady };

  /* jobs.status = 'evidence' is the moment the money is waiting on a human
     rather than on the work. The ledger leads with it. */
  const awaitingApproval = job.status === "evidence";

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

      {/*
        "Waiting on your portal setup" names a state and leaves the reader to
        guess the action, so the actions go here, in the order the database
        applies them.

        This replaces a banner that said signing the Client Guidelines was
        "the whole list". It is not, and saying so was the specific way this
        breaks: 20260828e made a nominated materials store a condition of
        reaching the board, and client_go_live() SKIPS any job without one
        rather than failing the statement for the client's other jobs. A
        client who believed that banner would sign, watch nothing happen, and
        have nothing left to try.

        Workers see the same stuck job and can clear none of it, so the
        checklist is the client's alone.
      */}
      {role === "client" && !movedOn && (
        <GoLive
          jobId={job.id}
          gates={gates}
          live={onBoard}
          marketplaceHref={marketplaceHref}
        />
      )}

      {/*
        Shown only while the job is not yet on the board, which is the one
        moment the question "what exactly am I publishing?" is live. Once
        the job IS on the board the GoLive card links to the real thing,
        and a preview next to the original would just be the original,
        twice.
      */}
      {role === "client" && !movedOn && !onBoard && (
        <BoardPreview
          job={job}
          signed={signed}
          photos={(boardPhotos ?? []) as { caption: string; img: string | null }[]}
        />
      )}

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

      <TabBar base={jobBase} active={tab} counts={tabCounts} />

      {tab === "documents" && (
        <>
      <DocStrip docs={docs} />

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

        </>
      )}


      {tab === "info" && (
        <>
      {role === "client" && (
        <PortalCard
          reference={job.id}
          code={job.portal_code ?? null}
          href={"app.yaadly.co.uk" + jobBase}
          kind="job"
        />
      )}

          <section className="mt-4 rounded-2xl border border-line bg-panel p-5">
            <h2 className="mb-3 text-[10.5px] font-bold uppercase tracking-[.2em] text-tealb">
              This job
            </h2>
            <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-2 text-[13px]">
              <dt className="text-mute">Reference</dt>
              <dd className="text-right font-mono text-tealb">{job.id}</dd>
              {job.trade && (
                <>
                  <dt className="text-mute">Trade</dt>
                  <dd className="text-right">{job.trade}</dd>
                </>
              )}
              {job.parish && (
                <>
                  <dt className="text-mute">Parish</dt>
                  <dd className="text-right">{job.parish}</dd>
                </>
              )}
              <dt className="text-mute">You are the</dt>
              <dd className="text-right">
                {role === "client" ? "client" : "tradesperson"}
              </dd>
              <dt className="text-mute">On the marketplace</dt>
              <dd className="text-right">
                {onBoard ? (
                  <Link href={marketplaceHref} className="text-tealb underline-offset-2 hover:underline">
                    Live, see it &rarr;
                  </Link>
                ) : movedOn ? (
                  <span className="text-dim">No, the job has moved on</span>
                ) : (
                  <span className="text-dim">Not yet</span>
                )}
              </dd>
            </dl>
          </section>
        </>
      )}

      {tab === "job" && (
        <>
      {/* Before the evidence ledger on purpose. Until this is answered no
          materials money can move and no materials evidence can be filed, so
          it belongs above the thing it is blocking rather than below it. */}
      <MaterialsStore
        jobId={job.id}
        role={role}
        storeType={job.materials_store_type ?? null}
        store={job.materials_store ?? null}
        setBy={job.materials_store_set_by ?? null}
        setAt={job.materials_store_set_at ?? null}
      />

      {job.descr && (
        <JobBrief
          descr={job.descr}
          trade={job.trade}
          parish={job.parish}
        />
      )}

      <IntakeThread
        transcript={intakeRow?.transcript ?? null}
        channel={intakeRow?.channel ?? null}
        turns={intakeRow?.turns ?? null}
        role={role === "worker" ? "worker" : "client"}
      />

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

      {job.worker_email && (
        <>
          <ChatThread jobId={job.id} messages={chat} self={role === "client" ? "the client" : "the worker"} />
          {/* id="dispute" is what the Evidence tab's "Something wrong
              instead?" link points at (?tab=job#dispute). Tabs are URLs on
              this page, so the honest way to offer "raise it instead" next
              to Approve is a real address, not a modal duplicating
              DisputePanel. */}
          <div id="dispute">
            <DisputePanel jobId={job.id} role={role} dispute={dispute} workerName={job.worker_name ?? "the worker"} />
          </div>
        </>
      )}
        </>
      )}

      {tab === "evidence" && (
        <>
          <EvidenceLedger
            items={ev}
            stageCount={stageCount}
            currentStage={job.stage ?? 0}
            role={role === "worker" ? "worker" : "client"}
            awaitingApproval={awaitingApproval}
            jobId={job.id}
          />
      {job.status !== "complete" && (
        <EvidenceUpload
          jobId={job.id}
          maxStage={stages.length}
          storeType={job.materials_store_type ?? null}
          store={job.materials_store ?? null}
        />
      )}
        </>
      )}

    </>
  );
}
