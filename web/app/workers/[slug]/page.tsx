import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUser } from "@/lib/supabase/auth";
import { replyToReview } from "@/app/workers/actions";

export const dynamic = "force-dynamic";

/**
 * The public worker profile, MARKETPLACE-BUILD-SPEC section 4. Reached from
 * a worker card; discovery stays by trade and parish, deliberately. The URL
 * carries a slug, never an email. Scores come from the derived views, and a
 * new profile shows the first-timer state, never 0.0.
 *
 * Reads public_worker_profiles / public_worker_checks / public_portfolio
 * (20260903f in supabase/migrations), never the base tables: those three
 * carry worker_email as a plain column, and worker_profiles carries phone
 * too, neither of which a visitor to this page has any business reading.
 * The views join on slug instead, so this file never needs to know a
 * worker's email to render their page.
 *
 * Restyled 6 September 2026 to the "Job Board" Claude Design comp, in the same
 * pass as /jobs, so a client who clicks through from a card does not land on
 * the previous design. The comp's shape is here: a 132px portrait, a light
 * display name, the verification chips, the checks as a card grid, and a
 * sticky rail carrying the booking call to action. What is NOT here is the
 * comp's flattening.
 *
 * The comp is one screen with a blurb in the hero. This page is deliberately
 * three kinds of true in three labelled places, and that separation is the
 * whole design: what the worker says about themselves, what they handed in,
 * and what came out of the evidence on completed jobs. Restyling must never
 * merge those, so `about` stays in its own labelled section rather than moving
 * into the hero where the comp puts it.
 *
 * TWO SENTENCES IN THE COMP'S RAIL WERE NOT BUILT. "Money is held by Yaadly
 * until you approve the photos" is banned outright by CLAUDE.md section 8 and
 * docs/COPY-GUIDELINES.md section 3. "Each stage releases only when you sign
 * it off" makes the client's click the trigger that moves a subcontractor's
 * pay, which under the principal structure they have no power to do. The rail
 * says the true version of both. The comp also wrote "he" and "him" about an
 * arbitrary tradesperson; this page says they, as it already did.
 *
 * The comp's second rail button, "Invite them to quote an open job", and its
 * "Report it" link are not built as described either: neither flow exists, and
 * a button that goes nowhere is worse than no button. Report points at /ask,
 * which is real and answered by a person.
 */

/* What the worker themselves showed us, published on a granted consent by a
   named human at the desk (20260905b in supabase/migrations). Deliberately a
   separate list from `port` below: that one is built from the evidence on
   completed Yaadly jobs and its whole claim is that it cannot be borrowed
   from somebody else's work. This one is the worker's own account of
   themselves. Two different kinds of true, and they are rendered in two
   sections that say which is which, on purpose. */
type Showcase = {
  kind: "profile_photo" | "intro_video" | "work_file";
  storage_path: string; mime: string | null; caption: string | null; position: number;
};

/* The showcase bucket is public, so its files have a plain durable URL and
   need no signing. That is the difference between these and job photographs,
   which are signed for five minutes because nobody outside the job should
   ever see one. Everything in this bucket is there because somebody agreed it
   could be seen by anyone. */
const showcaseUrl = (path: string) =>
  `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/showcase/${path
    .split("/").map(encodeURIComponent).join("/")}`;

type Review = {
  id: string; stars: number; criteria: string[] | null; body: string | null;
  reply: string | null; created_at: string; author_first_name: string | null;
};

/* A public page that gets shared, so the tab and the link preview should say
   whose profile it is. This is the one title worth a query of its own: every
   other page can build its title from the URL, and a worker's name cannot be
   read out of a slug without guessing at capitalisation and spelling.

   Falls back to the generic title rather than throwing, because a missing
   profile is notFound()'s job. Note that BOTH the notFound() below and a
   notFound() here are too late to set the status code: see layout.tsx in this
   folder, which is the one place on this route that runs before the shell is
   flushed. This function is left as it was on purpose. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from("public_worker_profiles")
    .select("name,trade")
    .eq("slug", slug)
    .maybeSingle();
  if (!data?.name) return { title: "Worker profile · Yaadly" };
  return {
    title: data.trade
      ? `${data.name}, ${data.trade} · Yaadly`
      : `${data.name} · Yaadly`,
  };
}

export default async function WorkerProfile({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = await createClient();
  const user = await getUser();

  const { data: wp } = await supabase
    .from("public_worker_profiles")
    .select("name,trade,parish,lane,jobs_completed,about,years,areas,slug,vetting_state")
    .eq("slug", slug)
    .maybeSingle();
  if (!wp) notFound();

  const [{ data: score }, { data: checks }, { data: port }, { data: revs }, { data: own }, { data: show }] =
    await Promise.all([
      supabase.from("worker_scores").select("score,reviews").eq("subject_slug", slug).maybeSingle(),
      supabase.from("public_worker_checks").select("label,passed,note,position").eq("subject_slug", slug).order("position"),
      supabase.from("public_portfolio").select("title,month,stages,evidence_items").eq("subject_slug", slug).order("position"),
      supabase.from("published_reviews").select("id,stars,criteria,body,reply,created_at,author_first_name").eq("subject_slug", slug).eq("direction", "client_of_worker").order("created_at", { ascending: false }),
      // "Is the signed-in visitor this worker?" without ever asking this page
      // to know the worker's email: matched against the visitor's OWN row,
      // which RLS lets an authenticated user read regardless of this page.
      user?.email
        ? supabase.from("worker_profiles").select("slug").eq("worker_email", user.email.toLowerCase()).maybeSingle()
        : Promise.resolve({ data: null as { slug: string } | null }),
      // public_worker_showcase, never worker_showcase: the view carries no
      // email and, more to the point, it re-tests showcase_consent on every
      // read. Withdraw the consent and this list is empty on the next page
      // load, whether or not anybody has got round to deleting the files.
      supabase.from("public_worker_showcase")
        .select("kind,storage_path,mime,caption,position")
        .eq("subject_slug", slug).order("position"),
    ]);

  const reviews = (revs ?? []) as Review[];
  const showcase = (show ?? []) as Showcase[];
  const face = showcase.find((x) => x.kind === "profile_photo");
  const intro = showcase.find((x) => x.kind === "intro_video");
  const works = showcase.filter((x) => x.kind === "work_file");
  const isSelf = own?.slug === slug;
  const firstName = wp.name?.split(" ")[0] ?? "This worker";

  /* The chip is derived, never assumed. "TRN matched to the ID" is one of the
     strongest sentences on this page and it is true of the checks that were
     actually recorded against THIS worker, so it comes off public_worker_checks
     rather than off a site-wide claim. A profile whose verification record is
     still being written up simply does not show it. */
  const trnChecked = (checks ?? []).some(
    (c) => c.passed && /\btrn\b|tax (number|registration)/i.test(c.label ?? "")
  );
  const book = `/jobs/new?${[wp.slug && `worker=${encodeURIComponent(wp.slug)}`, wp.trade && `trade=${encodeURIComponent(wp.trade)}`].filter(Boolean).join("&")}`;

  /* Whether this profile carries anything the worker supplied in their own
     words, which decides how the disclaimer in the hero is written. It used to
     say "the words below" unconditionally, and on a sparse profile, which most
     of them are today, it pointed at nothing at all and read as a page with a
     section missing. The disclaimer itself still runs either way, because the
     trade and the years directly above it are self-reported too and that is
     exactly what it is there to say. */
  const saidThemselves = !!(wp.about || intro || works.length);

  const card = "rounded-[20px] border border-line bg-linear-to-b from-[rgba(19,19,50,0.8)] to-[rgba(12,12,38,0.6)] p-5.5";
  const label = "font-mono-app text-[10px] font-semibold uppercase tracking-[0.18em] text-dim";

  return (
    <div className="mx-auto max-w-[1240px] px-7 pb-16 pt-5.5 max-[820px]:px-5">
      <Link href="/jobs?tab=workers" className="inline-flex items-center gap-2 text-[13px] font-semibold text-mute transition hover:text-ink">
        &larr; The worker network
      </Link>

      <main className="mt-4 flex flex-wrap items-start gap-7">
        <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-4">

          {/* ── WHO ─────────────────────────────────────────────── */}
          <section className="flex flex-wrap items-start gap-5.5 rounded-[20px] border border-line bg-linear-to-b from-[rgba(19,19,50,0.9)] to-[rgba(12,12,38,0.75)] p-6">
            {/* The initials block stays as the fallback rather than being replaced.
                Most profiles will not have a photograph: the consent is opt in and
                a worker who says no is not a worse worker, so the page has to look
                finished either way.

                eslint-disable and a plain img: next/image wants a configured remote
                host, and this URL is built from an environment variable, so the
                optimiser cannot be told about it at build time. loading="lazy" and
                explicit dimensions are the two things the optimiser would have
                given us that actually matter here. */}
            {face ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={showcaseUrl(face.storage_path)} alt={`${wp.name}, ${wp.trade ?? "tradesperson"}`}
                width={132} height={132} loading="lazy"
                className="size-[132px] shrink-0 rounded-2xl border border-line2 object-cover" />
            ) : (
              <span className="grid size-[132px] shrink-0 place-items-center rounded-2xl border border-line2 bg-[radial-gradient(ellipse_at_30%_20%,rgba(155,115,245,0.32)_0%,transparent_60%),linear-gradient(150deg,rgba(123,79,224,0.38),rgba(245,158,11,0.16))] font-display text-[40px] font-light text-white/92">
                {(wp.name ?? "W").split(" ").map((x: string) => x[0]).join("").slice(0, 2)}
              </span>
            )}

            <div className="min-w-0 flex-[1_1_260px]">
              <h1 className="font-display text-[clamp(28px,3.6vw,38px)] font-light leading-[1.1] tracking-[-0.02em]">{wp.name}</h1>
              <p className="mt-1.5 text-[15px] text-mute">
                {wp.trade ?? "General trades"}
                {wp.areas ? " · " + wp.areas : wp.parish ? " · " + wp.parish : ""}
                {wp.years ? ` · Trading ${wp.years} years` : ""}
              </p>

              {/* Status, independent of whether a score exists yet. Previously
                  this only appeared while score was null, so a probation worker
                  who had already completed one standard job and earned a score
                  lost the one label saying they still cannot take a large or
                  in-home job. It is who they are, not a stand-in for the score. */}
              <div className="mt-3.5 flex flex-wrap gap-1.5">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-green/35 bg-green/[0.08] px-3 py-1.5 text-[11.5px] font-semibold text-green">
                  <svg viewBox="0 0 24 24" className="size-3 fill-none stroke-green stroke-[2.5]" strokeLinecap="round" strokeLinejoin="round"><path d="m5 13 4 4L19 7" /></svg>
                  Identity verified
                </span>
                <span className="inline-flex items-center rounded-full border border-gold/35 bg-gold/[0.08] px-3 py-1.5 text-[11.5px] font-semibold text-goldb">
                  {wp.lane === "cert" ? "Certified professional" : "Evidence vetted"}
                </span>
                {trnChecked && (
                  <span className="inline-flex items-center rounded-full border border-purple/30 bg-purple/10 px-3 py-1.5 text-[11.5px] font-semibold text-purpleb">
                    TRN matched
                  </span>
                )}
                {wp.vetting_state === "probation" && (
                  <span className="inline-flex items-center rounded-full border border-mango/40 bg-mango/10 px-3 py-1.5 text-[11.5px] font-semibold text-mango">
                    Vetting in progress · not yet cleared for large or in-home jobs
                  </span>
                )}
              </div>

              {/* The comp puts the worker's blurb here. It stays out, and the
                  paragraph below says why: this hero carries what Yaadly
                  checked, and what the worker says about themselves is a
                  different kind of true that gets its own labelled section. */}
              <p className="mt-3.5 max-w-[62ch] text-[12.5px] leading-relaxed text-dim">
                {saidThemselves
                  ? <>Trade, years and the words further down are {firstName}&apos;s own account of themself.</>
                  : <>The trade and the years above are {firstName}&apos;s own account of themself.</>}
                {" "}What Yaadly independently checked is listed separately, underneath.
              </p>
            </div>
          </section>

          {/* ── WHAT WAS CHECKED ────────────────────────────────── */}
          <section className={card}>
            <span className={label}>What was checked, and how</span>
            {(checks ?? []).length === 0 ? (
              <p className="mt-3 text-[13px] text-dim">The verification record is being written up.</p>
            ) : (
              /* The comp's card grid, with the comp's third line dropped: it
                 showed a "checked at signup" date and public_worker_checks
                 carries no date, so the row would have been decoration
                 asserting something nobody had looked up. */
              <div className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(min(100%,220px),1fr))] gap-3.5">
                {(checks ?? []).map((c) => (
                  <div key={c.label} className="rounded-[14px] border border-line bg-bg/45 px-4 py-3.5">
                    <span className="flex items-center gap-2 text-[14px] font-semibold">
                      <i className={"size-1.5 shrink-0 rounded-full " + (c.passed ? "bg-green" : "bg-dim")} />
                      {c.label}
                    </span>
                    {c.note && <p className="mt-1.5 text-[12.5px] leading-snug text-mute">{c.note}</p>}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* ── TRADES AND COVERAGE ─────────────────────────────── */}
          {(wp.trade || wp.areas || wp.parish) && (
            <section className={card}>
              <span className={label}>Trades and coverage</span>
              <div className="mt-3.5 flex flex-wrap gap-1.5">
                {[wp.trade, wp.lane === "cert" ? "Certified" : null].filter(Boolean).map((t) => (
                  <span key={t as string} className="rounded-full border border-purple/28 bg-purple/[0.09] px-3.5 py-1.5 font-mono-app text-[11.5px] font-medium tracking-[0.03em] text-purpleb">
                    {t}
                  </span>
                ))}
              </div>
              {/* The comp had "usually replies" and "materials" here. Neither
                  exists on worker_profiles, and a profile page is the last
                  place to print a response time nobody measured. */}
              <div className="mt-4.5 flex flex-wrap gap-x-6 gap-y-2 border-t border-line pt-4 text-[13.5px] text-dim">
                {(wp.areas || wp.parish) && (
                  <span>Covers <b className="font-semibold text-ink">{wp.areas ?? wp.parish}</b></span>
                )}
                {wp.years ? <span>In the trade <b className="font-semibold text-ink">{wp.years} years</b></span> : null}
              </div>
            </section>
          )}

          {/* ── THEIR OWN WORDS ─────────────────────────────────── */}
          {wp.about && (
            <section className={card}>
              <span className={label}>In their own words</span>
              <p className="mt-3 text-[14.5px] leading-relaxed text-mute">{wp.about}</p>
            </section>
          )}

          {/* THE WORKER'S OWN ACCOUNT OF THEMSELVES, and it sits ABOVE the
              evidence portfolio and says plainly what it is. That labelling is the
              whole design. The section below it earns its trust by being pulled
              from the evidence record; borrowing that sentence for material a
              worker handed in would spend the credibility of the checked thing on
              the unchecked one. So: their words, their face, their video, their
              photographs, marked as theirs. What Yaadly verified is the "What was
              checked" block further up, and it is separate for the same reason. */}
          {intro && (
            <section className={card}>
              <span className={label}>{firstName}, in thirty seconds</span>
              <p className="mb-3.5 mt-1.5 text-[12.5px] text-dim">
                Recorded by {firstName} when they applied. Their own words, not a
                script from us.
              </p>
              <video
                src={showcaseUrl(intro.storage_path)}
                controls preload="none"
                className="w-full max-w-[520px] rounded-xl border border-line bg-black"
              >
                Your browser cannot play this video.
              </video>
            </section>
          )}

          {works.length > 0 && (
            <section className={card}>
              <span className={label}>Work {firstName} showed us</span>
              {/* The honest caveat, in the client's interest and in the worker's.
                  A person at Yaadly looked at these before they went up, which is
                  a real check and is worth saying. It is NOT the evidence chain,
                  and saying so here is what lets the section underneath keep its
                  stronger claim. */}
              <p className="mb-3.5 mt-1.5 max-w-[70ch] text-[12.5px] leading-relaxed text-dim">
                {firstName}&apos;s own photographs of finished work, handed in with
                their application. A person at Yaadly looked at them before they
                went up. They are not from jobs booked through Yaadly, so they do
                not carry the evidence trail the completed jobs below do.
              </p>
              <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,180px),1fr))] gap-2.5">
                {works.map((w) => (
                  w.mime === "application/pdf" ? (
                    <a key={w.storage_path} href={showcaseUrl(w.storage_path)} target="_blank" rel="noreferrer"
                      className="flex items-center justify-center rounded-xl border border-line bg-panel2 p-6 text-[13px] font-semibold text-purpleb transition hover:border-purple">
                      {w.caption ?? "Portfolio, PDF"}
                    </a>
                  ) : (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img key={w.storage_path} src={showcaseUrl(w.storage_path)}
                      alt={w.caption ?? `Work by ${wp.name}`} loading="lazy"
                      className="aspect-4/3 w-full rounded-xl border border-line object-cover" />
                  )
                ))}
              </div>
            </section>
          )}

          {/* ── RECORD ON YAADLY ────────────────────────────────── */}
          <section className="rounded-[20px] border border-dashed border-line2 bg-purple/[0.04] p-5.5">
            <span className={label}>Record on Yaadly</span>
            <p className="mt-1 font-display text-[22px] font-light leading-[1.25] tracking-[-0.015em]">
              {(wp.jobs_completed ?? 0) > 0
                ? `${wp.jobs_completed} completed job${wp.jobs_completed === 1 ? "" : "s"}`
                : "No completed jobs yet"}
            </p>
            <p className="mt-2 max-w-[62ch] text-pretty text-[13.5px] leading-relaxed text-mute">
              This is where the evidence lives: the stages, the items captured on each one, and what the client said
              afterwards. It is built from jobs a person signed off, so it cannot be written by hand.
            </p>

            {/* Three real numbers. The comp's third was "stages approved first
                time", which nothing computes; reviews is a count this page
                already had. An em dash in a slot is what a blank looks like to
                a visitor, so the empty states say a word instead. */}
            <div className="mt-4.5 flex flex-wrap gap-3">
              {[
                [String(wp.jobs_completed ?? 0), "jobs completed"],
                [score?.score != null ? Number(score.score).toFixed(1) : "New", score?.score != null ? "Yaad Score out of 5" : "no score yet"],
                [String(reviews.length), reviews.length === 1 ? "client review" : "client reviews"],
              ].map(([value, cap]) => (
                <div key={cap} className="min-w-[130px] flex-1 rounded-[14px] border border-line bg-bg/45 px-4 py-3.5">
                  <b className="block font-mono-app text-[22px] font-semibold tabular-nums text-ink">{value}</b>
                  <span className="text-[11.5px] text-dim">{cap}</span>
                </div>
              ))}
            </div>

            <div className="mt-5 border-t border-line pt-4.5">
              <span className={label}>Portfolio, every one a completed Yaadly job</span>
              <p className="mb-3.5 mt-1.5 text-[12.5px] text-dim">
                Not a gallery they uploaded. Pulled from the evidence record, so nothing here can be borrowed from
                somebody else&apos;s work.
              </p>
              {(port ?? []).length === 0 ? (
                <p className="text-[13.5px] text-mute">
                  Nothing to show here yet. This fills in as work does, straight from the evidence on each job.
                </p>
              ) : (
                <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,240px),1fr))] gap-2.5">
                  {(port ?? []).map((p) => (
                    <div key={p.title} className="rounded-xl border border-line bg-bg/45 p-3.5">
                      <b className="text-[14px]">{p.title}</b>
                      <p className="mt-1 text-[11.5px] text-dim">
                        {[p.month, p.stages ? `${p.stages} stage${p.stages === 1 ? "" : "s"}` : null, p.evidence_items ? `${p.evidence_items} evidence items` : null].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* ── REVIEWS ─────────────────────────────────────────── */}
          <section className={card}>
            <span className={label}>What clients said</span>
            <p className="mb-4 mt-1.5 max-w-[70ch] text-[12.5px] leading-relaxed text-dim">
              Reviews written by clients this worker actually worked for. One per
              completed job, tied to the evidence they signed off, sealed until
              both sides have written or fourteen days pass. The record runs both
              ways: this worker reviews their clients under the same rule.
            </p>
            {reviews.length === 0 ? (
              <p className="text-[13.5px] text-mute">No reviews yet. The first one arrives with the first signed-off job.</p>
            ) : (
              <ul className="grid gap-4">
                {reviews.map((r) => (
                  <li key={r.id} className="border-t border-line pt-4 first:border-t-0 first:pt-0">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <span className="text-[14px] tracking-wide text-goldb" aria-label={r.stars + " out of 5"}>
                        {"★".repeat(r.stars)}<span className="text-line2">{"★".repeat(5 - r.stars)}</span>
                      </span>
                      <b className="text-[13.5px]">{r.author_first_name ?? "A client"}</b>
                      <span className="rounded-full border border-purple/30 bg-purple/[0.09] px-2.5 py-0.5 text-[10px] font-bold text-purpleb">Verified job</span>
                    </div>
                    {Array.isArray(r.criteria) && r.criteria.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {r.criteria.map((c) => (
                          <span key={c} className="rounded-full border border-line bg-panel2 px-2.5 py-0.5 text-[10.5px] text-mute">✓ {c}</span>
                        ))}
                      </div>
                    )}
                    {r.body && <p className="mt-2 text-[13.5px] leading-relaxed text-mute">{r.body}</p>}
                    {r.reply ? (
                      <p className="mt-2.5 border-l-2 border-line2 pl-3 text-[12.5px] text-mute">
                        <b className="text-purpleb">{firstName} replied:</b> {r.reply}
                      </p>
                    ) : (
                      isSelf && (
                        <form action={replyToReview} className="mt-2.5 flex flex-wrap gap-2">
                          <input type="hidden" name="id" value={r.id} />
                          <input type="hidden" name="slug" value={slug} />
                          <input name="reply" required maxLength={500} placeholder="One public reply. It cannot be edited after."
                            className="min-w-[240px] flex-1 rounded-xl border border-line bg-bg px-3.5 py-2 text-[13px] text-ink outline-none focus:border-purple" />
                          <button className="rounded-full border border-line2 px-4 py-2 text-[12.5px] font-bold text-ink transition hover:border-purple hover:text-purpleb">Reply</button>
                        </form>
                      )
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* ── RAIL ───────────────────────────────────────────────── */}
        <aside className="flex min-w-0 max-w-[316px] flex-[1_1_280px] flex-col gap-4 min-[821px]:sticky min-[821px]:top-[74px]">
          {/* Contact stays through one channel, on purpose: a job posted through
              Yaadly, never a phone number or an email on this page. That is also
              the only way a quote, evidence and payment end up tied to a real
              job record instead of a WhatsApp thread nobody else can see. */}
          {!isSelf && (
            <div className="rounded-[18px] border border-gold/30 bg-linear-to-b from-gold/10 to-[rgba(12,12,38,0.6)] p-5">
              <span className="font-mono-app text-[10px] font-semibold uppercase tracking-[0.18em] text-goldb">
                Work with {firstName}
              </span>
              {/* The comp: "No budget band is shown to him, and money is held by
                  Yaadly until you approve the photos." Banned, and it wrote
                  "him" about a person nobody has met. This is the true version. */}
              <p className="mt-2 text-[13.5px] leading-relaxed text-mute">
                Describe the job and {firstName} quotes your scope. No budget band is ever shown to them, and you see
                the evidence before you are asked to accept the work.
              </p>
              <Link href={book} className="mt-4 flex w-full items-center justify-center rounded-full bg-linear-to-br from-goldb to-gold px-4.5 py-3 text-[14px] font-bold text-[#1A0F00] transition hover:brightness-105">
                Book {firstName} for a job
              </Link>
              <Link href="/ask" className="mt-2.5 flex w-full items-center justify-center rounded-full border-[1.5px] border-purple/30 px-4.5 py-2.5 text-[13.5px] font-semibold text-purpleb transition hover:border-purple hover:text-ink">
                Not sure yet? Ask Yaadly
              </Link>
              <p className="mt-3.5 border-t border-gold/20 pt-3 font-mono-app text-[10.5px] font-medium tracking-[0.05em] text-dim">
                FREE TO ASK · NO OBLIGATION TO ACCEPT
              </p>
            </div>
          )}

          <div className="rounded-[18px] border border-line bg-linear-to-b from-[rgba(19,19,50,0.8)] to-[rgba(12,12,38,0.6)] p-5">
            <span className="font-mono-app text-[10px] font-semibold uppercase tracking-[0.18em] text-dim">How the money works</span>
            {/* 03 is not the comp's. The comp said "Nothing pays out unapproved,
                each stage releases only when you sign it off", which hands the
                client a lever over a subcontractor's pay that they do not have
                and should not be told they have. COPY-GUIDELINES section 3. */}
            <div className="mt-3.5 flex flex-col gap-3.5">
              {[
                ["You buy the job from Yaadly", "One agreed price. Never a cash handover on site."],
                ["Photos at every stage", "You see the work as it happens, from anywhere."],
                ["A named person signs it off", "Someone at Yaadly checks the work and the evidence before Yaadly pays the tradesperson. Never an automatic timer."],
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
            <p className="mt-4 border-t border-line pt-3.5 text-[12.5px] text-dim">
              A human confirms every step that moves money or changes a reputation.
            </p>
          </div>

          <div className="rounded-[18px] border border-line bg-purple/[0.05] px-5 py-4">
            <p className="text-[13.5px] leading-relaxed text-mute">
              Something not right on this profile?{" "}
              <Link href="/ask" className="font-semibold text-purpleb underline underline-offset-2">Tell us</Link>
              {" "}and a person will look at it.
            </p>
          </div>
        </aside>
      </main>
    </div>
  );
}
