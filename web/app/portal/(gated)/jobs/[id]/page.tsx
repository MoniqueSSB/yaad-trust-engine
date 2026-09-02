import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { jobStages, packPaymentStages } from "@/lib/portal/journey";
import { StageRail } from "@/components/portal/StageRail";
import { PackStageProgress } from "@/components/portal/PackStageProgress";
import { CalBand } from "@/components/portal/CalBand";
import { ReviewForm } from "@/components/portal/ReviewForm";
import { EvidenceUpload } from "@/components/portal/EvidenceUpload";
import { JobPhotoUpload } from "@/components/portal/JobPhotoUpload";
import { VideoEvidenceUpload } from "@/components/portal/VideoEvidenceUpload";
import { WalkthroughPanel } from "@/components/portal/WalkthroughPanel";
import { ArrivalCheckIn } from "@/components/portal/ArrivalCheckIn";
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
import { Outstanding, type OutItem } from "@/components/portal/Outstanding";
import { JobProgress, type Phase, type Step } from "@/components/portal/JobProgress";
import { MoneyPanel, type InvoiceRow } from "@/components/portal/MoneyPanel";
import { StageLedger, type LedgerStage } from "@/components/portal/StageLedger";
import { BoardPreview } from "@/components/portal/BoardPreview";
import legal from "@/lib/legal-copy.json";
import { chooseQuote, requestKickoff } from "@/app/portal/job-actions";
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

/** A photograph the client sent with the job. board_ok is whether the public
 *  marketplace board carries it; the file itself lives in the private intake
 *  bucket and img is filled in below with a signed link, never stored. */
type BoardPhoto = {
  id: string;
  caption: string;
  img: string | null;
  storage_path: string | null;
  board_ok: boolean | null;
  source: string | null;
};

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
  worker_email: string | null;
  labour_jmd: number | null;
  materials_jmd: number | null;
  materials_at_cost: boolean | null;
  earliest_start: string | null;
  days_estimate: string | null;
  note: string | null;
  status: string | null;
  scope_summary: string | null;
  included_note: string | null;
  excluded_note: string | null;
  timeline_note: string | null;
  payment_stage_note: string | null;
};

type Pack = {
  id: string;
  quote_id: string | null;
  project_title: string | null;
  status: string | null;
  rev: number | null;
  updated_at: string | null;
  confirm_code: string | null;
  both_confirmed_at: string | null;
  docs: unknown;
};

const STATUS_LABEL: Record<string, string> = {
  awaiting_client_setup: "Waiting on your portal setup",
  draft: "Draft, not live yet",
  open: "Open for quotes",
  quoted: "Quotes in, waiting on you",
  awaiting_payment: "Booked, waiting on the agency fee",
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
      "id,title,trade,parish,stage,status,descr,open,client_email,worker_email,worker_name,updated_at,signoff_method,walk_platform,walk_link,walk_date,walk_who,walk_notes,walk_call_notes,walk_notes_confirmed_at,portal_code,materials_store,materials_store_type,materials_store_set_at,materials_store_set_by,job_type,size_band,access_type,materials_by,urgency",
    )
    .eq("id", id)
    .maybeSingle();

  // RLS returning nothing and the job not existing look identical from here.
  // That is correct: a stranger probing ids learns nothing either way.
  if (!job) notFound();

  const email = (user.email ?? "").toLowerCase();
  const role =
    job.client_email?.toLowerCase() === email ? "client" : "worker";

  const [{ data: evidence }, { data: quotes }, { data: packs }, { data: msgRows }, { data: disputeRow }, { data: intakeRow }, { data: boardPhotos }, { data: arrivals }, { data: invoiceRows }] =
    await Promise.all([
      supabase
        .from("evidence")
        .select("id,label,meta,img,storage_path,ok,created_at,uploaded_by,sha256,stage")
        .eq("job_id", id)
        .order("created_at", { ascending: true }),
      supabase
        .from("job_quotes")
        .select(
          "id,worker_name,worker_email,labour_jmd,materials_jmd,materials_at_cost,earliest_start,days_estimate,note,status,scope_summary,included_note,excluded_note,timeline_note,payment_stage_note",
        )
        .eq("job_id", id)
        .order("created_at", { ascending: true }),
      supabase
        .from("kickoff_packs")
        .select("id,quote_id,project_title,status,rev,updated_at,confirm_code,both_confirmed_at,docs")
        .eq("job_id", id)
        .order("updated_at", { ascending: false }),
      supabase.from("messages").select("id,sender_email,body,created_at").eq("job_id", id).order("created_at").limit(200),
      supabase.from("disputes").select("id,state,body,reply,kinds").eq("job_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      /* The conversation this job came out of. Row level security returns
         nothing here unless the signed-in address is this job's client
         (20260829q), so a worker's copy of this query is empty and the
         component below never has worker-side data to mishandle. */
      supabase.from("intake_threads").select("transcript,channel,turns").eq("job_id", id).maybeSingle(),
      /* The photos on this job, from the same table the board reads. Every
         one of them, not only the published ones: this is the client's own
         job and their own pictures, and the preview below marks which of
         them the public board actually carries. RLS decides what comes back
         ("job party reads their own job photos"), so a worker's copy of this
         query is their own booked job and nothing else. */
      supabase.from("job_photos").select("id,caption,img,storage_path,board_ok,source").eq("job_id", id).order("position"),
      /* The Arrival Log. Newest first, capped: this renders a short "on
         site" strip, not a full attendance record. */
      supabase.from("arrival_log").select("stage,arrived_at,arrived_on").eq("job_id", id).order("arrived_at", { ascending: false }).limit(10),
      /* Invoices on this job. No email filter: RLS already returns a
         client only their own non-draft invoices and a worker only the
         ones payable to them, so filtering again here would be a second
         place for that rule to drift out of step with Postgres. */
      supabase
        .from("invoices")
        .select("id,status,total_pence,currency,stage,payable_to,issue_date,paid_at,period_label")
        .eq("job_id", id)
        .order("created_at", { ascending: true }),
    ]);

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
  /* The client's own photographs, from the private 'intake' bucket WhatsApp
     intake writes to. Same treatment as the evidence above and for the same
     reason: nothing in that bucket is public, so the page mints a short-lived
     signed URL per object as it renders and no link here outlives the page it
     was drawn on. */
  const bp = (boardPhotos ?? []) as BoardPhoto[];
  const bpToSign = bp.filter((p) => p.storage_path && !p.img);
  if (bpToSign.length) {
    const { data: signedPhotos } = await supabase.storage
      .from("intake")
      .createSignedUrls(bpToSign.map((p) => p.storage_path as string), 300);
    const byPath = new Map((signedPhotos ?? []).map((r) => [r.path, r.signedUrl]));
    for (const p of bpToSign) p.img = byPath.get(p.storage_path as string) ?? null;
  }

  const stageCount = Math.max(job.stage ?? 0, ...ev.map((e) => e.stage ?? 1), 1);
  const stages = Array.from({ length: stageCount }, (_, k) => k + 1);
  const qs = (quotes ?? []) as Quote[];
  const chooseOpen = !job.worker_email && job.status !== "complete";
  /* A client can confirm a still-'submitted' quote over WhatsApp before the
     worker's side lands, and status only flips to 'quote_confirmed' once
     BOTH sides are in. Found live, 2 Sep 2026: without this check, "Get a
     Kickoff Pack for this price" kept showing (and being clicked) on a
     quote the client had already started confirming the lighter way,
     silently detouring it onto the Kickoff Pack path mid-confirmation. */
  const submittedQuoteIds = qs.filter((q) => q.status === "submitted").map((q) => q.id);
  const { data: partialAgreements } = submittedQuoteIds.length
    ? await supabase.from("quote_agreements").select("quote_id, side").in("quote_id", submittedQuoteIds)
    : { data: [] as { quote_id: string; side: string }[] };
  const clientAlreadyConfirming = new Set(
    (partialAgreements ?? []).filter((a) => a.side === "client").map((a) => a.quote_id),
  );
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

  /* A worker with a live quote but no booking (since 20260901f: a client can
     accept more than one quote, and a Kickoff Pack is drafted and confirmed
     BEFORE anyone is chosen). role fell to "worker" only by exclusion above,
     and RLS now lets that row through on the strength of job_quotes alone,
     not job.worker_email. The rest of this page assumes a booked worker
     everywhere it says role === "worker" - the arrival log, materials store,
     evidence upload - none of which apply yet. Rather than audit every one
     of those sections for a state that cannot happen until this migration,
     this renders a small, honest, separate view: their own quote, and their
     own Kickoff Pack once one exists. */
  if (role === "worker" && !job.worker_email) {
    const myQuote = qs.find((q) => q.worker_email?.toLowerCase() === email) ?? qs[0];
    const myPack = myQuote ? pk.find((p) => p.quote_id === myQuote.id) : undefined;
    return (
      <div className="mx-auto max-w-[720px] px-5 py-10">
        <p className="text-[10.5px] font-bold uppercase tracking-[.2em] text-mango">Your quote</p>
        <h1 className="mt-2 font-display text-[clamp(24px,4vw,36px)] uppercase leading-[.95]">
          {job.title}
        </h1>
        <p className="mt-2 text-[13px] text-mute">
          {job.parish} · <span className="font-mono text-[12px]">{job.id}</span>
        </p>

        {!myQuote && (
          <p className="mt-6 max-w-[58ch] text-[14px] leading-relaxed text-mute">
            No live quote of yours found on this job.
          </p>
        )}

        {myQuote && (
          <div className="mt-6 rounded-2xl border border-line bg-panel p-5">
            <div className="flex flex-wrap items-center gap-3">
              <b className="text-[15px]">Your price</b>
              <span className="rounded-full border border-line bg-panel2 px-2.5 py-1 text-[10.5px] font-bold text-mute">
                {myQuote.status}
              </span>
              <span className="ml-auto text-[15px] font-bold text-tealb">
                {jmd(myQuote.labour_jmd) ?? "No labour figure"}
              </span>
            </div>

            {myQuote.status === "submitted" && (
              <p className="mt-3 text-[13px] leading-relaxed text-mute">
                Waiting on the client. Nothing to do here yet: if they want to
                move forward with your price, they will ask you to write a
                Kickoff Pack against it.
              </p>
            )}

            {myQuote.status === "declined" && (
              <p className="mt-3 text-[13px] leading-relaxed text-mute">
                The client went with a different price for this job.
              </p>
            )}

            {myQuote.status === "kickoff_requested" && !myPack && (
              <p className="mt-3 text-[13px] leading-relaxed text-mute">
                The client wants a Kickoff Pack against your price. It is
                being written now; check back shortly.
              </p>
            )}

            {myQuote.status === "kickoff_requested" && myPack && myPack.status !== "approved" && (
              <p className="mt-3 text-[13px] leading-relaxed text-mute">
                Your Kickoff Pack is drafted and waiting on review before it
                is issued.
              </p>
            )}

            {myQuote.status === "kickoff_requested" && myPack && myPack.status === "approved" && (
              <div className="mt-4 border-t border-line pt-4">
                <p className="text-[13px] leading-relaxed text-mute">
                  Your Kickoff Pack is ready: scope, timeline, payment stages
                  and the evidence checklist. Read it, then confirm your side.
                  {myPack.both_confirmed_at
                    ? " Both sides have confirmed it."
                    : " Once both you and the client confirm it, they can choose you for the job."}
                </p>
                <Link
                  href={"/portal/jobs/" + encodeURIComponent(job.id) + "/pack"}
                  className="mt-3 inline-block rounded-full bg-linear-to-r from-teal to-mango px-4 py-2 text-[13px] font-bold text-[#04211D]"
                >
                  Read the Kickoff Pack &rarr;
                </Link>
                {/* A button here is exactly the surface CLAUDE.md §9 rules
                    out for a worker. Confirming is a WhatsApp reply, same
                    message that told them the pack was ready. */}
                {!myPack.both_confirmed_at && (
                  <p className="mt-3 text-[13px] leading-relaxed text-mute">
                    Reply to Yaadly&apos;s WhatsApp message with{" "}
                    <b className="font-mono text-ink">{job.id}</b> to confirm your side.
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

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

  /* The rail a client actually signs against. Only a genuinely APPROVED
     pack drives this - a draft is unconfirmed AI output and has no business
     naming what money releases against, whatever else it is used for below. */
  const trulyApprovedPack = pk.find((x) => x.status === "approved") ?? null;
  const packStages = packPaymentStages(trulyApprovedPack?.docs ?? null);
  const { stages: railStages, current: railCurrent } = jobStages(job.status, job.stage, packStages);
  const current = railCurrent;
  const viewing = (() => {
    const n = Number(sParam);
    return Number.isInteger(n) && n >= 0 && n < railStages.length ? n : current;
  })();
  const currentPackStage = packStages[Math.max((job.stage ?? 1) - 1, 0)] ?? null;
  const amountDue =
    currentPackStage?.proportion_percent != null && labour != null
      ? Math.round((labour * currentPackStage.proportion_percent) / 100)
      : null;
  const timelinePhases = (
    (trulyApprovedPack?.docs as { timeline?: { phases?: unknown } } | undefined)
      ?.timeline?.phases as { name?: string; duration?: string; milestone?: string }[] | undefined
  ) ?? [];

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

  /* Same test the database uses (materials_store_nominated), so the
     checklist and Postgres never disagree about whether this question is
     live: an accepted quote, materials money on it. */
  const hasAcceptedMaterials = qs.some(
    (q) => q.status === "accepted" && (q.materials_jmd ?? 0) > 0,
  );

  const gates: Gate[] = jobGates({
    job,
    jobBase,
    emailConfirmed,
    signed,
    hasAcceptedMaterials,
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

  /* ── WHAT IS OUTSTANDING, AND WHERE THIS JOB IS ──────────────────────
     Founder's instruction, 2 Sep 2026: make the stages and everything
     outstanding clear, on both portals. Everything below is derived from
     state this page already loaded; nothing here invents a task or a
     number, and every branch is one a job can actually be in. */

  const invoices = (invoiceRows ?? []) as InvoiceRow[];
  const feeInvoice = invoices.find((i) => i.payable_to !== "worker");
  const feeJmd = labour == null ? null : Math.round(labour * 0.15);
  const isClient = role === "client";
  const otherSideLabel = isClient ? "The worker" : "The client";

  /* Approvals are what a stage waits on, and stage_approvals is the table
     that records them, so "approved" here means the same thing it means to
     the trigger that releases the money. */
  const { data: approvalRows } = await supabase
    .from("stage_approvals")
    .select("stage")
    .eq("job_id", id);
  const approvedStages = new Set((approvalRows ?? []).map((r) => r.stage as number));

  const jobStage = Math.max(job.stage ?? 0, 0);
  const evidenceOnStage = (n: number) => ev.filter((e) => (e.stage ?? 1) === n).length;

  const outstanding: OutItem[] = [];
  if (isClient && !movedOn) {
    for (const g of gates) {
      if (g.done) continue;
      outstanding.push({
        who: "you",
        title: g.title,
        detail: g.why,
        href: g.href,
        cta: g.cta ?? "Open",
      });
    }
  }
  /* Gates all cleared but the job is still not on the board. The database
     is no longer holding it; the client simply has not pressed the button
     yet, and "all clear" would be a lie about a job nobody can quote. */
  if (isClient && !movedOn && !onBoard && gates.every((g) => g.done)) {
    outstanding.push({
      who: "you",
      title: "Put this job on the marketplace",
      detail:
        "Everything it needs is done. Until you publish it, no tradesperson can see it or quote it.",
      href: jobBase,
      cta: "Publish",
    });
  }
  if (job.status === "quoted" && chooseOpen && qs.length > 0) {
    outstanding.push({
      who: isClient ? "you" : "them",
      title: isClient ? "Choose a quote" : "The client is deciding between quotes",
      detail: isClient
        ? qs.length + " quote" + (qs.length === 1 ? " is" : "s are") + " in. Nothing is charged until you pick one."
        : "Nothing is owed by either side until a quote is accepted.",
      href: isClient ? jobBase : undefined,
      cta: isClient ? "See quotes" : undefined,
    });
  }
  if (job.status === "awaiting_payment") {
    outstanding.push({
      who: isClient ? "you" : "yaadly",
      title: isClient ? "Pay the Guarantee & Support fee" : "Waiting on the client's agency fee",
      detail: isClient
        ? "15% of the labour price, invoiced once. The job cannot start until this is settled."
        : "The job starts once Yaadly's fee invoice is paid. Nothing is needed from you.",
      href: isClient ? jobBase + "?tab=money" : undefined,
      cta: isClient ? "See the invoice" : undefined,
    });
  }
  if (jobStage > 0 && job.status !== "complete") {
    const filed = evidenceOnStage(jobStage);
    const approved = approvedStages.has(jobStage);
    if (!approved && filed > 0) {
      outstanding.push({
        who: isClient ? "you" : "them",
        title: isClient
          ? "Approve stage " + jobStage + " evidence, or raise a problem"
          : "The client is reviewing your stage " + jobStage + " evidence",
        detail: isClient
          ? filed + " item" + (filed === 1 ? "" : "s") + " filed. Nothing is invoiced or paid until you decide."
          : "Your pay invoice for this stage is raised the moment they approve it.",
        href: isClient ? jobBase + "?tab=evidence" : undefined,
        cta: isClient ? "Review" : undefined,
      });
    } else if (!approved && filed === 0) {
      outstanding.push({
        who: isClient ? "them" : "you",
        title: isClient
          ? "The worker is on stage " + jobStage
          : "File stage " + jobStage + " evidence",
        detail: isClient
          ? "Nothing to approve yet. Evidence appears here as it is filed."
          : "Photographs for this stage. Nothing is invoiced to you until the client approves them.",
        href: isClient ? undefined : jobBase + "?tab=evidence",
        cta: isClient ? undefined : "Upload",
      });
    }
  }
  for (const inv of invoices) {
    if (inv.status === "sent" && inv.payable_to !== "worker" && isClient) {
      outstanding.push({
        who: "you",
        title: "Invoice " + inv.id + " is unpaid",
        detail: "Sent" + (inv.issue_date ? " on " + inv.issue_date : "") + ". Paid by bank transfer.",
        href: jobBase + "?tab=money",
        cta: "See it",
      });
    }
  }
  if (job.status === "complete" && !myReview) {
    outstanding.push({
      who: "you",
      title: "Leave a review",
      detail: "The job is closed and paid. A review is what builds the record on both sides.",
      href: jobBase + "?tab=job",
      cta: "Write it",
    });
  }

  /* Four phases, each opened up to show its own steps. A payment stage
     carries the money it releases, because on this product a stage IS a
     payment. */
  const stepState = (done: boolean, now: boolean): Step["state"] =>
    done ? "done" : now ? "now" : "todo";

  const setupSteps: Step[] = gates.map((g) => ({
    title: g.title,
    state: g.done ? "done" : ("now" as const),
  }));
  const setupDone = gates.every((g) => g.done);

  const hasQuotes = qs.length > 0;
  const hasWon = !!won;
  const quoteSteps: Step[] = [
    { title: "Job visible on the board", state: stepState(onBoard || movedOn, false) },
    { title: hasQuotes ? qs.length + " quote" + (qs.length === 1 ? "" : "s") + " received" : "Quotes received", state: stepState(hasQuotes, setupDone && !hasQuotes) },
    { title: hasWon ? (won?.worker_name ?? "Quote") + " accepted" : "Quote accepted", state: stepState(hasWon, hasQuotes && !hasWon) },
  ];

  const workSteps: Step[] = [
    { title: "Kickoff Pack agreed", state: stepState(!!trulyApprovedPack, hasWon && !trulyApprovedPack) },
    {
      title: "Yaadly fee " + (isClient ? "paid" : "settled"),
      state: stepState(feeInvoice?.status === "paid", feeInvoice?.status === "sent"),
      amount: money(feeJmd) ?? undefined,
    },
    ...(packStages.length
      ? packStages.map((ps, k) => {
          const n = k + 1;
          const done = approvedStages.has(n) || jobStage > n;
          const amt =
            ps.proportion_percent != null && labour != null
              ? money(Math.round((labour * ps.proportion_percent) / 100)) ?? undefined
              : undefined;
          return {
            title: "Stage " + n + " · " + ps.stage,
            state: stepState(done, jobStage === n),
            amount: amt,
          } as Step;
        })
      : []),
  ];

  const closed = job.status === "complete";
  const closeSteps: Step[] = [
    { title: "Final stage released", state: stepState(closed, false) },
    { title: "Completion report issued", state: stepState(closed, false) },
    { title: "Reviews exchanged", state: stepState(closed && !!myReview, closed && !myReview) },
  ];

  /* One row per payment stage, joining the pack's own schedule to the
     evidence filed against it, the approval that releases it, and the pay
     invoice that approval raises. A stage invoice is a worker-payable one
     carrying that stage number (20260902j); the whole-job agency fee has
     no stage and is deliberately not matched here. */
  const ledgerStages: LedgerStage[] = packStages.map((ps, k) => {
    const n = k + 1;
    const inv = invoices.find((i) => i.payable_to === "worker" && i.stage === n) ?? null;
    return {
      n,
      name: ps.stage,
      percent: ps.proportion_percent ?? null,
      amount:
        ps.proportion_percent != null && labour != null
          ? money(Math.round((labour * ps.proportion_percent) / 100))
          : null,
      releaseCondition: ps.release_condition ?? null,
      evidenceRequired: ps.evidence_required ?? [],
      evidenceFiled: evidenceOnStage(n),
      approved: approvedStages.has(n) || jobStage > n,
      current: jobStage === n,
      invoiceId: inv?.id ?? null,
      invoicePaid: inv?.status === "paid",
    };
  });

  const phaseState = (done: boolean, now: boolean): Phase["state"] =>
    done ? "done" : now ? "now" : "todo";
  const inWork = hasWon && !closed;
  const phases: Phase[] = [
    {
      title: "Set up",
      summary: setupDone ? "Done" : gates.filter((g) => g.done).length + " of " + gates.length + " done",
      state: phaseState(setupDone, !setupDone),
      steps: setupSteps,
    },
    {
      title: "Quotes",
      summary: hasWon ? (won?.worker_name ?? "A worker") + " chosen" : hasQuotes ? qs.length + " in, waiting on a decision" : "Not started",
      state: phaseState(hasWon, setupDone && !hasWon),
      steps: quoteSteps,
    },
    {
      title: "Work & evidence",
      summary: closed
        ? "Done"
        : jobStage > 0
          ? "Stage " + jobStage + (packStages.length ? " of " + packStages.length : "")
          : "Not started",
      state: phaseState(closed, inWork),
      steps: workSteps,
    },
    {
      title: "Closed & paid",
      summary: closed ? "Closed" : "Not started",
      state: phaseState(closed && !!myReview, closed && !myReview),
      steps: closeSteps,
    },
  ];

  /* The quote both sides have confirmed over WhatsApp, if one exists yet:
     the lighter document that precedes a Kickoff Pack and, on its own, is
     enough to book. */
  const confirmedQuote = qs.find((q) =>
    ["quote_confirmed", "kickoff_requested", "accepted"].includes(q.status ?? ""),
  );
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
      icon: confirmedQuote ? "\ud83d\udcc4" : "\u25cb",
      title: "Quote Pack",
      note: confirmedQuote
        ? "Price, scope and payment stages, confirmed by both sides"
        : "Written once a worker's price is confirmed by both sides",
      state: confirmedQuote ? "ready" : "not_completed",
      href: confirmedQuote ? jobBase + "/quote-pack?quote=" + confirmedQuote.id : undefined,
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
      note: railStages[current] ?? "",
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

  /* "Today" read the same way log_arrival() reads it: Jamaica-local,
     fixed UTC-5, no daylight saving to chase. */
  const jamaicaToday = new Date(new Date().getTime() - 5 * 3600_000).toISOString().slice(0, 10);
  const arrivalRows = arrivals ?? [];
  const checkedInToday = arrivalRows.some((a) => a.arrived_on === jamaicaToday);
  const recentArrivals = arrivalRows.map((a) => ({
    stage: a.stage as number,
    arrivedAt: String(a.arrived_at).slice(0, 16).replace("T", " "),
  }));

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
        The client's own photographs, and the way to send more. Always here,
        at every stage: a picture that would have helped a quote also helps
        the person who turns up, and asking for one should not depend on
        whether this client happens to use WhatsApp.
      */}
      {role === "client" && <JobPhotoUpload jobId={job.id} photos={bp} />}

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
          photos={bp}
        />
      )}

      <Outstanding items={outstanding} otherSideLabel={otherSideLabel} />

      <JobProgress phases={phases} />

      <StageRail
        stages={railStages}
        current={current}
        viewing={viewing}
        base={"/portal/jobs/" + encodeURIComponent(job.id)}
      />

      <PackStageProgress
        stage={currentPackStage}
        amountDue={amountDue}
        timelinePhases={timelinePhases}
        packHref={jobBase + "/pack"}
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

      {tab === "money" && (
        <>
        <StageLedger
          stages={ledgerStages}
          side={role === "worker" ? "worker" : "client"}
          jobBase={jobBase}
        />
        <MoneyPanel
          side={role === "worker" ? "worker" : "client"}
          labour={labour}
          materials={won?.materials_jmd ?? null}
          fee={feeJmd}
          allIn={allIn}
          takeHome={takeHome}
          invoices={invoices}
          money={money}
        />
        </>
      )}

      {tab === "documents" && (
        <>
      <DocStrip docs={docs} />

      {(pk.length > 0 || qs.some((q) => ["quote_confirmed", "kickoff_requested", "accepted"].includes(q.status ?? ""))) && (
        <section className="mt-8">
          <h2 className="mb-4 text-[10.5px] font-bold uppercase tracking-[.2em] text-tealb">
            Documents
          </h2>
          <ul className="grid gap-3">
            {qs
              .filter((q) => ["quote_confirmed", "kickoff_requested", "accepted"].includes(q.status ?? ""))
              .map((q) => (
                <li key={"qp-" + q.id}>
                  <Link
                    href={"/portal/jobs/" + encodeURIComponent(job.id) + "/quote-pack?quote=" + encodeURIComponent(q.id)}
                    className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-panel px-4 py-3.5 transition hover:border-teal"
                  >
                    <b className="text-[14px]">Quote Pack</b>
                    <span className="text-[12.5px] text-dim">{q.worker_name}</span>
                    <span className="ml-auto rounded-full border border-softline bg-soft px-2.5 py-1 text-[10.5px] font-bold text-tealb">
                      {q.status}
                    </span>
                  </Link>
                </li>
              ))}
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
      {job.worker_email && job.status !== "complete" && (
        <ArrivalCheckIn
          jobId={job.id}
          role={role === "worker" ? "worker" : "client"}
          stage={Math.max(job.stage ?? 0, 1)}
          checkedInToday={checkedInToday}
          recent={recentArrivals}
        />
      )}
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

      {chooseOpen && qs.length > 0 && (
        <section className="mt-8 rounded-2xl border border-line2 bg-panel p-4">
          <h2 className="mb-1 text-[10.5px] font-bold uppercase tracking-[.2em] text-tealb">
            How choosing works
          </h2>
          <p className="max-w-[62ch] text-[13px] leading-relaxed text-mute">
            {role === "client"
              ? "Ask any price below for a Kickoff Pack: scope of work and payment terms, written against that worker's own quote. You can do this for more than one at once and compare the documents. Choosing unlocks once you and that worker have both confirmed a pack."
              : "Once the client asks for a Kickoff Pack against your price, it is drafted here and you confirm your side. They can compare more than one before choosing."}
          </p>
        </section>
      )}

      {qs.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-4 text-[10.5px] font-bold uppercase tracking-[.2em] text-tealb">
            Quotes · {qs.length}
          </h2>
          <ul className="grid gap-3">
            {qs.map((q) => {
              const myPack = pk.find((p) => p.quote_id === q.id);
              const packReady = myPack?.status === "approved";
              const packConfirmed = !!myPack?.both_confirmed_at;
              return (
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

                {(q.scope_summary || q.included_note || q.excluded_note || q.timeline_note || q.payment_stage_note) && (
                  <div className="mt-3 grid gap-2.5 border-t border-line pt-3 text-[12.5px] leading-relaxed">
                    {q.scope_summary && (
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-[.14em] text-dim">Scope</p>
                        <p className="mt-1 whitespace-pre-wrap text-mute">{q.scope_summary}</p>
                      </div>
                    )}
                    {(q.included_note || q.excluded_note) && (
                      <div className="grid gap-2.5 sm:grid-cols-2">
                        {q.included_note && (
                          <div>
                            <p className="text-[10px] font-bold uppercase tracking-[.14em] text-dim">Included</p>
                            <p className="mt-1 whitespace-pre-wrap text-mute">{q.included_note}</p>
                          </div>
                        )}
                        {q.excluded_note && (
                          <div>
                            <p className="text-[10px] font-bold uppercase tracking-[.14em] text-dim">Excluded</p>
                            <p className="mt-1 whitespace-pre-wrap text-mute">{q.excluded_note}</p>
                          </div>
                        )}
                      </div>
                    )}
                    {q.timeline_note && (
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-[.14em] text-dim">Timeline</p>
                        <p className="mt-1 whitespace-pre-wrap text-mute">{q.timeline_note}</p>
                      </div>
                    )}
                    {q.payment_stage_note && (
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-[.14em] text-dim">Payment stages</p>
                        <p className="mt-1 whitespace-pre-wrap text-mute">{q.payment_stage_note}</p>
                      </div>
                    )}
                  </div>
                )}

                {role === "client" && chooseOpen && q.status === "submitted" && clientAlreadyConfirming.has(q.id) && (
                  <p className="mt-3 text-[12.5px] leading-relaxed text-dim">
                    You&apos;ve already confirmed this price over WhatsApp. Waiting on {q.worker_name} to confirm their
                    side, no Kickoff Pack needed unless you ask for one.
                  </p>
                )}

                {role === "client" && chooseOpen && q.status === "submitted" && !clientAlreadyConfirming.has(q.id) && (
                  <form action={requestKickoff} className="mt-3">
                    <input type="hidden" name="jobId" value={job.id} />
                    <input type="hidden" name="quoteId" value={q.id} />
                    <button className="rounded-full bg-linear-to-r from-teal to-mango px-4 py-2 text-[13px] font-bold text-[#04211D]">
                      Get a Kickoff Pack for this price
                    </button>
                  </form>
                )}

                {/* Both sides confirmed the price itself over WhatsApp (2 Sep
                    2026), no Kickoff Pack involved: the lighter route to
                    booking, same booking form as the Kickoff Pack path below
                    since choose_worker() now accepts either a confirmed
                    quote or a confirmed pack. */}
                {role === "client" && chooseOpen && q.status === "quote_confirmed" && (
                  <form action={chooseQuote} className="mt-3">
                    <input type="hidden" name="jobId" value={job.id} />
                    <input type="hidden" name="quoteId" value={q.id} />
                    <button className="rounded-full bg-linear-to-r from-teal to-mango px-4 py-2 text-[13px] font-bold text-[#04211D]">
                      Skip the Kickoff Pack, book {q.worker_name} now
                    </button>
                    <p className="mt-1.5 max-w-[46ch] text-[11.5px] leading-snug text-dim">
                      Both sides already confirmed this price over WhatsApp. This books the job on that alone.
                    </p>
                  </form>
                )}
                {role === "client" && chooseOpen && q.status === "quote_confirmed" && (
                  <form action={requestKickoff} className="mt-2">
                    <input type="hidden" name="jobId" value={job.id} />
                    <input type="hidden" name="quoteId" value={q.id} />
                    <button className="rounded-full border border-line2 px-3.5 py-1.5 text-[12px] font-bold text-mute transition hover:border-teal hover:text-tealb">
                      Or get a Kickoff Pack first
                    </button>
                  </form>
                )}

                {role === "client" && chooseOpen && q.status === "kickoff_requested" && (
                  <div className="mt-3">
                    {!myPack && (
                      <span className="inline-block rounded-full border border-line bg-panel2 px-3.5 py-2 text-[12px] font-bold text-dim">
                        Kickoff Pack being written
                      </span>
                    )}
                    {myPack && !packReady && (
                      <span className="inline-block rounded-full border border-line bg-panel2 px-3.5 py-2 text-[12px] font-bold text-dim">
                        Kickoff Pack drafted, awaiting review
                      </span>
                    )}
                    {myPack && packReady && !packConfirmed && (
                      <>
                        <Link
                          href={"/portal/jobs/" + encodeURIComponent(job.id) + "/pack?quote=" + encodeURIComponent(q.id)}
                          className="inline-block rounded-full border border-teal bg-soft px-3.5 py-2 text-[12px] font-bold text-tealb"
                        >
                          Read and confirm the Kickoff Pack &rarr;
                        </Link>
                        <p className="mt-1.5 max-w-[46ch] text-[11.5px] leading-snug text-dim">
                          Choosing unlocks once you and {q.worker_name} have both confirmed it.
                        </p>
                      </>
                    )}
                    {myPack && packReady && packConfirmed && (
                      <form action={chooseQuote}>
                        <input type="hidden" name="jobId" value={job.id} />
                        <input type="hidden" name="quoteId" value={q.id} />
                        <button className="rounded-full bg-linear-to-r from-teal to-mango px-4 py-2 text-[13px] font-bold text-[#04211D]">
                          Choose {q.worker_name} for the job
                        </button>
                        <p className="mt-1.5 max-w-[46ch] text-[11.5px] leading-snug text-dim">
                          Both sides have confirmed this Kickoff Pack. Choosing books the job.
                        </p>
                      </form>
                    )}
                  </div>
                )}
              </li>
              );
            })}
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
      {/* The FAQ's own "or": at sign-off a client can approve straight off
          the evidence above, or ask to walk the site live instead. Sits next
          to the moment it is an alternative to, not buried in a settings
          tab. */}
      {/* A job completing (stage >= 5) has nothing to do with whether a
          walkthrough's notes are confirmed yet. The panel stays available
          once a walkthrough is in play so an unconfirmed set of notes is
          never stranded off-screen; it only stops offering a fresh
          request once the job is done. */}
      {job.worker_email && (job.status !== "complete" || job.signoff_method === "walkthrough") && (
        <WalkthroughPanel
          jobId={job.id}
          role={role === "worker" ? "worker" : "client"}
          walkPlatform={job.walk_platform ?? null}
          walkLink={job.walk_link ?? null}
          walkDate={job.walk_date ?? null}
          walkWho={job.walk_who ?? null}
          walkNotes={job.walk_notes ?? null}
          walkCallNotes={job.walk_call_notes ?? null}
          walkNotesConfirmedAt={job.walk_notes_confirmed_at ?? null}
        />
      )}
      {job.status !== "complete" && (
        <EvidenceUpload
          jobId={job.id}
          maxStage={stages.length}
          storeType={job.materials_store_type ?? null}
          store={job.materials_store ?? null}
        />
      )}
      {/* Video is a worker thing. A stage walkthrough is the worker proving
          their own work; the photo form above stays open to both sides,
          unchanged, because that question was never Stage 5.5's to answer. */}
      {job.status !== "complete" && role === "worker" && (
        <VideoEvidenceUpload
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
