import Link from "next/link";
import { TRADES } from "@/lib/taxonomy";
import { WorkerDirectory, WORKER_VIEW, SELECT_WORKER, type Worker } from "@/components/WorkerDirectory";
import { createClient } from "@/lib/supabase/server";
import { getUser } from "@/lib/supabase/auth";
import { QuotePanel } from "@/components/QuotePanel";
import { RequestedJobs, type RequestedJob } from "@/components/RequestedJobs";

export const dynamic = "force-dynamic";

/**
 * The marketplace board, MARKETPLACE-BUILD-SPEC v1.0, built at
 * app.yaadly.co.uk/jobs per the founder's decision that the product lives
 * in the app. Two independent switches: vmode (visitor or approved worker,
 * a REAL auth state here, derived server-side) and mtab (jobs/workers).
 * Reads only the open_jobs and client_summary views plus public
 * worker_profiles and job_photos. budget_band is never selected anywhere
 * on this page; the view makes that structural.
 *
 * Restyled Sep 2026 to the purple/gold system the marketing site now uses:
 * photos lead every card, on jobs and on worker profiles alike, because the
 * board is the thing people are asked to browse and evidence is what it
 * sells. Nothing about the data or the gate changed in that pass.
 *
 * Rebuilt 6 September 2026 to the "Job Board" Claude Design comp, approved
 * by Monique. What changed is shape, not data: one column of wide cards with
 * the photograph in a fixed left rail, a sticky filter bar carrying search
 * and sort, and a sticky right rail that lifts "how quoting works" and the
 * join panel out of the page footer where nobody scrolled to them.
 *
 * FOUR THINGS IN THE COMP WERE NOT BUILT, and they are recorded here so the
 * next pass does not helpfully restore them:
 *
 *   The comp's rail said "Money is held before you lift a tool" and its
 *   profile panel said "money is held by Yaadly until you approve the
 *   photos". CLAUDE.md section 8 and docs/COPY-GUIDELINES.md section 3 both
 *   ban that claim outright; guardrails.ts carries the 5 Sep note about the
 *   one banned idea the screen could not see. The rail says what is true
 *   instead: you are Yaadly's subcontractor, and a named person at Yaadly
 *   checks the work before Yaadly pays you.
 *
 *   The comp's "Each stage releases only when you sign it off" makes the
 *   client's click the trigger that moves a subcontractor's pay. Banned by
 *   COPY-GUIDELINES section 3, and not for tone: under the principal model
 *   the client does not contract with the tradesperson at all.
 *
 *   The comp's fourth stat card read "100% guidelines signed". Caught by the
 *   banned list in both runtimes. It is the worker count instead, which is a
 *   real number this page already had.
 *
 *   The comp gave the free-text Access note its own labelled row on every
 *   card ("Cousin holds the key. Mother is 74 and lives there"). Not built,
 *   because open_jobs is written to keep that class of sentence off a public
 *   page: it regexes out Address and Access contact lines and phone numbers
 *   before anything reaches here. access_type, the structured answer, shows
 *   in the spec chips instead.
 *
 *   READ THIS BEFORE YOU CONCLUDE THE BOARD IS CLEAN. The masking regex
 *   matches "Address:" and "Access contact:", and a plain "Access:" line
 *   matches neither, so access notes ARE reaching the public board today
 *   inside descr, on live jobs, and were before this restyle. Not fixed here
 *   because a restyle is the wrong change to bury a masking fix in, and
 *   widening the regex is a call about what a client was told when they
 *   typed it. Raised with Monique 6 Sep 2026.
 *
 * Also dropped: the comp's Save star, which nothing stores, and its "Display
 * and test listings" block, which put internal WhatsApp and wizard test jobs
 * on a public page.
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

/** The same test the admin desk uses to chip a job red, deliberately. There is
 *  no CHECK constraint on jobs.urgency and the wording of the options lives in
 *  web/lib/jobs/new-form.ts, so matching on the word rather than on an exact
 *  string is what keeps the desk and the board agreeing about which jobs are
 *  the urgent ones. */
const URGENT = /urgent|emergency/i;

type Photo = { job_id: string; caption: string; img: string | null; position: number; storage_path: string | null };
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
  description: "Open property jobs across Jamaica and the identity checked workers who do them. You buy the job from Yaadly, and nothing is signed off until you have seen the evidence.",
};

/* The Yaadly WhatsApp Business sender, one number across the whole site, and
   an opener that tells the person reading it what this message is about.
   Monique's call, 6 Sep 2026: the alerts panel ships, but it collects
   something rather than sitting there as a promise with a dead button. It
   lands in yaad-inbound, where worker conversations already go, so there is
   no new table, no new migration and nowhere new for personal data to sit. */
const WA_ALERTS =
  "https://wa.me/447878877567?text=" +
  encodeURIComponent("Hello Yaadly, I am a worker and I want WhatsApp job alerts. My trades and parishes are:");

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
  searchParams: Promise<{ trade?: string; tab?: string; q?: string; pics?: string; find?: string; sort?: string }>;
}) {
  const { trade, tab, q, pics, find, sort } = await searchParams;
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

  /* Jobs a client asked THIS worker for by name, still inside the 48 hour
     first-refusal window. They are deliberately absent from open_jobs while
     the hold is live, so without this query the one person entitled to quote
     would be the one person who could not see it. my_requested_jobs filters
     on the caller's own JWT email in Postgres; there is no .eq() here for the
     same reason the portal has none on jobs. Visitors get an empty list. */
  const { data: requestedData } = vmode === "worker"
    ? await supabase.from("my_requested_jobs")
        .select("id,title,parish,trade,descr,urgency,holds_until")
        .order("requested_at", { ascending: true })
    : { data: [] as RequestedJob[] };
  const requested = (requestedData ?? []) as RequestedJob[];

  /* The trade filter moved out of the query and into JS on 6 Sep 2026, and it
     is a deliberate trade. It used to be .eq("trade", trade) here, which meant
     `jobs` was the filtered list and every number on the page was quietly
     filtered with it: the headline stat said "3 jobs open now" while eighteen
     were. It also cost a second round trip to open_jobs purely to count trades.
     One query now returns the whole open board, the counts are the board's, and
     the filtering happens below. The board is a pilot-sized list of open jobs,
     so this is a handful of rows, not a table scan pushed into the app. */
  const [{ data: jobsData }, { data: workersData }] = await Promise.all([
    supabase.from("open_jobs").select("*").order("updated_at", { ascending: false }),
    // public_worker_profiles, not the base table: it already excludes
    // worker_email and phone, neither of which this board (or any visitor)
    // has any business reading. See 20260903f in supabase/migrations.
    // The name and the column list come from the component that renders them,
    // so /jobs and /workers cannot read different things into the same card.
    supabase.from(WORKER_VIEW).select(SELECT_WORKER).order("jobs_completed", { ascending: false }),
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
  const showWorkers = tab === "workers";

  /* ── the board's own numbers, off the whole open board ────────────────── */
  const isUrgent = (j: OpenJob) => URGENT.test(j.urgency ?? "");
  const statUrgent = jobs.filter(isUrgent).length;
  // "Saint Catherine" and "St Catherine" are one parish. Intake has written it
  // both ways, so the count normalises before it counts or it reads two.
  const statParishes = new Set(
    jobs.map((j) => (j.parish ?? "").replace(/^Saint /i, "St ").replace(/^St\. /i, "St ").trim()).filter(Boolean)
  ).size;
  const trades = [...new Set(jobs.map((t) => t.trade).filter(Boolean))] as string[];
  const tradeCount = new Map<string, number>();
  for (const j of jobs) if (j.trade) tradeCount.set(j.trade, (tradeCount.get(j.trade) ?? 0) + 1);

  /* ── filter and sort ─────────────────────────────────────────────────── */
  const needle = (find ?? "").trim().toLowerCase();
  let visible = jobs.filter(
    (j) =>
      (!trade || j.trade === trade) &&
      (!needle ||
        [j.title, j.descr, j.parish, j.trade, j.job_type].filter(Boolean).join(" ").toLowerCase().includes(needle))
  );
  /* Array.prototype.sort is stable, so both of these keep newest-first inside
     each group rather than shuffling equal jobs about on every render. Newest
     stays the default: the query already returns that order, and quietly
     changing what a worker sees at the top of the board is not a restyle. */
  if (sort === "urgent") visible = [...visible].sort((a, b) => Number(isUrgent(b)) - Number(isUrgent(a)));
  if (sort === "kingston")
    visible = [...visible].sort(
      (a, b) => Number(!a.parish?.includes("Kingston")) - Number(!b.parish?.includes("Kingston"))
    );

  const newest = jobs[0]?.updated_at ? new Date(jobs[0].updated_at).getTime() : 0;

  /* Every link on this page is this page with one thing changed. Passing the
     whole set through means a worker who searched, filtered and sorted does
     not lose two of the three by opening a quote panel. */
  const href = (over: Record<string, string | null | undefined>) => {
    const merged: Record<string, string | null | undefined> = {
      trade, tab: showWorkers ? "workers" : undefined, find, sort, q, pics, ...over,
    };
    const s = Object.entries(merged)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`)
      .join("&");
    return "/jobs" + (s ? "?" + s : "");
  };

  const chip = (on: boolean) =>
    "inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[12.5px] font-semibold transition " +
    (on
      ? "border-transparent bg-linear-to-br from-goldb to-gold text-[#1A0F00]"
      : "border-purple/28 bg-purple/[0.08] text-purpleb hover:border-purple/60 hover:text-ink");
  const sortBtn = (on: boolean) =>
    "rounded-full px-3.5 py-1.5 text-[12px] transition " +
    (on ? "bg-panel2 font-semibold text-ink" : "font-medium text-mute hover:text-ink");
  const tabBtn = (on: boolean, accent: string) =>
    "-mb-px inline-flex items-center gap-2 border-b-2 px-0.5 pb-3.5 text-[15px] transition " +
    (on ? `font-semibold text-ink ${accent}` : "border-transparent font-medium text-mute hover:text-ink");

  /* The rail's closing line, identical on both tabs and on the profile pages,
     because it is a control in the system and not a per-page flourish. */
  const humanLine = (
    <p className="mt-4 border-t border-line pt-3.5 text-[12.5px] text-dim">
      A human confirms every step that moves money or changes a reputation.
    </p>
  );

  return (
    <>
      {/* ── HEAD ───────────────────────────────────────────────── */}
      <header className="mx-auto max-w-[1240px] px-7 pt-11 max-[820px]:px-5">
        <div className="flex flex-wrap items-end justify-between gap-7">
          <div className="max-w-[640px]">
            <span className="inline-flex items-center gap-2 rounded-full border border-gold/30 bg-gold/[0.09] px-3.5 py-1.5 font-mono-app text-[11px] font-semibold uppercase tracking-[0.14em] text-goldb">
              <i className="size-[5px] animate-pulse rounded-full bg-gold" />
              Live board
            </span>

            {showWorkers ? (
              <>
                <h1 className="mt-4.5 font-display text-[clamp(34px,4.6vw,54px)] font-extralight leading-[1.05] tracking-[-0.025em]">
                  The people who
                  <br />
                  <em className="bg-linear-to-r from-purpleb via-purple to-gold bg-clip-text font-light text-transparent italic">
                    actually do the work.
                  </em>
                </h1>
                <p className="mt-4 max-w-[56ch] text-pretty text-[16.5px] leading-relaxed text-mute">
                  Identity checked with an independent provider, TRN checked against the ID.{" "}
                  <b className="font-semibold text-ink">
                    A small network on purpose, nobody appears here until they pass.
                  </b>
                </p>
              </>
            ) : (
              <>
                <h1 className="mt-4.5 font-display text-[clamp(34px,4.6vw,54px)] font-extralight leading-[1.05] tracking-[-0.025em]">
                  Jobs open to quote
                  <br />
                  <em className="bg-linear-to-r from-purpleb via-purple to-gold bg-clip-text font-light text-transparent italic">
                    right now, across Jamaica.
                  </em>
                </h1>
                {/* The bold half is the sentence docs/COPY-GUIDELINES.md
                    section 3 makes the source of truth across docs/ and web/,
                    word for word, so the two halves of the site say the same
                    thing to a visitor who lands straight on the board. */}
                <p className="mt-4 max-w-[56ch] text-pretty text-[16.5px] leading-relaxed text-mute">
                  Every listing here is a signed job with a real client behind it.{" "}
                  <b className="font-semibold text-ink">
                    You buy the job from Yaadly, and nothing is signed off until you have seen the evidence.
                  </b>
                </p>
              </>
            )}

            <p className="mt-3 flex items-center gap-2 font-mono-app text-[11px] font-medium tracking-[0.06em] text-dim">
              <svg viewBox="0 0 24 24" className="size-3.5 shrink-0 fill-none stroke-gold stroke-2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="5" y="11" width="14" height="9" rx="2" />
                <path d="M8 11V8a4 4 0 0 1 8 0v3" />
              </svg>
              No addresses. No phone numbers. No budgets shown. Ever.
            </p>
          </div>

          {/* Four real counts. The comp's fourth was "100% guidelines signed",
              which the banned list catches in both runtimes; the worker count
              is a number this page already had and did not have to invent. */}
          <div className="grid min-w-[280px] grid-cols-2 gap-3.5">
            {[
              { n: jobs.length, label: "open to quote", tone: "text-ink", box: "border-line bg-linear-to-b from-[rgba(19,19,50,0.8)] to-[rgba(12,12,38,0.6)]" },
              { n: statUrgent, label: "marked urgent", tone: "text-goldb", box: "border-gold/30 bg-linear-to-b from-gold/[0.09] to-[rgba(12,12,38,0.6)]" },
              { n: statParishes, label: "parishes covered", tone: "text-ink", box: "border-line bg-linear-to-b from-[rgba(19,19,50,0.8)] to-[rgba(12,12,38,0.6)]" },
              { n: workers.length, label: "identity checked workers", tone: "text-green", box: "border-line bg-linear-to-b from-[rgba(19,19,50,0.8)] to-[rgba(12,12,38,0.6)]" },
            ].map((s) => (
              <div key={s.label} className={"min-w-[130px] rounded-[14px] border px-4 py-3.5 " + s.box}>
                <b className={"block font-mono-app text-[26px] font-semibold tabular-nums " + s.tone}>{s.n}</b>
                <span className="mt-0.5 block text-[11.5px] leading-tight text-dim">{s.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Above the tabs and above the board, because a two day clock is
            running on it and the client who asked chose this worker on purpose.
            Renders nothing at all for a visitor, a client, or a worker nobody
            has asked for. See components/RequestedJobs.tsx. */}
        <RequestedJobs jobs={requested} />

        {/* ── TABS ─────────────────────────────────────────────── */}
        <div className="mt-9 flex flex-wrap gap-6.5 border-b border-line">
          <Link href={href({ tab: null })} aria-current={!showWorkers ? "page" : undefined} className={tabBtn(!showWorkers, "border-gold")}>
            Open jobs
            <span className={"rounded-full px-2 py-px font-mono-app text-[11px] font-semibold " + (!showWorkers ? "bg-gold/[0.12] text-goldb" : "bg-panel2 text-mute")}>
              {jobs.length}
            </span>
          </Link>
          <Link href={href({ tab: "workers", q: null, pics: null })} aria-current={showWorkers ? "page" : undefined} className={tabBtn(showWorkers, "border-purple")}>
            The worker network
            <span className={"rounded-full px-2 py-px font-mono-app text-[11px] font-semibold " + (showWorkers ? "bg-purple/[0.14] text-purpleb" : "bg-panel2 text-mute")}>
              {workers.length}
            </span>
          </Link>
        </div>
      </header>

      {/* ── FILTER BAR ─────────────────────────────────────────────
          Sticky only from 821px up. SiteNav is sticky at top-0 and 58px tall,
          but it wraps to two rows below 820px (max-[820px]:flex-wrap), so a
          fixed 58px offset would park this bar over the header on a phone,
          which is the one screen a worker actually reads the board on. */}
      {!showWorkers && (
        <div className="z-30 border-b border-line bg-bg/90 backdrop-blur-[10px] min-[821px]:sticky min-[821px]:top-[58px]">
          <div className="mx-auto flex max-w-[1240px] flex-wrap items-center gap-3.5 px-7 py-3.5 max-[820px]:px-5">
            {/* A plain GET form, no client bundle. The board is force-dynamic
                and the whole page is a server component, so search costs a
                navigation and nothing else. The hidden fields are what stop a
                search from silently clearing the trade and sort a worker set
                thirty seconds ago. */}
            <form action="/jobs" method="get" className="flex min-w-[220px] max-w-[340px] flex-1 items-center gap-2.5 rounded-full border border-line2 bg-bg/60 px-4 py-2 focus-within:border-purple/60">
              {trade && <input type="hidden" name="trade" value={trade} />}
              {sort && <input type="hidden" name="sort" value={sort} />}
              <svg viewBox="0 0 24 24" className="size-[15px] shrink-0 fill-none stroke-dim stroke-2" strokeLinecap="round">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
              <input
                type="text"
                name="find"
                defaultValue={find ?? ""}
                placeholder="Search scope, parish or trade"
                aria-label="Search open jobs"
                className="min-w-0 flex-1 bg-transparent text-[13.5px] text-ink outline-none placeholder:text-dim"
              />
            </form>

            <div className="flex flex-wrap items-center gap-1.5">
              <Link href={href({ trade: null, q: null, pics: null })} aria-current={!trade ? "page" : undefined} className={chip(!trade)}>
                All trades
                <span className={"font-mono-app text-[11px] font-semibold " + (!trade ? "opacity-70" : "text-dim")}>{jobs.length}</span>
              </Link>
              {trades.map((t) => (
                <Link key={t} href={href({ trade: t, q: null, pics: null })} aria-current={trade === t ? "page" : undefined} className={chip(trade === t)}>
                  {t}
                  <span className={"font-mono-app text-[11px] font-semibold " + (trade === t ? "opacity-70" : "text-dim")}>{tradeCount.get(t) ?? 0}</span>
                </Link>
              ))}
              <Link href="/jobs/trades" className="px-1.5 py-1.5 font-mono-app text-[11px] font-semibold uppercase tracking-[0.08em] text-dim transition hover:text-purpleb">
                All {TRADES.length} trades &rarr;
              </Link>
            </div>

            <div className="ml-auto flex items-center gap-2.5">
              <span className="font-mono-app text-[10px] font-semibold uppercase tracking-[0.16em] text-dim">Sort</span>
              <div className="flex gap-1 rounded-full border border-line bg-bg/60 p-1">
                <Link href={href({ sort: null })} className={sortBtn(!sort)}>Newest</Link>
                <Link href={href({ sort: "urgent" })} className={sortBtn(sort === "urgent")}>Most urgent</Link>
                <Link href={href({ sort: "kingston" })} className={sortBtn(sort === "kingston")}>Kingston first</Link>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── BOARD ──────────────────────────────────────────────── */}
      <main className="mx-auto flex max-w-[1240px] flex-wrap items-start gap-7 px-7 pb-16 pt-7 max-[820px]:px-5">
        {showWorkers ? (
          <>
            <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-4.5">
              {/* The comp's strip said "identity checked with an independent
                  provider, TRN checked against the ID", which is word for word
                  the line WorkerDirectory already prints directly underneath
                  it. Two identical sentences stacked read as a page that lost
                  track of itself, so this carries the third clause, the one
                  the component does not say. */}
              <div className="flex flex-wrap items-center gap-3 rounded-[14px] border border-green/24 bg-green/[0.06] px-4 py-3.5">
                <span className="shrink-0 font-mono-app text-[9.5px] font-semibold uppercase tracking-[0.14em] text-green">The standard</span>
                <span className="text-[13.5px] text-mute">
                  Every photograph on these profiles was reviewed by a person before it was shown.
                </span>
              </div>

              {/* The comp had a count line here. It came out: the tab directly
                  above already reads "The worker network 6", and WorkerDirectory
                  prints its own standard line underneath, so this was the third
                  label in a stack of three before a single card. */}
              <WorkerDirectory workers={workers} />

              <div className="flex flex-wrap items-center gap-5 rounded-[18px] border border-dashed border-line2 bg-purple/[0.04] p-5.5">
                <div className="flex-[1_1_260px]">
                  <span className="font-mono-app text-[10px] font-semibold uppercase tracking-[0.18em] text-dim">Vetting is ongoing</span>
                  <p className="mt-1 font-display text-[21px] font-light leading-[1.25] tracking-[-0.015em]">
                    More tradespeople are being verified now
                  </p>
                  <p className="mt-2 max-w-[52ch] text-[13.5px] leading-relaxed text-mute">
                    Nobody appears on this page until identity, TRN and trade evidence all clear. Every name here has
                    been checked by a person.
                  </p>
                </div>
                <Link href="/apply" className="whitespace-nowrap rounded-full bg-linear-to-r from-purple to-gold px-5.5 py-3 text-[14px] font-bold text-white shadow-[0_0_24px_rgba(155,115,245,0.28)] transition hover:-translate-y-px hover:brightness-110">
                  Join as a pro &rarr;
                </Link>
              </div>
            </div>

            <aside className="flex min-w-0 max-w-[316px] flex-[1_1_280px] flex-col gap-4 min-[821px]:sticky min-[821px]:top-[86px]">
              <div className="rounded-[18px] border border-line bg-linear-to-b from-[rgba(19,19,50,0.8)] to-[rgba(12,12,38,0.6)] p-5">
                <span className="font-mono-app text-[10px] font-semibold uppercase tracking-[0.18em] text-dim">How verification works</span>
                <div className="mt-3.5 flex flex-col gap-3.5">
                  {[
                    ["Independent identity check", "Government ID verified by a third-party provider, not by us."],
                    ["TRN matched to the ID", "The tax number has to belong to the same person."],
                    ["Trade evidence vetted", "Photographs of past work reviewed before the profile goes live."],
                  ].map(([head, body], i) => (
                    <div key={head} className="flex gap-3">
                      <span className="shrink-0 pt-0.5 font-mono-app text-[12px] font-semibold text-purpleb">0{i + 1}</span>
                      <div>
                        <b className="block text-[14px] font-semibold">{head}</b>
                        <span className="text-[13px] leading-snug text-mute">{body}</span>
                      </div>
                    </div>
                  ))}
                </div>
                {humanLine}
              </div>

              <div className="rounded-[18px] border border-gold/28 bg-linear-to-b from-gold/10 to-[rgba(12,12,38,0.6)] p-5">
                <p className="font-display text-[20px] font-light leading-[1.25] tracking-[-0.015em]">Rather we picked for you?</p>
                {/* The comp said "You still approve every stage", which under
                    the principal model overstates what the client's click
                    does. COPY-GUIDELINES section 3 gives the true version. */}
                <p className="mt-2 text-[13.5px] leading-relaxed text-mute">
                  Post the job and we route it to the verified workers who cover that trade and parish. You see the
                  evidence before you are asked to accept the work.
                </p>
                <Link href="/jobs/new" className="mt-3.5 inline-flex w-full items-center justify-center rounded-full bg-linear-to-br from-goldb to-gold px-4.5 py-2.5 text-[13.5px] font-bold text-[#1A0F00] transition hover:brightness-105">
                  Post a job, free
                </Link>
                <Link href="/portal/guidelines?read=client_guidelines" className="mt-2.5 block text-center text-[12.5px] text-mute transition hover:text-purpleb">
                  Read the Client Guidelines
                </Link>
              </div>
            </aside>
          </>
        ) : (
          <>
            <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-4">
              <div className="flex flex-wrap items-baseline justify-between gap-4">
                <span className="font-mono-app text-[10px] font-semibold uppercase tracking-[0.18em] text-dim">
                  {visible.length === jobs.length
                    ? `${jobs.length} job${jobs.length === 1 ? "" : "s"} open to quote`
                    : `Showing ${visible.length} of ${jobs.length} open jobs`}
                </span>
                <span className="text-[12.5px] text-dim">
                  Drafts and unsigned jobs are not listed, they are not real work yet.
                </span>
              </div>

              {visible.length === 0 ? (
                <div className="rounded-[18px] border border-dashed border-line2 bg-purple/[0.04] px-7 py-11 text-center">
                  {/* The two audiences, kept from the Sep 2026 board pass: one
                      generic sentence told a worker hunting their trade the
                      same thing it told a client with nothing posted yet. */}
                  {jobs.length > 0 ? (
                    <>
                      <p className="font-display text-[24px] font-light tracking-[-0.01em]">Nothing open in that filter today.</p>
                      <p className="mt-2.5 text-[14px] text-mute">
                        Clear the filters to see everything currently open to quote.
                      </p>
                      <Link href="/jobs" className="mt-5 inline-flex rounded-full bg-linear-to-br from-goldb to-gold px-5.5 py-2.5 text-[13.5px] font-bold text-[#1A0F00] transition hover:brightness-105">
                        Clear filters
                      </Link>
                    </>
                  ) : vmode === "worker" ? (
                    <>
                      <p className="font-display text-[24px] font-light tracking-[-0.01em]">Nothing open right now.</p>
                      <p className="mt-2.5 text-[14px] text-mute">New jobs land here the moment they are opened.</p>
                    </>
                  ) : (
                    <>
                      <p className="font-display text-[24px] font-light tracking-[-0.01em]">No jobs are open for quotes right now.</p>
                      <p className="mt-2.5 text-[14px] text-mute">Post yours, free, and it can be the next one on this board.</p>
                      <Link href="/jobs/new" className="mt-5 inline-flex rounded-full bg-linear-to-br from-goldb to-gold px-5.5 py-2.5 text-[13.5px] font-bold text-[#1A0F00] transition hover:brightness-105">
                        Post a job, free
                      </Link>
                    </>
                  )}
                </div>
              ) : (
                visible.map((j) => {
                  // Only pictures that actually resolved. A tile with nothing in
                  // it is not a photograph, and counting it would overstate what
                  // a worker has been given to quote from.
                  const ph = (photosByJob.get(j.id) ?? []).filter((p) => p.img);
                  const expanded = pics === j.id;
                  const fresh = !!j.updated_at && newest - new Date(j.updated_at).getTime() < 1000 * 60 * 60 * 6;
                  const sp = [j.job_type, j.size_band, j.access_type, j.materials_by,
                    STORE_LABEL[j.materials_store_type ?? ""]].filter(Boolean) as string[];
                  const open = q === j.id;
                  const urgent = isUrgent(j);
                  return (
                    <article
                      key={j.id}
                      id={j.id}
                      className={
                        "group relative flex scroll-mt-32 flex-wrap gap-5 overflow-hidden rounded-[18px] border bg-linear-to-b from-[rgba(19,19,50,0.9)] to-[rgba(12,12,38,0.75)] px-5.5 pb-4.5 pt-5 shadow-[inset_0_1px_0_rgba(238,238,255,0.04)] transition duration-200 " +
                        (urgent || fresh ? "border-gold/24 hover:border-gold/50" : "border-line hover:border-purple/40")
                      }
                    >
                      {(urgent || fresh) && (
                        <span className="absolute inset-y-0 left-0 w-[3px] bg-linear-to-b from-gold to-transparent" />
                      )}

                      {/* The evidence column. The comp leads every card with a
                          picture and that is the right instinct: the board is
                          the thing people are asked to browse, and what it
                          sells is being able to see the job. */}
                      {/* Capped at 220px beside the text, uncapped once the card has
                          wrapped to one column, which is a phone. A worker mid-job
                          reads this on a 390px screen and a 220px photograph in the
                          middle of it is the one thing they came to look at, small. */}
                      <div className="flex min-w-[150px] flex-[1_1_176px] flex-col gap-2 min-[821px]:max-w-[220px]">
                        {ph.length > 0 ? (
                          <>
                            <figure className="relative h-[132px] overflow-hidden rounded-xl border border-line2 bg-linear-to-br from-purple/28 to-gold/12">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={ph[0].img as string} alt={ph[0].caption} className="size-full object-cover" />
                              <figcaption className="absolute inset-x-0 bottom-0 bg-linear-to-t from-bg/90 to-transparent px-2.5 py-1.5 font-mono-app text-[9px] font-medium leading-tight text-ink/90">
                                {ph[0].caption}
                              </figcaption>
                            </figure>
                            {expanded && ph.length > 1 && (
                              <div className="grid grid-cols-2 gap-2">
                                {ph.slice(1).map((p, i) => (
                                  <figure key={i} className="relative h-[62px] overflow-hidden rounded-lg border border-line2">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={p.img as string} alt={p.caption} className="size-full object-cover" />
                                  </figure>
                                ))}
                              </div>
                            )}
                            <span className="font-mono-app text-[9.5px] font-medium tracking-[0.05em] text-green">
                              ✓ {ph.length} photo{ph.length === 1 ? "" : "s"} from the client, all reviewed for this listing
                            </span>
                            {ph.length > 1 && (
                              <Link
                                href={expanded ? href({ pics: null }) : href({ pics: j.id })}
                                className="self-start rounded-full border border-gold/35 bg-gold/[0.06] px-3 py-1 font-mono-app text-[10.5px] font-semibold text-goldb transition hover:border-gold hover:bg-gold/10"
                              >
                                {expanded ? "Show less" : `+${ph.length - 1} more`}
                              </Link>
                            )}
                          </>
                        ) : (
                          <>
                            <div className="flex h-[132px] flex-col items-center justify-center gap-2.5 rounded-xl border border-dashed border-purple/30 bg-purple/[0.05]">
                              <span className="font-display text-[26px] font-light text-purpleb">
                                {(j.trade ?? "J").charAt(0)}
                              </span>
                              <span className="px-2.5 text-center font-mono-app text-[9px] font-semibold uppercase tracking-[0.12em] text-dim">
                                Photos to follow
                              </span>
                            </div>
                            <span className="font-mono-app text-[9.5px] font-medium tracking-[0.05em] text-dim">
                              Ask for photos in your quote
                            </span>
                          </>
                        )}
                      </div>

                      <div className="min-w-0 flex-[1_1_240px]">
                        <div className="flex flex-wrap items-start gap-3">
                          <h2 className="min-w-[220px] flex-1 text-pretty font-display text-[21px] font-normal leading-[1.25] tracking-[-0.01em]">
                            {j.title ?? "Job"}
                          </h2>
                          <span className="flex flex-wrap gap-1.5">
                            {urgent && (
                              <span className="inline-flex items-center gap-1.5 rounded-full border border-gold/35 bg-gold/10 px-2.5 py-1 text-[11px] font-semibold text-goldb">
                                <i className="size-1.5 animate-pulse rounded-full bg-gold" />
                                Urgent
                              </span>
                            )}
                            {!urgent && fresh && (
                              <span className="inline-flex items-center gap-1.5 rounded-full border border-gold/35 bg-gold/10 px-2.5 py-1 text-[11px] font-semibold text-goldb">
                                <i className="size-1.5 animate-pulse rounded-full bg-gold" />
                                Just posted
                              </span>
                            )}
                            {j.trade && (
                              <span className="inline-flex items-center rounded-full border border-purple/30 bg-purple/10 px-2.5 py-1 text-[11px] font-semibold text-purpleb">
                                {j.trade}
                              </span>
                            )}
                          </span>
                        </div>

                        {sp.length > 0 && (
                          <div className="mt-3 flex flex-wrap gap-1.5">
                            {sp.map((x) => (
                              <span key={x} className="rounded-md border border-line bg-bg/50 px-2.5 py-1 font-mono-app text-[10.5px] font-medium tracking-[0.04em] text-mute">
                                {x}
                              </span>
                            ))}
                          </div>
                        )}

                        {j.descr && (
                          <p className="mt-3 max-w-[80ch] text-pretty whitespace-pre-wrap text-[13.5px] leading-relaxed text-mute">
                            {j.descr.slice(0, 260)}
                            {j.descr.length > 260 ? "..." : ""}
                          </p>
                        )}

                        <div className="mt-3.5 flex flex-wrap gap-x-4.5 gap-y-1.5 border-t border-line pt-3.5 text-[12.5px] text-dim">
                          {j.parish && <b className="font-semibold text-ink">{j.parish}</b>}
                          {j.urgency && <span>{j.urgency}</span>}
                          <span>Posted {ago(j.updated_at)}</span>
                          {j.client_signed ? (
                            <span className="inline-flex items-center gap-1.5 text-green">
                              <svg viewBox="0 0 24 24" className="size-3 fill-none stroke-green stroke-[2.5]" strokeLinecap="round" strokeLinejoin="round">
                                <path d="m5 13 4 4L19 7" />
                              </svg>
                              Client guidelines signed
                            </span>
                          ) : (
                            <span>Awaiting client signature</span>
                          )}
                          <span>
                            {(j.client_jobs_completed ?? 0) > 0
                              ? `Client · ${j.client_jobs_completed} job${j.client_jobs_completed === 1 ? "" : "s"} completed`
                              : "Client's first job on Yaadly"}
                          </span>
                        </div>

                        <div className="mt-3.5 flex flex-wrap items-center gap-3">
                          <Link
                            href={open ? href({ q: null }) : href({ q: j.id })}
                            className={vmode === "worker"
                              ? "inline-flex items-center gap-2 rounded-full bg-linear-to-r from-purple to-gold px-5 py-2.5 text-[13.5px] font-bold text-white shadow-[0_0_20px_rgba(155,115,245,0.25)] transition hover:-translate-y-px hover:brightness-110"
                              : "inline-flex items-center gap-2 rounded-full border border-line2 px-5 py-2.5 text-[13.5px] font-bold text-ink transition hover:border-purple hover:text-purpleb"}
                          >
                            {open ? "Close" : "Quote this job"}
                          </Link>
                          {/* Real trust copy for a worker, explaining a founder
                              rule they need to know about. A visitor or client
                              was never shown a price band and has no context for
                              why one is absent, so this stays worker-only. */}
                          {vmode === "worker" && (
                            <span className="font-mono-app text-[10.5px] font-medium tracking-[0.06em] text-dim">
                              QUOTE ON THE SCOPE · NO BUDGET BAND SHOWN
                            </span>
                          )}
                        </div>

                        {open && vmode !== "worker" && (
                          <div className="mt-3.5 rounded-xl border border-gold/25 bg-gold/[0.05] p-4 text-[13px] leading-relaxed text-mute">
                            <b className="font-semibold text-goldb">Quoting is for approved workers.</b>{" "}
                            A published worker profile, a signed Worker Guidelines, and a job that is genuinely open:
                            all three are checked in the database before a quote can exist. Browsing stays free for
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
                    </article>
                  );
                })
              )}
            </div>

            <aside className="flex min-w-0 max-w-[316px] flex-[1_1_280px] flex-col gap-4 min-[821px]:sticky min-[821px]:top-[144px]">
              {/* Monique's call, 6 Sep 2026: the alerts panel ships, but it
                  collects something. The button opens WhatsApp with the
                  message half written, which lands in yaad-inbound where a
                  person already reads worker messages. No new table, no new
                  place for a phone number to sit, and no promise that the
                  alerts themselves exist yet. */}
              <div className="rounded-[18px] border border-green/28 bg-linear-to-b from-green/[0.08] to-[rgba(12,12,38,0.6)] p-5">
                <span className="inline-flex items-center gap-2 font-mono-app text-[10px] font-semibold uppercase tracking-[0.18em] text-green">
                  <i className="size-[5px] animate-pulse rounded-full bg-green" />
                  Launching soon
                </span>
                <p className="mt-2 font-display text-[22px] font-light leading-[1.2] tracking-[-0.015em]">
                  WhatsApp job alerts, coming shortly.
                </p>
                <p className="mt-2.5 text-[13.5px] leading-relaxed text-mute">
                  Soon you will pick your trades and parishes once, and hear about a matching job the minute it is
                  signed. Send us your trades and parishes now and you go on the list.
                </p>
                <a
                  href={WA_ALERTS}
                  target="_blank"
                  rel="noopener"
                  className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-[#25D366] py-2.5 text-[13.5px] font-bold text-onbrand transition hover:brightness-105"
                >
                  <svg viewBox="0 0 32 32" className="size-4 fill-onbrand" aria-hidden="true">
                    <path d="M16 3C8.8 3 3 8.8 3 16c0 2.3.6 4.5 1.7 6.4L3 29l6.8-1.8A13 13 0 1 0 16 3zm0 23.6c-2 0-4-.5-5.7-1.6l-.4-.2-4 1 1.1-3.9-.3-.4A10.6 10.6 0 1 1 16 26.6zm6-7.9c-.3-.2-1.9-1-2.2-1.1-.3-.1-.5-.2-.7.2s-.8 1-1 1.2c-.2.2-.4.2-.7 0a8.7 8.7 0 0 1-4.3-3.7c-.3-.6.3-.5.9-1.7.1-.2 0-.4 0-.6l-1-2.4c-.3-.6-.5-.5-.7-.6h-.6c-.2 0-.6.1-.9.4-.3.4-1.2 1.2-1.2 2.8s1.2 3.3 1.4 3.5c.2.2 2.4 3.7 5.8 5.1 2.2.9 3 1 4.1.9.7-.1 1.9-.8 2.2-1.6.3-.8.3-1.4.2-1.6-.1-.2-.3-.2-.6-.4z" />
                  </svg>
                  Put me on the list
                </a>
              </div>

              <div className="rounded-[18px] border border-line bg-linear-to-b from-[rgba(19,19,50,0.8)] to-[rgba(12,12,38,0.6)] p-5">
                <span className="font-mono-app text-[10px] font-semibold uppercase tracking-[0.18em] text-dim">How quoting works</span>
                <div className="mt-3.5 flex flex-col gap-3.5">
                  {/* 02 and 03 are NOT the comp's wording. The comp had "money
                      is held before you lift a tool" and "each stage releases
                      when the evidence is approved"; both are banned by
                      CLAUDE.md section 8 and COPY-GUIDELINES section 3, the
                      second because it ties a subcontractor's pay to a
                      client's click. These say the true thing, which is also
                      the better pitch to a worker: your money is not waiting
                      on somebody in London. */}
                  {[
                    ["Quote the scope, not a budget", "No budget band is ever shown, so your price is your own."],
                    ["You are engaged by Yaadly, not the client", "The client buys the job from Yaadly. You never chase them for your money."],
                    ["Photos, then a named person, then paid", "A person at Yaadly checks the work and the evidence before Yaadly pays you. Never an automatic timer."],
                  ].map(([head, body], i) => (
                    <div key={head} className="flex gap-3">
                      <span className="shrink-0 pt-0.5 font-mono-app text-[12px] font-semibold text-goldb">0{i + 1}</span>
                      <div>
                        <b className="block text-[14px] font-semibold">{head}</b>
                        <span className="text-[13px] leading-snug text-mute">{body}</span>
                      </div>
                    </div>
                  ))}
                </div>
                {humanLine}
              </div>

              {vmode !== "worker" && (
                <div className="rounded-[18px] border border-line2 bg-linear-to-b from-purple/10 to-[rgba(12,12,38,0.6)] p-5">
                  <p className="font-display text-[20px] font-light leading-[1.25] tracking-[-0.015em]">Not verified yet?</p>
                  <p className="mt-2 text-[13.5px] leading-relaxed text-mute">
                    Pass identity and trade verification once, and every job on this board is yours to quote.
                  </p>
                  <Link href="/apply" className="mt-3.5 inline-flex w-full items-center justify-center rounded-full bg-linear-to-r from-purple to-gold px-4.5 py-2.5 text-[13.5px] font-bold text-white transition hover:brightness-110">
                    Join as a pro
                  </Link>
                  <Link href="/portal/guidelines?read=worker_guidelines" className="mt-2.5 block text-center text-[12.5px] text-mute transition hover:text-purpleb">
                    Read the Worker Guidelines
                  </Link>
                </div>
              )}

              <div className="rounded-[18px] border border-line bg-purple/[0.05] px-5 py-4">
                <p className="text-[13.5px] leading-relaxed text-mute">
                  Not sure you have a job yet?{" "}
                  <Link href="/ask" className="font-semibold text-purpleb underline underline-offset-2">Ask Yaadly</Link>
                  , and a person answers.
                </p>
              </div>
            </aside>
          </>
        )}
      </main>

      {/* ── JOIN ───────────────────────────────────────────────── */}
      <section className="border-t border-line bg-purple/[0.04]">
        <div className="mx-auto flex max-w-[1240px] flex-wrap items-center justify-between gap-8 px-7 py-14 max-[820px]:px-5">
          <div className="max-w-[520px]">
            <h2 className="font-display text-[clamp(28px,3.4vw,40px)] font-extralight leading-[1.1] tracking-[-0.02em]">
              Want to be{" "}
              <em className="bg-linear-to-r from-purpleb via-purple to-gold bg-clip-text font-light text-transparent italic">
                part of it?
              </em>
            </h2>
            <p className="mt-3.5 text-pretty text-[15.5px] leading-relaxed text-mute">
              Property owners: pitch your job free, and your record builds from the first completed job. Tradespeople:
              pass verification and this whole board opens up.
            </p>
            <div className="mt-4 flex flex-wrap gap-4 font-mono-app text-[10.5px] text-dim">
              <Link href="/portal/guidelines?read=client_guidelines" className="underline underline-offset-2 transition hover:text-purpleb">Read the Client Guidelines</Link>
              <Link href="/portal/guidelines?read=worker_guidelines" className="underline underline-offset-2 transition hover:text-purpleb">Read the Worker Guidelines</Link>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href="/jobs/new" className="rounded-full bg-linear-to-r from-purple to-gold px-6 py-3.5 text-[14.5px] font-bold text-white shadow-[0_0_24px_rgba(155,115,245,0.28)] transition hover:-translate-y-px hover:brightness-110">
              Post a job, free &rarr;
            </Link>
            <Link href="/apply" className="rounded-full border border-line2 px-5.5 py-3 text-[14.5px] font-semibold text-ink transition hover:border-purple hover:text-purpleb">
              Join as a worker &rarr;
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
