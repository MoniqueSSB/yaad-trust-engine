import Link from "next/link";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

// Never cached. A portal showing a stale job is worse than a slow one.
export const dynamic = "force-dynamic";

type Job = {
  id: string;
  title: string | null;
  trade: string | null;
  parish: string | null;
  stage: number | null;
  status: string;
  client_email: string | null;
  worker_email: string | null;
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

export default async function Portal() {
  // Checked here as well as in the layout. A layout does not re-run on every
  // navigation, so a layout-only gate is a gate you can walk around.
  const user = await getUser();
  if (!user) redirect("/portal/sign-in");

  const supabase = await createClient();

  // No .eq() on email here, deliberately. Row level security already limits
  // this to jobs where the signed-in email is the client or the worker. If
  // the filter lived in this file, a mistake in this file would be a data
  // leak. In Postgres, a mistake here is just a shorter list.
  const svcQuery = supabase
    .from("services")
    .select("id,type,parish,price,stage,updated_at")
    .order("updated_at", { ascending: false });

  const { data, error } = await supabase
    .from("jobs")
    .select(
      "id,title,trade,parish,stage,status,client_email,worker_email,updated_at",
    )
    .order("updated_at", { ascending: false });

  const { data: svcData } = await svcQuery;
  const services = (svcData ?? []) as {
    id: string;
    type: string | null;
    parish: string | null;
    price: string | null;
    stage: number | null;
  }[];
  const jobs = (data ?? []) as Job[];
  const email = (user.email ?? "").toLowerCase();
  const asClient = jobs.filter((j) => j.client_email?.toLowerCase() === email);
  const asWorker = jobs.filter((j) => j.worker_email?.toLowerCase() === email);

  return (
    <>
      <h1 className="font-display text-[clamp(26px,4vw,38px)] uppercase leading-none">
        Your jobs
      </h1>
      <p className="mt-3 max-w-[62ch] text-[14px] leading-relaxed text-mute">
        Everything here is scoped to you by the database, not by this page.
      </p>

      {error && (
        <p
          role="alert"
          className="mt-6 rounded-xl border border-coral/30 bg-coral/10 px-4 py-3 text-[13px] text-mute"
        >
          Could not load your jobs: {error.message}
        </p>
      )}

      {!error && jobs.length === 0 && services.length === 0 && (
        <div className="mt-6 rounded-2xl border border-line bg-panel p-6">
          <b className="text-[15px]">Nothing here yet</b>
          <p className="mt-2 text-[13.5px] leading-relaxed text-mute">
            When a job is set up for you it appears here, with its evidence and
            its documents. If you have posted one and cannot see it, it is
            probably still a draft.
          </p>
        </div>
      )}

      {asClient.length > 0 && (
        <JobList title="As the client" jobs={asClient} />
      )}
      {asWorker.length > 0 && (
        <JobList title="As the tradesperson" jobs={asWorker} />
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

function JobList({ title, jobs }: { title: string; jobs: Job[] }) {
  return (
    <section className="mt-8">
      <h2 className="mb-3 text-[10.5px] font-bold uppercase tracking-[.2em] text-tealb">
        {title}
      </h2>
      <ul className="grid gap-3">
        {jobs.map((j) => (
          <li key={j.id}>
            <Link
              href={"/portal/jobs/" + encodeURIComponent(j.id)}
              className="block rounded-2xl border border-line bg-panel p-4 transition hover:border-line2"
            >
            <div className="flex flex-wrap items-start gap-3">
              <b className="min-w-[200px] flex-1 text-[15.5px] leading-snug">
                {j.title ?? "Untitled job"}
              </b>
              <span className="rounded-full border border-softline bg-soft px-2.5 py-1 text-[11px] font-bold text-tealb">
                {STATUS_LABEL[j.status] ?? j.status}
              </span>
            </div>
            <div className="mt-3 flex flex-wrap gap-3.5 border-t border-line pt-3 text-[12.5px] text-dim">
              <span>{j.id}</span>
              {j.trade && <span>{j.trade}</span>}
              {j.parish && <span>{j.parish}</span>}
              {j.stage != null && <span>Stage {j.stage}</span>}
            </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
