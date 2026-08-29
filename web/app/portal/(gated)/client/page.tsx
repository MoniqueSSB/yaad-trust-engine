import Link from "next/link";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { JobList, CLIENT_STATUS, type Job } from "@/components/portal/JobList";

// Never cached. A portal showing a stale job is worse than a slow one.
export const dynamic = "force-dynamic";

/**
 * The client portal.
 *
 * Deliberately a different product from the worker portal, not one page with
 * two lists on it. A client is asking "where is my money and what is waiting
 * on me". A worker is asking "what have I won and when do I get paid". Those
 * are different questions, different urgency and different wording for the
 * same status value, and putting them on one screen served neither.
 *
 * Professional services live here too: somebody who bought a Deposit
 * Protection Check is a client, even though they never posted a job.
 */
export default async function ClientPortal() {
  const user = await getUser();
  if (!user) redirect("/portal/sign-in");

  const supabase = await createClient();

  // No .eq() on email. Row level security already limits this to jobs where
  // the signed-in email is a party. If the filter lived in this file, a
  // mistake in this file would be a data leak. In Postgres it is a short list.
  const { data, error } = await supabase
    .from("jobs")
    .select(
      "id,title,trade,parish,stage,status,client_email,worker_email,updated_at",
    )
    .order("updated_at", { ascending: false });

  const { data: svcData } = await supabase
    .from("services")
    .select("id,type,parish,price,stage,updated_at")
    .order("updated_at", { ascending: false });

  const email = (user.email ?? "").toLowerCase();
  const jobs = ((data ?? []) as Job[]).filter(
    (j) => j.client_email?.toLowerCase() === email,
  );
  const services = (svcData ?? []) as {
    id: string;
    type: string | null;
    parish: string | null;
    price: string | null;
  }[];

  const waitingOnSetup = jobs.filter(
    (j) => j.status === "awaiting_client_setup",
  ).length;

  return (
    <>
      <p className="text-[10.5px] font-bold uppercase tracking-[.2em] text-tealb">
        Client portal
      </p>
      <h1 className="mt-2 font-display text-[clamp(26px,4vw,38px)] uppercase leading-none">
        Your jobs and your money
      </h1>
      <p className="mt-3 max-w-[62ch] text-[14px] leading-relaxed text-mute">
        Everything here is scoped to you by the database, not by this page. Money
        moves when you approve the evidence, and not before.
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
        The first screen after signing in, and the right place to say the one
        thing standing between every one of these jobs and a tradesperson.

        Each of them carries the badge "Waiting on your portal setup", which
        names a state and leaves the reader to work out the action. There is
        only one action, it clears all of them at once, and nothing said so.
      */}
      {waitingOnSetup > 0 && (
        <div className="mt-6 rounded-2xl border border-mango/30 bg-mango/10 p-5">
          <h2 className="font-display text-[18px] uppercase leading-none">
            {waitingOnSetup === 1
              ? "One job is waiting on you"
              : `${waitingOnSetup} jobs are waiting on you`}
          </h2>
          <p className="mt-3 text-[13.5px] leading-relaxed text-mute">
            Sign the Client Guidelines and{" "}
            {waitingOnSetup === 1 ? "it goes" : "they all go"} live together.
            They set out what Yaadly does, what it charges, and what happens if
            the work is wrong. Nothing reaches a tradesperson until you have
            agreed to them, which is the point of them.
          </p>
          <p className="mt-2.5 text-[13.5px] leading-relaxed text-mute">
            Nothing is charged, and you are not committing to any quote.
          </p>
          <Link
            href="/portal/guidelines"
            className="mt-4 inline-flex rounded-full bg-linear-to-r from-teal to-mango px-5 py-2.5 text-[13px] font-bold text-[#04211D] transition hover:brightness-110"
          >
            Read and sign the Client Guidelines
          </Link>
        </div>
      )}

      <JobList
        title="Your jobs"
        jobs={jobs}
        labels={CLIENT_STATUS}
        empty="When a job is set up for you it appears here, with its evidence and its documents. If you have posted one and cannot see it, it is probably still a draft."
      />

      {services.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-[10.5px] font-bold uppercase tracking-[.2em] text-mango">
            Professional services
          </h2>
          <ul className="grid gap-3">
            {services.map((s) => (
              <li key={s.id}>
                <Link
                  href={"/portal/services/" + encodeURIComponent(s.id)}
                  className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-panel px-4 py-3.5 transition hover:border-line2"
                >
                  <b className="text-[14.5px]">{s.type ?? "Service"}</b>
                  <span className="text-[12.5px] text-dim">{s.id}</span>
                  {s.parish && (
                    <span className="text-[12.5px] text-dim">{s.parish}</span>
                  )}
                  {s.price && (
                    <span className="ml-auto text-[13px] font-bold text-tealb">
                      {s.price}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
