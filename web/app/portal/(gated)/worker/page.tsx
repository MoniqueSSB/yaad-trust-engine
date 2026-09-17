import { redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { JobList, WORKER_STATUS, type Job } from "@/components/portal/JobList";
import { type StatCard } from "@/components/portal/WorkerOverview";
import { StageBoard } from "@/components/portal/StageBoard";
import { WorkerRail } from "@/components/portal/PortalRail";
import { pickFocusJob } from "@/lib/portal/board";
import { payoutReadiness, type PayoutProfile } from "@/lib/portal/payout-status";
import { WorkerMoneyPanel, type MoneyJob } from "@/components/portal/WorkerMoneyPanel";
import { WorkerInvoices, type WorkerInvoiceJob } from "@/components/portal/WorkerInvoices";
import { LIVE_QUOTE, type Tender } from "@/components/portal/QuotedJobRoom";
import { jmd } from "@/lib/money";

// Never cached. A portal showing a stale job is worse than a slow one.
export const dynamic = "force-dynamic";



/**
 * The worker portal.
 *
 * A separate channel from joining. An existing tradesperson signing in to see
 * where their job is has nothing to do with somebody applying to be vetted,
 * and sending both through one door meant a worker who was already on the
 * platform was being asked to "join as a pro" to find their own work. That is
 * the bug this file exists to close.
 *
 * The status wording is the worker's, not the client's. "Evidence waiting on
 * you" is what a client needs to read; the worker on the same job needs to
 * read "evidence with the client", because for them the ball has left.
 *
 * Stage 5.6: this page has said "what you are owed" in its own copy since it
 * was written and never once shown a figure. It now leads with one, the same
 * 95%-plus-materials arithmetic FeeBreakdown.tsx already shows per job,
 * summed across every job this worker has actually won.
 */
/* A title of its own, so a client with three tabs open can tell them apart.
   Every portal screen used to fall back to the root layout's bare "Yaadly".
   Three tabs, one word, three times. */
export const metadata = { title: "Worker portal · Yaadly" };

export default async function WorkerPortal() {
  const user = await getUser();
  if (!user) redirect("/portal/sign-in");

  const supabase = await createClient();

  // No .eq() on email. Row level security scopes this already; a filter here
  // would mean a mistake in this file is a data leak rather than a short list.
  const { data, error } = await supabase
    .from("jobs")
    .select(
      "id,title,trade,parish,addr,stage,status,client_email,worker_email,updated_at,pay_method,pay_ref,job_type,size_band",
    )
    .order("updated_at", { ascending: false });

  const { data: profile } = await supabase
    .from("worker_profiles")
    .select("phone,wise_recipient_set_at,bank_callback_at,stripe_recipient_status")
    .eq("worker_user", user.id)
    .maybeSingle();

  /* A quote with no booking is not nothing: since 1 Sep 2026 a client can
     accept it (ask for a Kickoff Pack) well before choosing anyone, and that
     worker has real work to do in the meantime (read it, confirm it).

     Since 13 Sep 2026 those jobs do not come from the jobs query above at
     all. Row level security returns a jobs row to the booked worker and
     nobody else, so the jobs this worker has only quoted on come from
     my_quoted_jobs(), the tender pack: title, parish, trade, status, and no
     address or client column to leak. Founder's decision the same day: a
     worker whose quote closed still sees the job, listed on its own as a
     closed quote, so it reads as what happened to them rather than as live
     work on a job that is now somebody else's. */
  const { data: tenderRows } = await supabase.rpc("my_quoted_jobs");

  const email = (user.email ?? "").toLowerCase();
  type WorkerJob = Job & { pay_method: string | null; pay_ref: string | null; job_type?: string | null; size_band?: string | null };
  // The filter stays although RLS already scopes the query: an admin, or a
  // worker who is also somebody's client, gets rows here that are not work.
  const booked = ((data ?? []) as WorkerJob[]).filter((j) => j.worker_email?.toLowerCase() === email);
  const bookedIds = new Set(booked.map((j) => j.id));
  const quoted: WorkerJob[] = ((tenderRows ?? []) as Tender[])
    .filter((t) => !bookedIds.has(t.id))
    .map((t) => ({
      id: t.id,
      title: t.title,
      trade: t.trade,
      parish: t.parish,
      stage: t.stage,
      status: LIVE_QUOTE.has(t.quote_status ?? "")
        ? t.status
        : t.quote_status === "withdrawn"
          ? "withdrawn"
          : "not_selected",
      client_email: null,
      worker_email: null,
      updated_at: t.updated_at,
      addr: null,
      addr_hidden: true,
      pay_method: null,
      pay_ref: null,
    }));
  const closedQuotes = quoted.filter((j) => j.status === "not_selected" || j.status === "withdrawn");
  const jobs = [...booked, ...quoted.filter((j) => !closedQuotes.includes(j))].sort((a, b) =>
    String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? "")),
  );

  const live = jobs.filter((j) => j.status !== "complete");
  const done = jobs.filter((j) => j.status === "complete");

  /* Money only exists on a job once a quote has actually been accepted; a
     job still open for quotes has nothing to compute. Same query shape as
     the job room page's own won-quote lookup. */
  const jobIds = jobs.map((j) => j.id);
  const { data: quotes } = jobIds.length
    ? await supabase
        .from("job_quotes")
        .select("job_id,labour_jmd,materials_jmd")
        .in("job_id", jobIds)
        .eq("status", "accepted")
    : { data: [] as { job_id: string; labour_jmd: number | null; materials_jmd: number | null }[] };

  const wonByJob = new Map((quotes ?? []).map((q) => [q.job_id, q]));

  const moneyJobs: MoneyJob[] = jobs
    .map((j) => {
      const won = wonByJob.get(j.id);
      if (!won || won.labour_jmd == null) return null;
      const takeHome = Math.round(won.labour_jmd * 0.95) + (won.materials_jmd ?? 0);
      return {
        id: j.id,
        title: j.title,
        takeHome,
        held: j.status !== "complete",
        payMethod: j.pay_method,
        payRef: j.pay_ref,
      };
    })
    .filter((x): x is MoneyJob => x !== null);

  // The real document trail, not the computed estimate above: the actual
  // invoices raised in this worker's own name (20260902n), job by job. No
  // .eq() on worker_email for the same reason as the jobs query: RLS
  // (invoices_worker_read) already scopes this to the signed-in worker.
  const { data: myInvoices } = await supabase
    .from("invoices")
    .select("id,job_id,stage,period_label,total_pence,status,sent_at,paid_at,paid_method,paid_reference")
    .eq("payable_to", "worker")
    .neq("status", "void")
    .order("stage", { ascending: true, nullsFirst: true });

  // The page's own `jobs` list is scoped to this worker's live/won stake
  // (jobs.worker_email, or a still-live quote); an invoice's own job_id can
  // fall outside that on a seeded/older row, so its title is looked up
  // directly rather than assumed present in that narrower list.
  const invoiceJobIds = Array.from(new Set((myInvoices ?? []).map((i) => i.job_id).filter((x): x is string => !!x)));
  const jobTitleById = new Map(jobs.map((j) => [j.id, j.title]));
  const missingTitleIds = invoiceJobIds.filter((id) => !jobTitleById.has(id));
  if (missingTitleIds.length) {
    const { data: extraJobs } = await supabase.from("jobs").select("id,title").in("id", missingTitleIds);
    for (const j of extraJobs ?? []) jobTitleById.set(j.id, j.title);
  }
  const payMethodByJob = new Map(jobs.map((j) => [j.id, Boolean((j as { pay_method: string | null }).pay_method)]));
  const invoicesByJob = new Map<string, WorkerInvoiceJob["invoices"]>();
  for (const inv of myInvoices ?? []) {
    const list = invoicesByJob.get(inv.job_id!) ?? [];
    list.push({
      id: inv.id,
      stage: inv.stage,
      periodLabel: inv.period_label || (inv.stage ? "Stage " + inv.stage : "Work completed"),
      totalPence: inv.total_pence,
      status: inv.status,
      sentAt: inv.sent_at,
      paidAt: inv.paid_at,
      paidMethod: inv.paid_method,
      paidRef: inv.paid_reference,
    });
    invoicesByJob.set(inv.job_id!, list);
  }
  const invoiceJobs: WorkerInvoiceJob[] = Array.from(invoicesByJob.entries()).map(
    ([jobId, invoices]) => ({
      jobId,
      jobTitle: jobTitleById.get(jobId) ?? null,
      paid: payMethodByJob.get(jobId) ?? false,
      invoices,
    }),
  );

  /* Founder, 16 Sep 2026: every row says what the work is, what the worker's
     money on it is, and what is outstanding, and the card opens that exact
     section of the job. The "next" map is the worker's side of each status;
     the client has different work to do at the same points. */
  const moneyById = new Map(moneyJobs.map((m) => [m.id, m]));
  const jobHref = (id: string, tail: string) => "/portal/jobs/" + encodeURIComponent(id) + tail;
  const nextFor = (j: (typeof jobs)[number]): { label: string; href: string } | null => {
    switch (j.status) {
      case "open":
      case "open_for_quotes":
        return { label: "Send your price", href: jobHref(j.id, "?tab=scope#quotes") };
      case "quoted":
        return { label: "Waiting on the client to choose", href: jobHref(j.id, "?tab=scope#quotes") };
      case "awaiting_payment":
        return { label: "Nothing yet: the job goes live once the client has paid", href: jobHref(j.id, "?tab=overview") };
      case "confirmed":
        return { label: "Confirm the Kickoff Pack, then log your arrival", href: jobHref(j.id, "/pack") };
      case "in_progress":
        return { label: "Send tonight's Midnight Work-Log", href: jobHref(j.id, "?tab=evidence#upload") };
      case "evidence":
        return { label: "Your evidence is with the client", href: jobHref(j.id, "?tab=evidence#stage-evidence") };
      case "complete":
        return { label: "See what you were paid", href: jobHref(j.id, "?tab=approvals#invoices") };
      default:
        return null;
    }
  };
  const describe = (j: (typeof jobs)[number]) => {
    const m = moneyById.get(j.id);
    const work = [j.job_type, j.size_band].filter((x): x is string => Boolean(x)).join(", ") || j.trade || null;
    const money = m ? jmd(m.takeHome) + (m.held ? ", held until the job is signed off" : ", released") : null;
    return { ...j, work, money, next: nextFor(j) };
  };
  const liveRows = live.map(describe);
  const doneRows = done.map(describe);
  const closedRows = closedQuotes.map(describe);

  const heldJobs = moneyJobs.filter((j) => j.held);
  const held = heldJobs.reduce((sum, j) => sum + j.takeHome, 0);
  const released = moneyJobs.filter((j) => !j.held).reduce((sum, j) => sum + j.takeHome, 0);

  /* What the held figure is actually waiting on, named.
     "Released once each client approves" is true and tells a worker nothing
     they can act on: not which job, not how many, not whether the ball is with
     them or with somebody else. A tradesperson looking at a number with their
     name on it wants to know who is holding it up. Naming the single job when
     there is one is the common case and the useful one.

     Reworded 4 Sep 2026: it used to say "waiting on the client to approve",
     which pointed a worker at the wrong party. The worker is Yaadly's
     subcontractor, so Yaadly owes them and Yaadly pays them. The client
     accepting the work is one input to that sign-off, not the thing that
     pays. See docs/COPY-GUIDELINES.md section 3. */
  const heldNote =
    heldJobs.length === 0
      ? "Nothing held right now"
      : heldJobs.length === 1
        ? `Waiting on sign-off for ${heldJobs[0].title ?? "this job"}`
        : `Waiting on sign-off for ${heldJobs.length} jobs. See job by job below.`;

  /* The dashboard's figure row, 13 Sep 2026. The two money cards carry the
     same values and the same notes the old two-tile strip carried, word for
     word. The two job counts are the lengths of the lists further down. */
  const cards: StatCard[] = [
    ...(moneyJobs.length > 0
      ? ([
          {
            label: "Held right now",
            value: jmd(held),
            tone: held > 0 ? "waiting" : "idle",
            icon: "held",
            note: heldNote,
          },
          {
            label: "Released",
            /* "Paid off-platform" was honest and meant nothing to the person
               reading it. Say the thing itself: how it comes, and how long.
               Nothing here claims the money has moved; WorkerInvoices says
               that, carefully. */
            value: jmd(released),
            tone: released > 0 ? "done" : "idle",
            icon: "released",
            note: "Paid straight to you by bank transfer, within 7 days. Never cash.",
          },
        ] satisfies StatCard[])
      : []),
    {
      label: "Live jobs",
      value: String(live.length),
      tone: live.length > 0 ? "moving" : "idle",
      icon: "live",
      note: live.length === 0 ? "Nothing on the go" : "Matched to you or quoted on",
    },
    {
      label: "Completed",
      value: String(done.length),
      tone: done.length > 0 ? "done" : "idle",
      icon: "done",
      note: done.length === 0 ? "None closed yet" : "Paid and closed",
    },
  ];

  const focus = pickFocusJob(liveRows, (j) => WORKER_STATUS[j.status]?.tone === "waiting", "worker");
  const payout = payoutReadiness((profile ?? null) as PayoutProfile | null);

  return (
    <>
      <p className="text-[10.5px] font-bold uppercase tracking-[.2em] text-tealb">
        Worker portal
      </p>
      <h1 className="mt-2 font-display text-[clamp(26px,4vw,38px)] uppercase leading-none">
        Your work and your money
      </h1>
      <p className="mt-3 max-w-[62ch] text-[14px] leading-relaxed text-mute">
        The jobs you are on, what each one is waiting for, and what you are owed.
        Paid within 7 days of Yaadly signing the stage off.
      </p>

      {error && (
        <p
          role="alert"
          className="mt-6 rounded-xl border border-coral/30 bg-coral/10 px-4 py-3 text-[13px] text-mute"
        >
          Could not load your jobs: {error.message}
        </p>
      )}

      {/*
        The same layout as the client portal, 17 Sep 2026, from the Portal
        Overview design: the work by stage on the left, the panel on the right
        (WorkerRail: the job to act on first, the money and job counts, the
        held and released bar, and where the worker stands on being paid). On
        a phone the panel comes first, where the figures have always been.

        The board replaced the pill strip and the live then completed lists.
        Quotes that closed keep their own list under it: they are not this
        worker's work any more, and a column would read as if they were.
        The money panel and the invoice trail follow, full width, because
        they are job by job lists and need the room.
      */}
      <div className="mt-6 grid items-start gap-x-5 gap-y-2 lg:grid-cols-[minmax(0,1fr)_290px]">
        <div className="lg:order-last">
          <WorkerRail
            focus={focus}
            labels={WORKER_STATUS}
            cards={cards}
            held={held}
            released={released}
            payout={payout}
            phone={profile?.phone ?? null}
          />
        </div>

        <div className="min-w-0">
          <StageBoard
            audience="worker"
            jobs={[...liveRows, ...doneRows]}
            labels={WORKER_STATUS}
            empty="Nothing live right now. Jobs you are matched to or have quoted on appear here."
          />

          {closedQuotes.length > 0 && (
            <JobList title="Quotes that closed" jobs={closedRows} labels={WORKER_STATUS} rail />
          )}

          <WorkerMoneyPanel jobs={moneyJobs} />

          <WorkerInvoices jobs={invoiceJobs} />
        </div>
      </div>
    </>
  );
}
