import Link from "next/link";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { type Job } from "@/components/portal/JobList";

// Never cached. A portal showing a stale job is worse than a slow one.
export const dynamic = "force-dynamic";

/**
 * The door, not a portal in itself.
 *
 * The client portal and the worker portal are two separate products. This page
 * only decides which one you are looking for. Most people are one or the
 * other, so they never see this screen: they land on their portal directly.
 * Somebody who is both, a tradesperson who has also hired somebody, gets to
 * choose rather than being shown two lists stacked on one page.
 */
export default async function PortalDoor() {
  const user = await getUser();
  if (!user) redirect("/portal/sign-in");

  const supabase = await createClient();
  const { data } = await supabase
    .from("jobs")
    .select("id,client_email,worker_email,status")
    .order("updated_at", { ascending: false });

  const { data: svc } = await supabase.from("services").select("id");

  const email = (user.email ?? "").toLowerCase();
  const jobs = (data ?? []) as Job[];
  const asClient = jobs.filter((j) => j.client_email?.toLowerCase() === email);
  const asWorker = jobs.filter((j) => j.worker_email?.toLowerCase() === email);
  const hasServices = (svc ?? []).length > 0;

  const isClient = asClient.length > 0 || hasServices;
  const isWorker = asWorker.length > 0;

  // One role only: skip the door entirely.
  if (isClient && !isWorker) redirect("/portal/client");
  if (isWorker && !isClient) redirect("/portal/worker");

  return (
    <>
      <p className="text-[10.5px] font-bold uppercase tracking-[.2em] text-tealb">
        Portals
      </p>
      <h1 className="mt-2 font-display text-[clamp(26px,4vw,38px)] uppercase leading-none">
        Which one today?
      </h1>
      <p className="mt-3 max-w-[62ch] text-[14px] leading-relaxed text-mute">
        You are on jobs as both a client and a tradesperson. They are separate
        portals because they answer different questions.
      </p>

      <div className="mt-7 grid gap-3 sm:grid-cols-2">
        <Link
          href="/portal/client"
          className="rounded-2xl border border-line bg-panel p-5 transition hover:border-teal"
        >
          <p className="text-[10.5px] font-bold uppercase tracking-[.2em] text-tealb">
            As a client
          </p>
          <b className="mt-2 block text-[16px]">Your jobs and your money</b>
          <p className="mt-2 text-[13.5px] leading-relaxed text-mute">
            Evidence waiting on you, documents with your signature, and what has
            been released.
          </p>
          <p className="mt-3 text-[12.5px] text-dim">
            {asClient.length} job{asClient.length === 1 ? "" : "s"}
            {hasServices ? " · services" : ""}
          </p>
        </Link>

        <Link
          href="/portal/worker"
          className="rounded-2xl border border-line bg-panel p-5 transition hover:border-teal"
        >
          <p className="text-[10.5px] font-bold uppercase tracking-[.2em] text-tealb">
            As a tradesperson
          </p>
          <b className="mt-2 block text-[16px]">Your work and your money</b>
          <p className="mt-2 text-[13.5px] leading-relaxed text-mute">
            What you are on, what each one is waiting for, and what you are owed.
          </p>
          <p className="mt-3 text-[12.5px] text-dim">
            {asWorker.length} job{asWorker.length === 1 ? "" : "s"}
          </p>
        </Link>
      </div>

      {!isClient && !isWorker && (
        <div className="mt-6 rounded-2xl border border-line bg-panel p-6">
          <b className="text-[15px]">Nothing here yet</b>
          <p className="mt-2 text-[13.5px] leading-relaxed text-mute">
            When a job is set up for you it appears here. If you have posted one
            and cannot see it, it is probably still a draft.
          </p>
        </div>
      )}
    </>
  );
}
