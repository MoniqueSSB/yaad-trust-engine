import { redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { JobList, WORKER_STATUS, type Job } from "@/components/portal/JobList";
import { PortalTiles, type Tile } from "@/components/portal/PortalTiles";
import { WorkerMoneyPanel, type MoneyJob } from "@/components/portal/WorkerMoneyPanel";
import { LinkWorkerPhone } from "@/components/portal/LinkWorkerPhone";

// Never cached. A portal showing a stale job is worse than a slow one.
export const dynamic = "force-dynamic";

const jmd = (n: number) => "J$" + Math.round(n).toLocaleString("en-JM");

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
 * 88%-plus-materials arithmetic FeeBreakdown.tsx already shows per job,
 * summed across every job this worker has actually won.
 */
export default async function WorkerPortal() {
  const user = await getUser();
  if (!user) redirect("/portal/sign-in");

  const supabase = await createClient();

  // No .eq() on email. Row level security scopes this already; a filter here
  // would mean a mistake in this file is a data leak rather than a short list.
  const { data, error } = await supabase
    .from("jobs")
    .select(
      "id,title,trade,parish,stage,status,client_email,worker_email,updated_at,pay_method,pay_ref",
    )
    .order("updated_at", { ascending: false });

  const { data: profile } = await supabase
    .from("worker_profiles")
    .select("phone")
    .eq("worker_user", user.id)
    .maybeSingle();

  const email = (user.email ?? "").toLowerCase();
  const jobs = ((data ?? []) as (Job & { pay_method: string | null; pay_ref: string | null })[]).filter(
    (j) => j.worker_email?.toLowerCase() === email,
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
      const takeHome = Math.round(won.labour_jmd * 0.88) + (won.materials_jmd ?? 0);
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

  const held = moneyJobs.filter((j) => j.held).reduce((sum, j) => sum + j.takeHome, 0);
  const released = moneyJobs.filter((j) => !j.held).reduce((sum, j) => sum + j.takeHome, 0);

  const tiles: Tile[] = [
    {
      label: "Held right now",
      value: jmd(held),
      held: held > 0,
      note: held > 0 ? "Released once each client approves" : "Nothing held right now",
    },
    {
      label: "Released",
      value: jmd(released),
      note: "Paid off-platform within 3 working days of release",
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

      {moneyJobs.length > 0 && <PortalTiles tiles={tiles} />}

      <LinkWorkerPhone phone={profile?.phone ?? null} />

      <WorkerMoneyPanel jobs={moneyJobs} />

      <JobList
        title="Live work"
        jobs={live}
        labels={WORKER_STATUS}
        empty="Nothing live right now. Jobs you are matched to or have quoted on appear here."
      />

      {done.length > 0 && (
        <JobList title="Completed" jobs={done} labels={WORKER_STATUS} />
      )}
    </>
  );
}
