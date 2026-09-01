import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getUser } from "@/lib/supabase/auth";
import { QuotePanel } from "@/components/QuotePanel";

export const dynamic = "force-dynamic";

/**
 * The marketplace board, MARKETPLACE-BUILD-SPEC v1.0, built at
 * app.yaadly.co.uk/jobs per the founder's decision that the product lives
 * in the app. Two independent switches: vmode (visitor or vetted worker,
 * a REAL auth state here, derived server-side) and mtab (jobs/workers).
 * Reads only the open_jobs and client_summary views plus public
 * worker_profiles and job_photos. budget_band is never selected anywhere
 * on this page; the view makes that structural.
 */

type OpenJob = {
  id: string; title: string | null; trade: string | null; parish: string | null;
  descr: string | null; updated_at: string | null;
  client_signed: boolean | null; client_jobs_completed: number | null;
  job_type: string | null; size_band: string | null;
  access_type: string | null; materials_by: string | null; urgency: string | null;
  materials_store_type: string | null;
};

/** What the client answered when asked where materials are to be kept on the
 *  property. The board carries the answer but never the client's description
 *  of the place, which open_jobs withholds for the same reason it withholds
 *  the address: it says where the valuable things are on a house that is
 *  often empty. A worker needs the answer to quote, because "nowhere
 *  securable" means buying in drops sized to the next stage and taking the
 *  surplus away each night, and those trips are priced in the quote. */
const STORE_LABEL: Record<string, string> = {
  lockable: "Lockable store on site",
  indoors: "Materials kept indoors",
  none_available: "No secure store, buy in drops",
};
type Photo = { job_id: string; caption: string; img: string | null; position: number };
type Worker = { name: string | null; trade: string | null; parish: string | null; lane: string | null; jobs_completed: number | null; slug: string | null };
type QuotePackDraft = {
  job_id: string; status: string;
  docs: {
    scope_summary?: string; included?: string[]; excluded?: string[];
    rough_timeline?: string; payment_stages?: { stage: string; proportion_percent: number; evidence_note: string }[];
  } | null;
  guardrail: { price_language_detected?: boolean; banned_language_detected?: boolean } | null;
};

export const metadata = {
  title: "The marketplace · Yaadly",
  description: "Open property jobs across Jamaica and the verified workers who do them. Money held until the work is proven.",
};

function ago(iso: string | null): string {
  if (!iso) return "";
  const mins = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return mins + " min ago";
  const h = Math.round(mins / 60);
  if (h < 24) return h + (h === 1 ? " hour ago" : " hours ago");
  const days = Math.round(h / 24);
  return days === 1 ? "yesterday" : days + " days ago";
}

export default async function Board({
  searchParams,
}: {
  searchParams: Promise<{ trade?: string; tab?: string; q?: string; pics?: string }>;
}) {
  const { trade, tab, q, pics } = await searchParams;
  const supabase = await createClient();
  const user = await getUser();

  // vmode is a real auth state: signed in, published profile, guidelines
  // signed. The same three things jq_insert_vetted checks in Postgres.
  let vmode: "visitor" | "worker" = "visitor";
  if (user?.email) {
    const email = user.email.toLowerCase();
    const [{ data: wp }, { data: sig }] = await Promise.all([
      supabase.from("worker_profiles").select("worker_email").eq("worker_email", email).eq("active", true).maybeSingle(),
      supabase.from("doc_signatures").select("id").eq("doc_type", "worker_guidelines").ilike("signer_email", email).limit(1).maybeSingle(),
    ]);
    if (wp && sig) vmode = "worker";
  }

  let jq = supabase.from("open_jobs").select("*").order("updated_at", { ascending: false });
  if (trade) jq = jq.eq("trade", trade);

  const [{ data: jobsData }, { data: workersData }, { data: tradeRows }] = await Promise.all([
    jq,
    supabase.from("worker_profiles").select("name,trade,parish,lane,jobs_completed,slug").eq("active", true).order("jobs_completed", { ascending: false }),
    supabase.from("open_jobs").select("trade"),
  ]);

  const jobs = (jobsData ?? []) as OpenJob[];
  const jobIds = jobs.map((j) => j.id);
  const { data: photoData } = jobIds.length
    ? await supabase.from("job_photos").select("job_id,caption,img,position").in("job_id", jobIds).order("position")
    : { data: [] };
  const photosByJob = new Map<string, Photo[]>();
  for (const p of (photoData ?? []) as Photo[]) {
    const l = photosByJob.get(p.job_id) ?? [];
    l.push(p);
    photosByJob.set(p.job_id, l);
  }

  // A worker considering any open job should see the Quote Kickoff Pack
  // draft the moment they expand it, not wait on a client fetch: fetched
  // here, once, alongside everything else the board already loads.
  const { data: draftData } = jobIds.length && vmode === "worker"
    ? await supabase.from("quote_pack_drafts").select("job_id,status,docs,guardrail").in("job_id", jobIds)
    : { data: [] };
  const draftsByJob = new Map<string, QuotePackDraft>();
  for (const d of (draftData ?? []) as QuotePackDraft[]) {
    // RLS already refuses anything but an 'approved' row to a worker
    // (20260901r): a still-drafting, dirty-but-'ready', or failed row
    // never reaches this query at all. This preference is what is left
    // once that gate is doing its job - only the most useful row per job.
    const existing = draftsByJob.get(d.job_id);
    if (!existing || d.status === "approved") draftsByJob.set(d.job_id, d);
  }

  const workers = (workersData ?? []) as Worker[];
  const trades = [...new Set((tradeRows ?? []).map((t) => t.trade).filter(Boolean))] as string[];
  const showWorkers = tab === "workers";
  const keep = (extra: string) =>
    `/jobs?${[trade && `trade=${encodeURIComponent(trade)}`, showWorkers && "tab=workers", extra].filter(Boolean).join("&")}`;
  const newest = jobs[0]?.updated_at ? new Date(jobs[0].updated_at).getTime() : 0;

  return (
    <div className="mx-auto max-w-[1080px] px-5 py-10">
      <h1 className="font-display text-[clamp(34px,6vw,64px)] uppercase leading-[0.97]">
        The <span className="bg-linear-to-r from-tealb to-teal bg-clip-text text-transparent">marketplace.</span>
      </h1>
      <p className="mt-4 max-w-[68ch] text-[15.5px] leading-relaxed text-mute">
        The public board. This is the <code className="font-mono text-[13px] text-tealb">open_jobs</code> view,
        safe columns only, anyone can read it, and a job only appears here once
        its client has signed the Client Guidelines. No addresses, no phone
        numbers, ever.
      </p>
      <p className="mt-2 text-[13px]">
        <Link href="/trades" className="text-tealb underline-offset-2 hover:underline">All 18 trades</Link>
        <span className="text-dim"> · </span>
        <Link href="/ask" className="text-tealb underline-offset-2 hover:underline">Ask a Yaad, free answers from tradespeople</Link>
      </p>

      <div className="mt-4 flex flex-wrap gap-2 text-[13px]">
        <Link href={keep("")} className={!showWorkers ? "font-bold text-tealb" : "text-mute hover:text-tealb"}>Open jobs</Link>
        <span className="text-dim">·</span>
        <Link href={`/jobs?tab=workers${trade ? `&trade=${encodeURIComponent(trade)}` : ""}`} className={showWorkers ? "font-bold text-tealb" : "text-mute hover:text-tealb"}>The worker network</Link>
        <span className="text-dim">·</span>
        <Link href="/apply" className="text-mute hover:text-tealb">Join as a worker</Link>
      </div>

      {showWorkers ? (
        <WorkerDirectory workers={workers} />
      ) : (
        <>
          {trades.length > 1 && (
            <div className="mt-5 flex flex-wrap gap-2">
              <Link href={showWorkers ? "/jobs?tab=workers" : "/jobs"} className={"rounded-full border px-3.5 py-1.5 text-[12.5px] font-bold transition " + (!trade ? "border-teal bg-soft text-tealb" : "border-line text-mute hover:border-teal hover:text-tealb")}>All trades</Link>
              {trades.map((t) => (
                <Link key={t} href={`/jobs?trade=${encodeURIComponent(t)}`} className={"rounded-full border px-3.5 py-1.5 text-[12.5px] font-bold transition " + (trade === t ? "border-teal bg-soft text-tealb" : "border-line text-mute hover:border-teal hover:text-tealb")}>{t}</Link>
              ))}
            </div>
          )}

          <p className="mt-3 text-[12.5px] text-dim">
            {jobs.length} open job{jobs.length === 1 ? "" : "s"}
            {trade ? " in " + trade : ""} · drafts and unsigned jobs are not
            counted because they are not here
          </p>

          {jobs.length === 0 ? (
            <p className="mt-4 rounded-2xl border border-line bg-panel p-5 text-[13.5px] leading-relaxed text-mute">
              No jobs are open for quotes right now. Pitched jobs land here the
              moment Yaadly opens them, so pitch yours and it can be next.
            </p>
          ) : (
            <div className="mt-4 grid gap-3.5">
              {jobs.map((j) => {
                const ph = photosByJob.get(j.id) ?? [];
                const expanded = pics === j.id;
                const showPh = expanded ? ph : ph.slice(0, 3);
                const fresh = !!j.updated_at && newest - new Date(j.updated_at).getTime() < 1000 * 60 * 60 * 6;
                const sp = [j.job_type, j.size_band, j.access_type, j.materials_by,
                  STORE_LABEL[j.materials_store_type ?? ""]].filter(Boolean) as string[];
                const open = q === j.id;
                return (
                  <div key={j.id} id={j.id} className={"scroll-mt-6 rounded-2xl border bg-panel p-5 " + (fresh ? "border-mango/50 bg-mango/[.045]" : "border-line")}>
                    <div className="flex flex-wrap items-start gap-3">
                      <h2 className="min-w-[220px] flex-1 text-[16.5px] font-bold leading-snug">{j.title ?? "Job"}</h2>
                      <span className="flex flex-wrap gap-2">
                        {fresh && <span className="rounded-full border border-mango/40 bg-mango/10 px-2.5 py-1 text-[11px] font-bold text-mango">Just posted</span>}
                        {j.trade && <span className="rounded-full border border-softline bg-soft px-2.5 py-1 text-[11px] font-bold text-tealb">{j.trade}</span>}
                      </span>
                    </div>

                    {sp.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-x-3.5 gap-y-1 text-[12.5px] text-dim">
                        {sp.map((x) => <span key={x}>{x}</span>)}
                      </div>
                    )}

                    {j.descr && (
                      <p className="mt-2 whitespace-pre-wrap text-[13.5px] leading-relaxed text-mute">
                        {j.descr.slice(0, 260)}{j.descr.length > 260 ? "..." : ""}
                      </p>
                    )}

                    {ph.length > 0 && (
                      <>
                        <div className="mt-3 grid grid-cols-3 gap-2">
                          {showPh.map((p, i) => (
                            <figure key={i} className="relative h-16 overflow-hidden rounded-lg border border-softline bg-linear-to-br from-panel2 to-soft">
                              {p.img && (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={p.img} alt={p.caption} className="h-full w-full object-cover" />
                              )}
                              <figcaption className="absolute inset-x-0 bottom-0 bg-bg/70 px-1.5 py-0.5 text-[9.5px] leading-tight text-dim">{p.caption}</figcaption>
                            </figure>
                          ))}
                          {ph.length > 3 && (
                            <Link href={expanded ? keep("") : keep("pics=" + encodeURIComponent(j.id))} className="grid h-16 place-items-center rounded-lg border border-softline bg-soft text-[12px] font-bold text-tealb hover:border-teal">
                              {expanded ? "Show less" : "+" + (ph.length - 3) + " more"}
                            </Link>
                          )}
                        </div>
                        <p className="mt-1.5 text-[11.5px] text-dim">
                          {ph.length} photo{ph.length === 1 ? "" : "s"} from the client{expanded ? "" : ", first three shown"} · yaad-vision has read them all
                        </p>
                      </>
                    )}

                    <div className="mt-3 flex flex-wrap gap-3.5 border-t border-line pt-3 text-[12.5px] text-dim">
                      {j.parish && <b className="font-medium text-mute">{j.parish}</b>}
                      {j.urgency && <span>{j.urgency}</span>}
                      {ph.length > 0 && <span>{ph.length} photos</span>}
                      <span>{ago(j.updated_at)}</span>
                    </div>

                    <div className="flex flex-wrap gap-3.5 pt-1 text-[12.5px] text-dim">
                      <span>{j.client_signed ? "✓ Client guidelines signed" : "Awaiting client signature"}</span>
                      <span>
                        {(j.client_jobs_completed ?? 0) > 0
                          ? `Client · ${j.client_jobs_completed} job${j.client_jobs_completed === 1 ? "" : "s"} completed`
                          : "no client score yet, first job on Yaadly"}
                      </span>
                      <span>{j.id}</span>
                    </div>

                    <div className="mt-3.5 flex flex-wrap items-center gap-2.5">
                      <Link
                        href={open ? keep("") : keep("q=" + encodeURIComponent(j.id))}
                        className={vmode === "worker"
                          ? "rounded-full bg-linear-to-r from-teal to-mango px-4 py-2 text-[13px] font-bold text-[#04211D] transition hover:brightness-110"
                          : "rounded-full border border-line2 px-4 py-2 text-[13px] font-bold text-ink transition hover:border-teal hover:text-tealb"}
                      >
                        {open ? "Close" : "Quote this job"}
                      </Link>
                      <span className="rounded-full border border-line bg-panel2 px-2.5 py-1 text-[11px] font-bold text-mute">
                        Quote on the scope, no band shown
                      </span>
                    </div>

                    {open && vmode !== "worker" && (
                      <div className="mt-3.5 flex gap-2.5 rounded-xl border border-coral/25 bg-coral/[.07] p-3.5 text-[13px] leading-relaxed text-mute">
                        <span>🔒</span>
                        <span>
                          <b className="text-coral">Quoting is for vetted workers.</b>{" "}
                          The <code className="font-mono text-[11.5px] text-tealb">job_quotes</code> insert
                          policy needs three things true at once: a published
                          worker profile, a signed Worker Guidelines, and a job
                          that is genuinely open. Browsing stays free for
                          everyone.{" "}
                          <Link href="/portal/sign-in" className="text-tealb underline">Worker sign in</Link>
                        </span>
                      </div>
                    )}
                    {open && vmode === "worker" && (
                      <QuotePanel jobId={j.id} draft={draftsByJob.get(j.id) ?? null} />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      <div className="mt-8 rounded-2xl border border-line bg-panel p-5">
        <h3 className="font-display text-[19px] uppercase">
          Want to be <span className="text-mango">part of it?</span>
        </h3>
        <p className="mt-2 text-[12.5px] leading-relaxed text-dim">
          Property owners: create your profile, sign the Client Guidelines, and
          pitch your job, free, and your record starts building from the first
          completed job. Tradespeople: apply free, pass verification, sign the
          Worker Guidelines, and every job on this board is yours to quote.
        </p>
        {/* All three of these used to point at yaadly.co.uk/#worker and
            /#client. Those panes came off the marketing site on 27 Aug, and
            its hash router now answers both by replacing the location with
            app.yaadly.co.uk/portal, which is inside the gated group and so
            redirects again to sign-in. So every button on a PUBLIC board sent
            the visitor to a login form: "Read the Client Guidelines" asked
            them to sign in before reading the thing they were told they could
            read, and "Join as a worker" sent an applicant, who by definition
            has no account, to a sign-in wall.

            They point at the real pages instead. Both are on this origin, so
            they are Links, not cross-site hops through a redirect. The
            guidelines page reads without an account on purpose (see the note
            at the top of app/portal/guidelines/page.tsx), and ?read= opens
            the document text itself rather than the index, so the labels
            promise what the click delivers. The marketing site keeps its
            #client and #worker rule: it was put there for old bookmarks
            already loose in the world, and nothing here was ever what
            justified it. */}
        <div className="mt-3.5 flex flex-wrap gap-2.5">
          <Link href="/portal/sign-in" className="rounded-full bg-linear-to-r from-teal to-mango px-4.5 py-2.5 text-[13.5px] font-bold text-[#04211D] transition hover:brightness-110">Become a client &rarr;</Link>
          <Link href="/apply" className="rounded-full border border-line2 px-4.5 py-2.5 text-[13.5px] font-bold text-ink transition hover:border-teal hover:text-tealb">Join as a worker &rarr;</Link>
          <Link href="/portal/guidelines?read=client_guidelines" className="rounded-full border border-line2 px-4.5 py-2.5 text-[13.5px] font-bold text-ink transition hover:border-teal hover:text-tealb">Read the Client Guidelines</Link>
          <Link href="/portal/guidelines?read=worker_guidelines" className="rounded-full border border-line2 px-4.5 py-2.5 text-[13.5px] font-bold text-ink transition hover:border-teal hover:text-tealb">Read the Worker Guidelines</Link>
        </div>
      </div>
    </div>
  );
}

function WorkerDirectory({ workers }: { workers: Worker[] }) {
  if (workers.length === 0) {
    return (
      <p className="mt-5 rounded-2xl border border-line bg-panel p-5 text-[13.5px] leading-relaxed text-mute">
        The worker network is being built parish by parish, and nobody is
        listed before verification is complete: government photo ID on a video
        call, and references called. Profiles appear here as workers pass.
      </p>
    );
  }
  return (
    <div className="mt-5 grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
      {workers.map((w, i) => (
        <div key={i} className="flex flex-col gap-3 rounded-2xl border border-line bg-panel p-4">
          <div className="flex flex-wrap items-start gap-3">
            <span className="grid size-11 flex-none place-items-center rounded-xl bg-linear-to-br from-tealb to-teal font-display text-[18px] text-[#04211D]">
              {(w.name ?? "W").split(" ").map((x) => x[0]).join("").slice(0, 2)}
            </span>
            <span className="min-w-0 flex-1">
              <b className="block text-[15px] leading-tight">{w.name}</b>
              <small className="block text-[12.5px] text-mute">{w.trade ?? "General trades"}</small>
              <small className="block text-[12px] text-dim">{w.parish}</small>
            </span>
            <span className="text-right">
              <span className="block text-[12px] text-dim">{w.jobs_completed ?? 0} jobs</span>
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <span className="rounded-full border border-line bg-panel2 px-2.5 py-1 text-[10.5px] font-bold text-mute">ID verified</span>
            <span className={"rounded-full px-2.5 py-1 text-[10.5px] font-bold " + (w.lane === "cert" ? "border border-[#4A3A10] bg-[#2E2408] text-sand" : "border border-softline bg-soft text-tealb")}>
              {w.lane === "cert" ? "Certified professional" : "Evidence vetted"}
            </span>
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            {[0, 1, 2, 3].map((k) => <span key={k} className="h-9 rounded-md border border-line bg-linear-to-br from-panel2 to-soft" />)}
          </div>
          {w.slug && (
            <Link href={"/workers/" + encodeURIComponent(w.slug)} className="rounded-full border border-line2 py-2 text-center text-[12.5px] font-bold text-ink transition hover:border-teal hover:text-tealb">
              View profile
            </Link>
          )}
        </div>
      ))}
    </div>
  );
}
