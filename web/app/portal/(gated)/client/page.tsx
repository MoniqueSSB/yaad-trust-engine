import Link from "next/link";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { JobList, CLIENT_STATUS, type Job } from "@/components/portal/JobList";
import {
  jobGates,
  stillWaiting,
  CG_VERSION,
  type GateJob,
} from "@/lib/portal/gates";

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
      "id,title,trade,parish,stage,status,client_email,worker_email,updated_at,open,materials_store,materials_store_type",
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

  /* The signature that opens the board, at the exact version in force. A
     signature on an older version is not a signature for this purpose:
     client_go_live() compares doc_version with =, so "signed, but 1.2" and
     "never signed" are the same answer to Postgres and must be the same
     answer here. Same query as the job room, on purpose. */
  const { data: cgSig } = await supabase
    .from("doc_signatures")
    .select("id")
    .eq("doc_type", "client_guidelines")
    .eq("doc_version", CG_VERSION)
    .ilike("signer_email", email)
    .limit(1)
    .maybeSingle();

  const emailConfirmed = !!user.email_confirmed_at;
  const signed = !!cgSig;

  /* Jobs the checklist still has something to say about: not on the board,
     and not moved past it. A job with a worker on it is not "not live". */
  const waiting = (jobs as GateJob[]).filter(stillWaiting);

  const gatesFor = (j: GateJob) =>
    jobGates({
      job: j,
      jobBase: "/portal/jobs/" + encodeURIComponent(j.id),
      emailConfirmed,
      signed,
    });

  /* Account gates are the same answer for every job, so they are counted once
     and shown once. Reprinting "confirm your email" under each of four jobs
     would read as four separate problems. */
  const accountOutstanding = waiting.length
    ? gatesFor(waiting[0]).filter((g) => g.scope === "account" && !g.done)
    : [];

  const jobOutstanding = waiting
    .map((j) => ({
      job: jobs.find((x) => x.id === j.id)!,
      gates: gatesFor(j).filter((g) => g.scope === "job" && !g.done),
    }))
    .filter((x) => x.gates.length > 0);

  const todo = accountOutstanding.length + jobOutstanding.length;

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
        The list, at the top, on the way in.

        This used to be prose: it named the three conditions in a sentence and
        sent the reader into a job to find out which ones applied to them. That
        is a description of the problem, not the answer to it. Somebody opening
        the portal is asking one question, "what do I have to do", and they
        should not have to open anything to get it.

        Every gate is computed by lib/portal/gates.ts, the same module the job
        room uses, so the two screens cannot disagree about what is left. A
        checklist that contradicts itself between pages is worse than none: the
        reader cannot tell which page is lying.

        Account gates once, job gates per job. That distinction is the thing
        people get wrong, and printing "confirm your email" under each of four
        jobs would read as four separate problems rather than one.
      */}
      {todo > 0 && (
        <section className="mt-6 rounded-2xl border border-mango/30 bg-mango/10 p-5">
          <h2 className="font-display text-[18px] uppercase leading-none">
            {waiting.length === 1
              ? "Your job is not on the marketplace yet"
              : `${waiting.length} of your jobs are not on the marketplace yet`}
          </h2>
          <p className="mt-3 max-w-[62ch] text-[13.5px] leading-relaxed text-mute">
            No tradesperson can see{" "}
            {waiting.length === 1 ? "it" : "them"} until this list is done.
            Nothing is charged, and you are not committing to any quote.
          </p>

          <ol className="mt-4 grid gap-2.5">
            {accountOutstanding.map((g) => (
              <li
                key={g.title}
                className="rounded-xl border border-softline bg-soft px-3.5 py-3"
              >
                <b className="text-[13.5px]">{g.title}</b>
                <p className="mt-1 text-[12.5px] leading-relaxed text-mute">
                  {g.why}
                </p>
                {g.href && (
                  <Link
                    href={g.href}
                    className="mt-2.5 inline-flex rounded-full bg-linear-to-r from-teal to-mango px-4 py-2 text-[12.5px] font-bold text-[#04211D] transition hover:brightness-110"
                  >
                    {g.cta ?? "Do this"}
                  </Link>
                )}
                {!g.href && (
                  <p className="mt-2 text-[12px] text-dim">
                    Nothing to click here. It clears itself once you open the
                    link in that email.
                  </p>
                )}
              </li>
            ))}

            {jobOutstanding.map(({ job, gates }) => (
              <li
                key={job.id}
                className="rounded-xl border border-softline bg-soft px-3.5 py-3"
              >
                <p className="text-[10.5px] font-bold uppercase tracking-[.18em] text-tealb">
                  {job.title ?? job.id}
                </p>
                {gates.map((g) => (
                  <div key={g.title} className="mt-1.5">
                    <b className="text-[13.5px]">{g.title}</b>
                    <p className="mt-1 text-[12.5px] leading-relaxed text-mute">
                      {g.why}
                    </p>
                    {g.href && (
                      <Link
                        href={g.href}
                        className="mt-2.5 inline-flex rounded-full bg-linear-to-r from-teal to-mango px-4 py-2 text-[12.5px] font-bold text-[#04211D] transition hover:brightness-110"
                      >
                        {g.cta ?? "Do this"}
                      </Link>
                    )}
                  </div>
                ))}
              </li>
            ))}
          </ol>

          {accountOutstanding.length > 0 && jobOutstanding.length > 0 && (
            <p className="mt-3.5 text-[12.5px] leading-relaxed text-dim">
              The first{" "}
              {accountOutstanding.length === 1 ? "item is" : "items are"} done
              once and cover every job you have. The rest are per job, because
              the answer is about that property.
            </p>
          )}
        </section>
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
