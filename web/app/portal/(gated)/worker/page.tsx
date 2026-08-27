import { redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { JobList, WORKER_STATUS, type Job } from "@/components/portal/JobList";

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
      "id,title,trade,parish,stage,status,client_email,worker_email,updated_at",
    )
    .order("updated_at", { ascending: false });

  const email = (user.email ?? "").toLowerCase();
  const jobs = ((data ?? []) as Job[]).filter(
    (j) => j.worker_email?.toLowerCase() === email,
  );

  const live = jobs.filter((j) => j.status !== "complete");
  const done = jobs.filter((j) => j.status === "complete");

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
