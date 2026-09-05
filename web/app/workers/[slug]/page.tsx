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

  return (
    <div className="mx-auto max-w-[1080px] px-5 py-10">
      <Link href="/jobs?tab=workers" className="text-[13px] text-tealb underline-offset-2 hover:underline">&larr; The worker network</Link>

      <div className="mt-4 flex flex-wrap items-start gap-4 rounded-2xl border border-line bg-panel p-5">
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
            width={64} height={64} loading="lazy"
            className="size-16 flex-none rounded-2xl object-cover" />
        ) : (
          <span className="grid size-16 flex-none place-items-center rounded-2xl bg-linear-to-br from-tealb to-teal font-display text-[26px] text-onbrand">
            {(wp.name ?? "W").split(" ").map((x: string) => x[0]).join("").slice(0, 2)}
          </span>
        )}
        <span className="min-w-[220px] flex-1">
          <h1 className="font-display text-[clamp(24px,4vw,32px)] uppercase leading-none">{wp.name}</h1>
          <p className="mt-1.5 text-[13.5px] text-mute">
            {wp.trade ?? "General trades"}
            {wp.areas ? " · " + wp.areas : wp.parish ? " · " + wp.parish : ""}
            {wp.years ? ` · Trading ${wp.years} years` : ""}
          </p>
          {/* Status, independent of whether a score exists yet. Previously
              this only appeared while score was null, so a probation worker
              who had already completed one standard job and earned a score
              lost the one label saying they still cannot take a large or
              in-home job. It is who they are, not a stand-in for the score. */}
          <p className="mt-2 flex flex-wrap gap-1.5">
            <span className="rounded-full border border-softline bg-soft px-2.5 py-1 text-[10.5px] font-bold text-tealb">ID verified</span>
            <span className="rounded-full border border-softline bg-soft px-2.5 py-1 text-[10.5px] font-bold text-tealb">
              {wp.lane === "cert" ? "Certified professional" : "Evidence vetted"}
            </span>
            {wp.vetting_state === "probation" && (
              <span className="rounded-full border border-mango/40 bg-mango/10 px-2.5 py-1 text-[10.5px] font-bold text-mango">Vetting in progress · not yet cleared for large or in-home jobs</span>
            )}
          </p>
        </span>
        <span className="text-right">
          {score?.score != null ? (
            <>
              <span className="font-display text-[34px] leading-none text-mango">{Number(score.score).toFixed(1)}<small className="font-body text-[11px] text-dim">/5</small></span>
              <p className="mt-1 text-[11.5px] text-dim">Yaad Score · {wp.jobs_completed ?? 0} jobs completed</p>
            </>
          ) : (
            <>
              <span className="rounded-full border border-softline bg-soft px-3 py-1.5 text-[11.5px] font-bold text-tealb">Building a record</span>
              <p className="mt-1.5 text-[11.5px] text-dim">The Yaad Score starts at the first signed-off job</p>
            </>
          )}
        </span>
      </div>

      {/* Contact stays through one channel, on purpose: a job posted through
          Yaadly, never a phone number or an email on this page. That is also
          the only way a quote, evidence and payment end up tied to a real
          job record instead of a WhatsApp thread nobody else can see. */}
      {!isSelf && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-panel p-4">
          <p className="min-w-[220px] flex-1 text-[13px] leading-relaxed text-mute">
            Contact runs through a job posting, not a phone number, so there is always a record.
          </p>
          <Link
            href={`/jobs/new?${[wp.slug && `worker=${encodeURIComponent(wp.slug)}`, wp.trade && `trade=${encodeURIComponent(wp.trade)}`].filter(Boolean).join("&")}`}
            className="rounded-full bg-tealb px-5 py-2.5 text-[13px] font-bold text-onbrand transition hover:brightness-105"
          >
            Book {firstName} for a job
          </Link>
          <Link href="/ask" className="text-[12.5px] font-semibold text-tealb underline-offset-2 hover:underline">
            Not sure yet? Ask a Yaad
          </Link>
        </div>
      )}

      <p className="mt-4 text-[12px] leading-relaxed text-dim">
        Trade, years and the words below are {firstName}&apos;s own account of themself.
        What Yaadly independently checked is listed separately, underneath.
      </p>

      <section className="mt-3 rounded-2xl border border-line bg-panel p-5">
        <h2 className="mb-3 text-[10.5px] font-bold uppercase tracking-[.2em] text-tealb">What was checked, and how</h2>
        {(checks ?? []).length === 0 ? (
          <p className="text-[13px] text-dim">The verification record is being written up.</p>
        ) : (
          <ul className="grid gap-2">
            {(checks ?? []).map((c) => (
              <li key={c.label} className="flex gap-2.5 text-[13.5px]">
                <span className={c.passed ? "text-tealb" : "text-dim"}>{c.passed ? "✓" : "○"}</span>
                <span>
                  <b>{c.label}</b>
                  {c.note && <span className="block text-[12px] text-dim">{c.note}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {wp.about && (
        <section className="mt-4 rounded-2xl border border-line bg-panel p-5">
          <h2 className="mb-2 text-[10.5px] font-bold uppercase tracking-[.2em] text-tealb">In their own words</h2>
          <p className="text-[14.5px] leading-relaxed text-mute">{wp.about}</p>
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
        <section className="mt-4 rounded-2xl border border-line bg-panel p-5">
          <h2 className="mb-1 text-[10.5px] font-bold uppercase tracking-[.2em] text-tealb">{firstName}, in thirty seconds</h2>
          <p className="mb-3 text-[12px] text-dim">
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
        <section className="mt-4 rounded-2xl border border-line bg-panel p-5">
          <h2 className="mb-1 text-[10.5px] font-bold uppercase tracking-[.2em] text-tealb">Work {firstName} showed us</h2>
          {/* The honest caveat, in the client's interest and in the worker's.
              A person at Yaadly looked at these before they went up, which is
              a real check and is worth saying. It is NOT the evidence chain,
              and saying so here is what lets the section underneath keep its
              stronger claim. */}
          <p className="mb-3 text-[12px] text-dim">
            {firstName}&apos;s own photographs of finished work, handed in with
            their application. A person at Yaadly looked at them before they
            went up. They are not from jobs booked through Yaadly, so they do
            not carry the evidence trail the completed jobs below do.
          </p>
          <div className="grid gap-2.5 sm:grid-cols-3">
            {works.map((w) => (
              w.mime === "application/pdf" ? (
                <a key={w.storage_path} href={showcaseUrl(w.storage_path)} target="_blank" rel="noreferrer"
                  className="flex items-center justify-center rounded-xl border border-line bg-panel2 p-6 text-[13px] font-semibold text-tealb hover:border-teal">
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

      <section className="mt-4 rounded-2xl border border-line bg-panel p-5">
        <h2 className="mb-1 text-[10.5px] font-bold uppercase tracking-[.2em] text-tealb">Portfolio, every one a completed Yaadly job</h2>
        <p className="mb-3 text-[12px] text-dim">Not a gallery they uploaded. Pulled from the evidence record, so nothing here can be borrowed from somebody else&apos;s work.</p>
        {(port ?? []).length === 0 ? (
          <p className="text-[13.5px] text-mute">No completed jobs on Yaadly yet, so there is nothing to show here. This fills in as work does, straight from the evidence on each job.</p>
        ) : (
          <div className="grid gap-2.5 sm:grid-cols-2">
            {(port ?? []).map((p) => (
              <div key={p.title} className="rounded-xl border border-line bg-panel2 p-3.5">
                <b className="text-[14px]">{p.title}</b>
                <p className="mt-1 text-[11.5px] text-dim">
                  {[p.month, p.stages ? `${p.stages} stage${p.stages === 1 ? "" : "s"}` : null, p.evidence_items ? `${p.evidence_items} evidence items` : null].filter(Boolean).join(" · ")}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="mt-4 rounded-2xl border border-line bg-panel p-5">
        <h2 className="mb-1 text-[10.5px] font-bold uppercase tracking-[.2em] text-tealb">What clients said</h2>
        <p className="mb-3 text-[12px] text-dim">
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
              <li key={r.id} className="border-t border-line pt-3.5 first:border-t-0 first:pt-0">
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="text-[14px] tracking-wide text-mango" aria-label={r.stars + " out of 5"}>
                    {"★".repeat(r.stars)}<span className="text-line2">{"★".repeat(5 - r.stars)}</span>
                  </span>
                  <b className="text-[13.5px]">{r.author_first_name ?? "A client"}</b>
                  <span className="rounded-full border border-softline bg-soft px-2 py-0.5 text-[10px] font-bold text-tealb">Verified job</span>
                </div>
                {Array.isArray(r.criteria) && r.criteria.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {r.criteria.map((c) => (
                      <span key={c} className="rounded-full border border-line bg-panel2 px-2 py-0.5 text-[10.5px] text-mute">✓ {c}</span>
                    ))}
                  </div>
                )}
                {r.body && <p className="mt-1.5 text-[13.5px] leading-relaxed text-mute">{r.body}</p>}
                {r.reply ? (
                  <p className="mt-2 border-l-2 border-softline pl-3 text-[12.5px] text-mute">
                    <b className="text-tealb">{firstName} replied:</b> {r.reply}
                  </p>
                ) : (
                  isSelf && (
                    <form action={replyToReview} className="mt-2 flex flex-wrap gap-2">
                      <input type="hidden" name="id" value={r.id} />
                      <input type="hidden" name="slug" value={slug} />
                      <input name="reply" required maxLength={500} placeholder="One public reply. It cannot be edited after."
                        className="min-w-[240px] flex-1 rounded-xl border border-line bg-bg px-3 py-2 text-[13px] text-ink outline-none focus:border-teal" />
                      <button className="rounded-full border border-line2 px-3.5 py-2 text-[12.5px] font-bold text-ink hover:border-teal hover:text-tealb">Reply</button>
                    </form>
                  )
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
