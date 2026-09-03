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
/* A title of its own, so a client with three tabs open can tell them apart.
   Every portal screen used to fall back to the root layout's bare "Yaadly".
   Three tabs, one word, three times. */
export const metadata = { title: "Client portal · Yaadly" };

export default async function ClientPortal() {
  const user = await getUser();
  if (!user) redirect("/portal/sign-in");

  const supabase = await createClient();

  // No .eq() on email. Row level security already limits this to jobs where
  // the signed-in email is a party. If the filter lived in this file, a
  // mistake in this file would be a data leak. In Postgres it is a short list.
  //
  // This used to be said out loud in the page's opening line, as "everything
  // here is scoped to you by the database, not by this page". True, reassuring
  // to whoever wrote it, and meaningless to a client in London who does not
  // know what a database filter is and had not until that moment wondered
  // whether they might be shown somebody else's jobs. The reassurance a client
  // actually wants is about their money, so that is what the line says now.
  // The fact belongs here, where the person who needs it is reading.
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

  /* hasAcceptedMaterials is always false here, and that is not a shortcut.
     Every job on this page is still WAITING to go live (stillWaiting()), and
     client_go_live() only opens a job that has no worker_email yet: a quote
     cannot be accepted before a job is open, so no job on this pre-go-live
     list can possibly have an accepted quote at all. "Say where materials
     are kept" genuinely does not belong on this checklist; it belongs on
     the job room once a quote naming materials has actually been chosen,
     which is a state this list never contains. */
  const gatesFor = (j: GateJob) =>
    jobGates({
      job: j,
      jobBase: "/portal/jobs/" + encodeURIComponent(j.id),
      emailConfirmed,
      signed,
      hasAcceptedMaterials: false,
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

  /* Split rather than sorted, so the heading can say which is which. "complete"
     is the only closed status in the live jobs_status_check vocabulary; anything
     else, including disputed and cancelled, stays in the live list because it
     still has something outstanding about it. */
  const live = jobs.filter((j) => j.status !== "complete");
  const closed = jobs.filter((j) => j.status === "complete");

  return (
    <>
      <p className="text-[10.5px] font-bold uppercase tracking-[.2em] text-tealb">
        Client portal
      </p>
      <h1 className="mt-2 font-display text-[clamp(26px,4vw,38px)] uppercase leading-none">
        Your jobs and your money
      </h1>
      <p className="mt-3 max-w-[62ch] text-[14px] leading-relaxed text-mute">
        Every job you have with Yaadly, what each one is waiting for, and where
        the money is. Nothing is paid out until you have seen the evidence and
        approved it.
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
                    className="mt-2.5 inline-flex rounded-full bg-linear-to-r from-teal to-mango px-4 py-2 text-[12.5px] font-bold text-onbrand transition hover:brightness-110"
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
                        className="mt-2.5 inline-flex rounded-full bg-linear-to-r from-teal to-mango px-4 py-2 text-[12.5px] font-bold text-onbrand transition hover:brightness-110"
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

      {/*
        Live jobs first, closed ones after, rather than one list ordered by
        whatever moved last. A client with nine jobs was seeing four closed
        ones above the one that needed them, because closing a job updates it
        and updated_at is all the order knew about. The status tones make the
        difference visible; they did not make it ORDERED, and a list you have
        to scan in full is not answering "what is waiting on me".

        Within each group the recency order is kept, because among live jobs
        the most recently moved genuinely is the most interesting one.
      */}
      <JobList
        title={closed.length > 0 ? "Live jobs" : "Your jobs"}
        jobs={live}
        labels={CLIENT_STATUS}
        empty="When a job is set up for you it appears here, with its evidence and its documents. If you have posted one and cannot see it, it is probably still a draft."
      />

      {closed.length > 0 && (
        <JobList title="Closed" jobs={closed} labels={CLIENT_STATUS} />
      )}

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
