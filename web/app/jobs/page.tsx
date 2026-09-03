import Link from "next/link";
import { TRADES } from "@/lib/taxonomy";
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
 *
 * Restyled Sep 2026 to the purple/gold system the marketing site now uses:
 * photos lead every card, on jobs and on worker profiles alike, because the
 * board is the thing people are asked to browse and evidence is what it
 * sells. Nothing about the data or the gate changed in that pass.
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
type Photo = { job_id: string; caption: string; img: string | null; position: number; storage_path: string | null };
type Worker = {
  name: string | null; trade: string | null; parish: string | null; lane: string | null;
  jobs_completed: number | null; slug: string | null; about: string | null; years: number | null;
};
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
    supabase.from("worker_profiles").select("name,trade,parish,lane,jobs_completed,slug,about,years").eq("active", true).order("jobs_completed", { ascending: false }),
    supabase.from("open_jobs").select("trade"),
  ]);

  const jobs = (jobsData ?? []) as OpenJob[];
  const jobIds = jobs.map((j) => j.id);
  // board_ok is named here as well as enforced in Postgres, so that this page
  // shows every viewer the same photographs. A signed-in client can read their
  // own unpublished photos through "job party reads their own job photos", and
  // without this filter their copy of the public board would quietly carry
  // pictures nobody else can see, which is a misleading thing for a board to do.
  const { data: photoData } = jobIds.length
    ? await supabase.from("job_photos").select("job_id,caption,img,position,storage_path")
        .in("job_id", jobIds).eq("board_ok", true).order("position")
    : { data: [] };
  const photos = (photoData ?? []) as Photo[];

  /* The photographs themselves live in the private 'intake' bucket, where
     WhatsApp intake has been putting them since 27 Aug. Nothing in that bucket
     is public and nothing here is a lasting link: a short-lived signed URL is
     minted per object as the page renders, and it is dead in five minutes.
     Postgres decides who may mint one ("board photo files are readable"), so a
     photograph the board would not show cannot be signed for either. Rows that
     already carry an img, the demonstration image in the app's own assets, are
     left exactly as they are. */
  const toSign = photos.filter((p) => p.storage_path && !p.img);
  if (toSign.length) {
    const { data: signed } = await supabase.storage
      .from("intake")
      .createSignedUrls(toSign.map((p) => p.storage_path as string), 300);
    const byPath = new Map((signed ?? []).map((r) => [r.path, r.signedUrl]));
    for (const p of toSign) p.img = byPath.get(p.storage_path as string) ?? null;
  }

  const photosByJob = new Map<string, Photo[]>();
  for (const p of photos) {
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

  const pill = (on: boolean) =>
    "rounded-full border px-3.5 py-1.5 text-[12.5px] font-semibold transition " +
    (on ? "border-gold/45 bg-gold/10 text-goldb" : "border-line text-mute hover:border-line2 hover:text-purpleb");

  return (
    <div className="mx-auto max-w-[1040px] px-5 py-10">
      {/* ── HEAD ─────────────────────────────────────────────── */}
      <h1 className="font-display text-[clamp(38px,5.6vw,68px)] font-extralight leading-[1.02] tracking-[-0.025em]">
        The{" "}
        <em className="bg-linear-to-r from-purpleb via-purple to-gold bg-clip-text font-light not-italic text-transparent italic">
          marketplace.
        </em>
      </h1>
      <p className="mt-3.5 max-w-[62ch] text-[15.5px] leading-relaxed text-mute">
        Open property jobs across Jamaica and the verified workers who do them.{" "}
        <b className="font-semibold text-ink">Money held until the work is proven.</b>
      </p>
      <p className="mt-2.5 flex items-center gap-2 font-mono-app text-[11px] font-medium tracking-[0.06em] text-dim">
        <svg viewBox="0 0 24 24" className="size-3.5 shrink-0 fill-none stroke-gold stroke-2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" />
        </svg>
        No addresses. No phone numbers. No budgets shown. Ever.
      </p>

      {/* The founder's call: keep the row, leave the figures blank until
          there are real ones worth showing. The labels hold the shape so
          nothing moves on the page when the numbers arrive. */}
      <div className="mt-5 flex flex-wrap gap-6">
        {[
          ["jobs open now", false],
          ["verified workers", false],
          ["paid on proof", true],
        ].map(([label, gold]) => (
          <span key={label as string} className="flex items-baseline gap-2 font-mono-app text-[11px] font-medium uppercase tracking-[0.08em] text-dim">
            <b className={"bg-clip-text font-mono-app text-[24px] font-semibold tracking-normal text-transparent " + (gold ? "bg-linear-to-br from-goldb to-gold" : "bg-linear-to-r from-purpleb via-purple to-gold")}>&mdash;</b>
            {label}
          </span>
        ))}
      </div>

      {/* ── TABS ─────────────────────────────────────────────── */}
      <div className="mt-6 flex flex-wrap items-center gap-2 border-b border-line pb-4.5">
        <Link href={keep("")} className={"inline-flex items-center gap-2 rounded-full border px-4.5 py-2.5 text-[13.5px] font-semibold transition " + (!showWorkers ? "border-purple/45 bg-purple/10 text-purpleb" : "border-line text-mute hover:border-line2 hover:text-ink")}>
          Open jobs <span className={"rounded-full bg-panel2 px-2 py-px font-mono-app text-[10.5px] " + (!showWorkers ? "text-purpleb" : "text-dim")}>{jobs.length}</span>
        </Link>
        <Link href={`/jobs?tab=workers${trade ? `&trade=${encodeURIComponent(trade)}` : ""}`} className={"inline-flex items-center gap-2 rounded-full border px-4.5 py-2.5 text-[13.5px] font-semibold transition " + (showWorkers ? "border-purple/45 bg-purple/10 text-purpleb" : "border-line text-mute hover:border-line2 hover:text-ink")}>
          The worker network <span className={"rounded-full bg-panel2 px-2 py-px font-mono-app text-[10.5px] " + (showWorkers ? "text-purpleb" : "text-dim")}>{workers.length}</span>
        </Link>
        {/* /ask had no inbound link from anywhere: not the header, not the
            marketing site, not this board. It was built, shipped and
            unreachable, which is the same as not existing for the one visitor
            it was for, the person who is not sure they have a job yet. It
            belongs here, next to the board, because that is exactly the
            moment somebody hesitates. */}
        <span className="ml-auto flex flex-wrap gap-4 text-[13px]">
          <Link href="/ask" className="font-semibold text-mute transition hover:text-purpleb">Ask a Yaad</Link>
          <Link href="/trades" className="font-semibold text-mute transition hover:text-purpleb">All {TRADES.length} trades</Link>
          <Link href="/apply" className="font-semibold text-goldb transition hover:opacity-80">Join as a worker &rarr;</Link>
        </span>
      </div>

      {showWorkers ? (
        <WorkerDirectory workers={workers} />
      ) : (
        <>
          {trades.length > 1 && (
            <div className="mt-4.5 flex flex-wrap gap-2">
              {/* aria-current, because these are links styled as a filter and
                  the only signal of which one is active was colour. A screen
                  reader heard a list of trade names with nothing to say which
                  filter the board was showing. */}
              <Link href="/jobs" aria-current={!trade ? "page" : undefined} className={pill(!trade)}>All trades</Link>
              {trades.map((t) => (
                <Link key={t} href={`/jobs?trade=${encodeURIComponent(t)}`}
                  aria-current={trade === t ? "page" : undefined}
                  className={pill(trade === t)}>{t}</Link>
              ))}
            </div>
          )}

          <p className="mt-3 font-mono-app text-[11px] font-medium uppercase tracking-[0.06em] text-dim">
            {jobs.length} open job{jobs.length === 1 ? "" : "s"}
            {trade ? " in " + trade : ""} · drafts and unsigned jobs are not
            counted, because they are not here
          </p>

          {jobs.length === 0 ? (
            <p className="mt-4 rounded-2xl border border-line bg-panel p-5 text-[13.5px] leading-relaxed text-mute">
              No jobs are open for quotes right now. Pitched jobs land here the
              moment Yaadly opens them, so pitch yours and it can be next.
            </p>
          ) : (
            <div className="mt-4 flex flex-col gap-3.5">
              {jobs.map((j) => {
                // Only pictures that actually resolved. A tile with nothing in
                // it is not a photograph, and counting it would overstate what
                // a worker has been given to quote from.
                const ph = (photosByJob.get(j.id) ?? []).filter((p) => p.img);
                const expanded = pics === j.id;
                const banner = expanded ? ph : ph.slice(0, 3);
                const fresh = !!j.updated_at && newest - new Date(j.updated_at).getTime() < 1000 * 60 * 60 * 6;
                const sp = [j.job_type, j.size_band, j.access_type, j.materials_by,
                  STORE_LABEL[j.materials_store_type ?? ""]].filter(Boolean) as string[];
                const open = q === j.id;
                return (
                  <div
                    key={j.id}
                    id={j.id}
                    className={
                      "group relative scroll-mt-6 overflow-hidden rounded-[18px] border bg-linear-to-b from-[rgba(19,19,50,0.9)] to-[rgba(12,12,38,0.75)] px-6 pb-4.5 pt-5.5 shadow-[inset_0_1px_0_rgba(238,238,255,0.04)] transition duration-200 hover:-translate-y-0.5 hover:border-purple/40 hover:shadow-[0_12px_44px_rgba(0,0,0,0.4)] " +
                      (fresh ? "border-gold/35" : "border-line")
                    }
                  >
                    {fresh && <span className="absolute inset-y-0 left-0 w-[3px] bg-linear-to-b from-gold to-transparent" />}

                    {/* The client's photos, at the top, each its own picture. */}
                    {ph.length > 0 && (
                      <div className="mb-4">
                        <div className="flex flex-wrap gap-2.5">
                          {banner.map((p, i) => (
                            <figure key={i} className="relative h-[92px] w-[136px] shrink-0 overflow-hidden rounded-xl border border-line2 bg-linear-to-br from-purple/28 to-gold/12 transition duration-200 hover:border-purple/60">
                              {p.img && (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={p.img} alt={p.caption} className="size-full object-cover" />
                              )}
                              <figcaption className="absolute inset-x-0 bottom-0 bg-linear-to-t from-bg/85 to-transparent px-2 py-1 font-mono-app text-[8.5px] font-medium leading-tight text-ink/80">
                                {p.caption}
                              </figcaption>
                            </figure>
                          ))}
                          {ph.length > 3 && (
                            <Link
                              href={expanded ? keep("") : keep("pics=" + encodeURIComponent(j.id))}
                              className="grid h-[92px] w-[76px] shrink-0 place-items-center rounded-xl border border-gold/35 bg-gold/[0.06] font-mono-app text-[11px] font-semibold text-goldb transition hover:border-gold hover:bg-gold/10"
                            >
                              {expanded ? "less" : "+" + (ph.length - 3)}
                            </Link>
                          )}
                        </div>
                        <p className="mt-2 font-mono-app text-[9.5px] text-dim">
                          {ph.length} photo{ph.length === 1 ? "" : "s"} from the client · <b className="font-medium text-mute">yaad-vision has read them all</b>
                        </p>
                      </div>
                    )}

                    <div className="flex flex-wrap items-start gap-3.5">
                      <h2 className="min-w-[240px] flex-1 font-display text-[20px] font-normal leading-[1.25] tracking-[-0.01em]">{j.title ?? "Job"}</h2>
                      <span className="flex flex-wrap gap-1.5">
                        {fresh && (
                          <span className="inline-flex items-center gap-1.5 rounded-full border border-gold/35 bg-gold/10 px-2.5 py-1 text-[11px] font-semibold text-goldb">
                            <i className="size-1.5 animate-pulse rounded-full bg-gold" />Just posted
                          </span>
                        )}
                        {j.trade && <span className="rounded-full border border-purple/30 bg-purple/10 px-2.5 py-1 text-[11px] font-semibold text-purpleb">{j.trade}</span>}
                      </span>
                    </div>

                    {sp.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {sp.map((x) => (
                          <span key={x} className="rounded-md border border-line bg-bg/50 px-2.5 py-1 font-mono-app text-[10.5px] font-medium tracking-[0.04em] text-mute">{x}</span>
                        ))}
                      </div>
                    )}

                    {j.descr && (
                      <p className="mt-3 max-w-[78ch] whitespace-pre-wrap text-[13.5px] leading-relaxed text-mute">
                        {j.descr.slice(0, 260)}{j.descr.length > 260 ? "..." : ""}
                      </p>
                    )}

                    <div className="mt-4 flex flex-wrap items-center gap-x-4.5 gap-y-1.5 border-t border-line pt-3.5 text-[12.5px] text-dim">
                      {j.parish && <b className="font-semibold text-ink">{j.parish}</b>}
                      {j.urgency && <span>{j.urgency}</span>}
                      <span>{ago(j.updated_at)}</span>
                      {j.client_signed ? (
                        <span className="inline-flex items-center gap-1.5 text-green">
                          <svg viewBox="0 0 24 24" className="size-3 fill-none stroke-green stroke-[2.5]" strokeLinecap="round" strokeLinejoin="round"><path d="m5 13 4 4L19 7" /></svg>
                          Client guidelines signed
                        </span>
                      ) : (
                        <span>Awaiting client signature</span>
                      )}
                      <span>
                        {(j.client_jobs_completed ?? 0) > 0
                          ? `Client · ${j.client_jobs_completed} job${j.client_jobs_completed === 1 ? "" : "s"} completed`
                          : "First job on Yaadly"}
                      </span>
                    </div>

                    <div className="mt-3.5 flex flex-wrap items-center gap-3">
                      <Link
                        href={open ? keep("") : keep("q=" + encodeURIComponent(j.id))}
                        className={vmode === "worker"
                          ? "rounded-full bg-linear-to-r from-purple to-gold px-5 py-2.5 text-[13.5px] font-bold text-white shadow-[0_0_20px_rgba(155,115,245,0.25)] transition hover:-translate-y-px hover:brightness-110"
                          : "rounded-full border border-line2 px-5 py-2.5 text-[13.5px] font-bold text-ink transition hover:border-purple hover:text-purpleb"}
                      >
                        {open ? "Close" : "Quote this job"}
                      </Link>
                      <span className="font-mono-app text-[10.5px] font-medium tracking-[0.06em] text-dim">
                        QUOTE ON THE SCOPE · NO BUDGET BAND SHOWN
                      </span>
                    </div>

                    {open && vmode !== "worker" && (
                      <div className="mt-3.5 rounded-xl border border-gold/25 bg-gold/[0.05] p-4 text-[13px] leading-relaxed text-mute">
                        <b className="font-semibold text-goldb">Quoting is for vetted workers.</b>{" "}
                        A published worker profile, a signed Worker Guidelines, and
                        a job that is genuinely open: all three are checked in the
                        database before a quote can exist. Browsing stays free for
                        everyone.{" "}
                        <Link href="/portal/sign-in" className="font-semibold text-purpleb underline underline-offset-2">Worker sign in</Link>
                        {" · "}
                        <Link href="/apply" className="font-semibold text-purpleb underline underline-offset-2">Apply to join</Link>
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

      {/* ── JOIN PANEL ───────────────────────────────────────── */}
      <div className="relative mt-8 mb-4 overflow-hidden rounded-[18px] border border-line2 bg-linear-to-br from-purple/10 to-gold/[0.05] p-7">
        <span className="pointer-events-none absolute -right-16 -top-16 size-64 rounded-full bg-[radial-gradient(ellipse,rgba(155,115,245,0.14)_0%,transparent_70%)]" />
        <div className="relative flex flex-wrap items-center gap-6">
          <div className="min-w-[280px] flex-1">
            <h3 className="font-display text-[clamp(20px,2.4vw,26px)] font-light tracking-[-0.01em]">
              Want to be{" "}
              <em className="bg-linear-to-r from-purpleb to-gold bg-clip-text text-transparent">part of it?</em>
            </h3>
            <p className="mt-1.5 max-w-[60ch] text-[13.5px] leading-relaxed text-mute">
              Property owners: pitch your job free, and your record builds from
              the first completed job. Tradespeople: pass verification and every
              job on this board is yours to quote.
            </p>
          </div>
          <div className="flex flex-wrap gap-2.5">
            <Link href="/jobs/new" className="rounded-full bg-linear-to-r from-purple to-gold px-5 py-2.5 text-[13px] font-bold text-white shadow-[0_0_18px_rgba(155,115,245,0.25)] transition hover:-translate-y-px hover:brightness-110">Post a job, free &rarr;</Link>
            <Link href="/apply" className="rounded-full border-[1.5px] border-purple/32 px-5 py-2.5 text-[13px] font-bold text-purpleb transition hover:border-purple hover:bg-panel2">Join as a worker &rarr;</Link>
          </div>
          <div className="flex w-full flex-wrap gap-4 font-mono-app text-[10.5px] text-dim">
            <Link href="/portal/guidelines?read=client_guidelines" className="underline underline-offset-2 transition hover:text-purpleb">Read the Client Guidelines</Link>
            <Link href="/portal/guidelines?read=worker_guidelines" className="underline underline-offset-2 transition hover:text-purpleb">Read the Worker Guidelines</Link>
            <span>A human confirms every step that moves money or changes a reputation.</span>
          </div>
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
    <>
      <p className="mt-4 font-mono-app text-[11px] font-medium uppercase tracking-[0.06em] text-dim">
        Every profile verified: government photo ID on a video call, references called
      </p>
      <div className="mt-4 grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
        {workers.map((w, i) => {
          const initials = (w.name ?? "W").split(" ").map((x) => x[0]).join("").slice(0, 2);
          // Book routes into the post-a-job flow with this worker requested,
          // per the founder's call: one flow, one place a job is created,
          // and the enquiry says who the client asked for.
          const book = `/jobs/new?${[w.slug && `worker=${encodeURIComponent(w.slug)}`, w.trade && `trade=${encodeURIComponent(w.trade)}`].filter(Boolean).join("&")}`;
          return (
            <div key={i} className="group flex flex-col gap-3.5 overflow-hidden rounded-[18px] border border-line bg-linear-to-b from-[rgba(19,19,50,0.9)] to-[rgba(12,12,38,0.75)] p-5 shadow-[inset_0_1px_0_rgba(238,238,255,0.04)] transition duration-200 hover:-translate-y-0.5 hover:border-purple/40">
              {/* Pictures first, and each one its own: the worker's portrait,
                  then their work. Placeholders until image storage exists. */}
              <div className="flex gap-2.5">
                <div className="relative grid size-[88px] shrink-0 place-items-center rounded-xl border border-line2 bg-[radial-gradient(ellipse_at_30%_20%,rgba(155,115,245,0.32)_0%,transparent_60%),linear-gradient(150deg,rgba(123,79,224,0.38),rgba(245,158,11,0.16))]">
                  <span className="font-display text-[26px] font-medium text-white/90">{initials}</span>
                  <span className="absolute inset-x-0 bottom-0 bg-linear-to-t from-bg/85 to-transparent py-0.5 text-center font-mono-app text-[7.5px] font-medium uppercase tracking-[0.12em] text-ink/55">
                    photo
                  </span>
                </div>
                <div className="grid flex-1 grid-cols-2 grid-rows-2 gap-2.5">
                  {[0, 1, 2, 3].map((k) => (
                    <span key={k} className="rounded-lg border border-line bg-linear-to-br from-purple/18 to-gold/[0.08] transition group-hover:border-line2" />
                  ))}
                </div>
              </div>
              <span className="-mt-1.5 font-mono-app text-[9px] font-semibold uppercase tracking-[0.16em] text-dim">
                Portrait &amp; recent work · verified photos
              </span>

              <div className="flex items-start gap-3">
                <span className="min-w-0 flex-1">
                  <b className="block text-[15.5px] font-bold leading-tight">{w.name}</b>
                  <small className="block text-[12.5px] text-mute">{w.trade ?? "General trades"}</small>
                  <small className="block font-mono-app text-[10.5px] font-medium uppercase text-dim">{w.parish}</small>
                </span>
                <span className="text-right font-mono-app text-[11px] font-semibold text-goldb">
                  {w.jobs_completed ?? 0}
                  <small className="block font-mono-app text-[9px] font-medium uppercase tracking-[0.08em] text-dim">jobs</small>
                </span>
              </div>

              {(w.about || w.years) && (
                <p className="text-[12.5px] leading-relaxed text-mute">
                  {w.years ? <b className="font-semibold text-ink">{w.years} years in the trade. </b> : null}
                  {w.about ? w.about.slice(0, 150) + (w.about.length > 150 ? "…" : "") : null}
                </p>
              )}

              <div className="flex flex-wrap gap-1.5">
                <span className="rounded-full border border-line bg-panel2 px-2.5 py-1 text-[10.5px] font-semibold text-mute">ID verified</span>
                <span className={"rounded-full px-2.5 py-1 text-[10.5px] font-semibold " + (w.lane === "cert" ? "border border-gold/35 bg-gold/[0.08] text-goldb" : "border border-purple/30 bg-purple/[0.08] text-purpleb")}>
                  {w.lane === "cert" ? "Certified professional" : "Evidence vetted"}
                </span>
              </div>

              <div className="mt-auto grid grid-cols-2 gap-2">
                {w.slug ? (
                  <Link href={"/workers/" + encodeURIComponent(w.slug)} className="rounded-full border-[1.5px] border-purple/30 py-2.5 text-center text-[12.5px] font-semibold text-purpleb transition hover:border-purple hover:bg-panel2">
                    View profile
                  </Link>
                ) : <span />}
                <Link href={book} className="rounded-full bg-linear-to-br from-goldb to-gold py-2.5 text-center text-[12.5px] font-bold text-[#1A0F00] transition hover:-translate-y-px hover:brightness-105">
                  Book for a job
                </Link>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
