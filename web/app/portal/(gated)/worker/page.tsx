import { redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { JobList, WORKER_STATUS, type Job } from "@/components/portal/JobList";
import { MoneySplit, WorkerPipeline, WorkerStatCards, type StatCard } from "@/components/portal/WorkerOverview";
import { WorkerMoneyPanel, type MoneyJob } from "@/components/portal/WorkerMoneyPanel";
import { WorkerInvoices, type WorkerInvoiceJob } from "@/components/portal/WorkerInvoices";
import { LinkWorkerPhone } from "@/components/portal/LinkWorkerPhone";
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
      "id,title,trade,parish,addr,stage,status,client_email,worker_email,updated_at,pay_method,pay_ref",
    )
    .order("updated_at", { ascending: false });

  const { data: profile } = await supabase
    .from("worker_profiles")
    .select("phone")
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
  type WorkerJob = Job & { pay_method: string | null; pay_ref: string | null };
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
    .select("id,job_id,stage,period_label,total_pence,status,sent_at")
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
            note: "Paid straight to you by bank transfer, Lynk or cash, within 3 working days",
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
        Paid within 3 working days of the client approving.
      </p>

      {error && (
        <p
          role="alert"
          className="mt-6 rounded-xl border border-coral/30 bg-coral/10 px-4 py-3 text-[13px] text-mute"
        >
          Could not load your jobs: {error.message}
        </p>
      )}

      <WorkerStatCards cards={cards} />

      <MoneySplit
        held={held}
        released={released}
        heldLabel="Held"
        releasedLabel="Released"
      />

      <WorkerPipeline jobs={live} labels={WORKER_STATUS} />

      {/* Two columns on a wide screen: the work on the left, because that is
          what changes day to day, and the money trail on the right beside it.
          On a phone they stack in the same order, work first. */}
      <div className="grid gap-x-6 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <div>
          <JobList
            title="Live work"
            jobs={live}
            labels={WORKER_STATUS}
            rail
            empty="Nothing live right now. Jobs you are matched to or have quoted on appear here."
          />

          {done.length > 0 && (
            <JobList title="Completed" jobs={done} labels={WORKER_STATUS} rail />
          )}

          {closedQuotes.length > 0 && (
            <JobList title="Quotes that closed" jobs={closedQuotes} labels={WORKER_STATUS} rail />
          )}
        </div>

        <aside>
          <WorkerMoneyPanel jobs={moneyJobs} />

          <WorkerInvoices jobs={invoiceJobs} />

          {/* LinkWorkerPhone brings its own mt-4; together that is the mt-8
              every other section in this column starts with. */}
          <div className="mt-4">
            <LinkWorkerPhone phone={profile?.phone ?? null} />
          </div>
        </aside>
      </div>
    </>
  );
}
