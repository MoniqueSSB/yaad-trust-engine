import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

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

type Evidence = {
  id: string;
  label: string | null;
  meta: string | null;
  img: string | null;
  ok: boolean | null;
  created_at: string | null;
  uploaded_by: string | null;
};

type Quote = {
  id: string;
  worker_name: string | null;
  labour_jmd: number | null;
  materials_jmd: number | null;
  materials_at_cost: boolean | null;
  earliest_start: string | null;
  days_estimate: string | null;
  note: string | null;
  status: string | null;
};

type Pack = {
  id: string;
  project_title: string | null;
  status: string | null;
  rev: number | null;
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

function jmd(n: number | null) {
  return n == null ? null : "J$" + n.toLocaleString("en-US");
}

export default async function JobRoom({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getUser();
  if (!user) redirect("/portal/sign-in");

  const { id } = await params;
  const supabase = await createClient();

  const { data: job } = await supabase
    .from("jobs")
    .select(
      "id,title,trade,parish,stage,status,descr,client_email,worker_email,worker_name,updated_at,signoff_method,walk_platform,walk_date",
    )
    .eq("id", id)
    .maybeSingle();

  // RLS returning nothing and the job not existing look identical from here.
  // That is correct: a stranger probing ids learns nothing either way.
  if (!job) notFound();

  const email = (user.email ?? "").toLowerCase();
  const role =
    job.client_email?.toLowerCase() === email ? "client" : "worker";

  const [{ data: evidence }, { data: quotes }, { data: packs }] =
    await Promise.all([
      supabase
        .from("evidence")
        .select("id,label,meta,img,ok,created_at,uploaded_by")
        .eq("job_id", id)
        .order("created_at", { ascending: true }),
      supabase
        .from("job_quotes")
        .select(
          "id,worker_name,labour_jmd,materials_jmd,materials_at_cost,earliest_start,days_estimate,note,status",
        )
        .eq("job_id", id)
        .order("created_at", { ascending: true }),
      supabase
        .from("kickoff_packs")
        .select("id,project_title,status,rev,updated_at")
        .eq("job_id", id)
        .order("updated_at", { ascending: false }),
    ]);

  const ev = (evidence ?? []) as Evidence[];
  const qs = (quotes ?? []) as Quote[];
  const pk = (packs ?? []) as Pack[];

  return (
    <>
      <Link
        href="/portal"
        className="text-[13px] text-tealb underline-offset-2 hover:underline"
      >
        &larr; All your jobs
      </Link>

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
        {job.stage != null && <span>Stage {job.stage}</span>}
        <span>
          You are the {role === "client" ? "client" : "tradesperson"} on this
          job
        </span>
      </div>

      {job.descr && (
        <div className="mt-6 rounded-2xl border border-line bg-panel p-5">
          <h2 className="mb-2 text-[10.5px] font-bold uppercase tracking-[.2em] text-tealb">
            The job, as agreed
          </h2>
          <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-mute">
            {job.descr}
          </p>
        </div>
      )}

      <section className="mt-8">
        <h2 className="mb-1 text-[10.5px] font-bold uppercase tracking-[.2em] text-tealb">
          Evidence · {ev.length} item{ev.length === 1 ? "" : "s"}
        </h2>
        <p className="mb-4 max-w-[62ch] text-[13px] leading-relaxed text-mute">
          Money only moves against what is on this list. Nothing here can be
          edited after upload.
        </p>
        {ev.length === 0 ? (
          <p className="rounded-2xl border border-line bg-panel p-5 text-[13.5px] text-mute">
            No evidence filed yet. It appears here the moment the first
            arrival photos are uploaded.
          </p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {ev.map((e) => (
              <li
                key={e.id}
                className="overflow-hidden rounded-2xl border border-line bg-panel"
              >
                {e.img ? (
                  // Stored inline in the evidence row as a data URI, so this
                  // never fetches from a third party.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={e.img}
                    alt={e.label ?? "Evidence photo"}
                    className="h-40 w-full object-cover"
                  />
                ) : (
                  <div className="grid h-40 w-full place-items-center bg-panel2 text-[12px] text-dim">
                    No image on this item
                  </div>
                )}
                <div className="p-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <b className="text-[13.5px] leading-snug">
                      {e.label ?? "Evidence"}
                    </b>
                    {e.ok != null && (
                      <span
                        className={
                          "rounded-full px-2 py-0.5 text-[10px] font-bold " +
                          (e.ok
                            ? "bg-tealb/15 text-tealb"
                            : "bg-mango/15 text-mango")
                        }
                      >
                        {e.ok ? "Checked" : "Awaiting check"}
                      </span>
                    )}
                  </div>
                  {e.meta && (
                    <p className="mt-1 text-[12px] text-dim">{e.meta}</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {qs.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-4 text-[10.5px] font-bold uppercase tracking-[.2em] text-tealb">
            Quotes · {qs.length}
          </h2>
          <ul className="grid gap-3">
            {qs.map((q) => (
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
              </li>
            ))}
          </ul>
        </section>
      )}

      {pk.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-4 text-[10.5px] font-bold uppercase tracking-[.2em] text-tealb">
            Documents
          </h2>
          <ul className="grid gap-3">
            {pk.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-panel px-4 py-3.5"
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
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
