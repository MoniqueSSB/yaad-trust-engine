import Link from "next/link";

/**
 * The worker network, one component, two entry points.
 *
 * It was declared inside app/jobs/page.tsx and rendered only on the board's
 * second tab. /workers, meanwhile, was a 404: only /workers/[slug] existed, so
 * a worker's profile could be reached from a card and by no other route, and a
 * tradesperson had no link they could send anybody. The founder asked for a
 * directory on 3 Sep 2026.
 *
 * Extracted rather than copied. A second implementation of the card would have
 * been free to drift from the first, and the two surfaces have to agree about
 * what "verified" looks like above everything else on the page.
 *
 * SELECT_WORKER is exported with it, because the columns are part of the
 * contract: the card reads `about`, `years` and `jobs_completed`, and a caller
 * that forgets one gets an undefined rather than an error. There is
 * deliberately no email in that list and no email in the type. Discovery is by
 * trade and parish, the URL carries a slug, and a worker's address is not
 * something a public page needs in order to draw a card.
 */

export type Worker = {
  name: string | null; trade: string | null; parish: string | null; lane: string | null;
  jobs_completed: number | null; slug: string | null; about: string | null; years: number | null;
};

/** The exact columns the card reads. Kept beside it so they cannot drift. */
export const SELECT_WORKER = "name,trade,parish,lane,jobs_completed,slug,about,years";

export function WorkerDirectory({ workers }: { workers: Worker[] }) {
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
