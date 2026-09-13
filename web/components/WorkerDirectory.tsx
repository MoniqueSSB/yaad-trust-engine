import Link from "next/link";

/**
 * The worker network, one component, two entry points.
 *
 * It was declared inside app/jobs/page.tsx and rendered only on the board's
 * second tab. /workers was a 404, so a profile could be reached from a card
 * and by no other route, and a tradesperson had no link to send anybody. The
 * founder asked for a directory on 3 Sep 2026 and this is the card it renders.
 *
 * Extracted rather than copied. A second implementation would have been free
 * to drift, and the two surfaces have to agree about what "verified" looks
 * like above everything else on the page.
 *
 * THE BODY BELOW IS THE VERSION FROM 8578312, not the one that existed when
 * this file was first split out. That commit landed in parallel and carried
 * three things worth keeping, which an extraction done from the older copy
 * would have silently reverted:
 *
 *   the probation badge, so a worker still being vetted no longer reads
 *   identically to a fully cleared one
 *
 *   "Profile page coming soon" instead of a blank cell, for the active
 *   profiles that predate the slug column
 *
 *   and the reason SELECT_WORKER reads a VIEW: worker_profiles.phone and
 *   .worker_email sit on the same row as name and trade, the public read
 *   policy is row level, and row level means every column. Anyone with the
 *   publishable key could read every active worker's phone number. The fix is
 *   public_worker_profiles, which cannot carry those columns at all.
 *
 * So: never point this at worker_profiles again, however convenient. The view
 * is the boundary.
 */

export type Worker = {
  name: string | null; trade: string | null; parish: string | null; lane: string | null;
  jobs_completed: number | null; slug: string | null; about: string | null; years: number | null;
  vetting_state: string | null;
};

/**
 * The columns the card reads, and the view it reads them from.
 *
 * Both halves matter. The column list is a contract: the card reads `about`,
 * `years`, `jobs_completed` and `vetting_state`, and a caller that forgets one
 * gets undefined rather than an error. The TABLE name is a security boundary:
 * public_worker_profiles exists precisely so a public page cannot select a
 * worker's phone or email, and it has no filter on `active` because the view
 * already applies one.
 */
export const WORKER_VIEW = "public_worker_profiles";
export const SELECT_WORKER =
  "name,trade,parish,lane,jobs_completed,slug,about,years,vetting_state";

export function WorkerDirectory({ workers }: { workers: Worker[] }) {
  if (workers.length === 0) {
    return (
      <p className="mt-5 rounded-2xl border border-line bg-panel p-5 text-[13.5px] leading-relaxed text-mute">
        The worker network is being built parish by parish, and nobody is
        listed before both checks are complete: an identity check run by an
        independent verification provider, and a Jamaican TRN checked against
        the name on that ID. Profiles appear here as workers pass.
      </p>
    );
  }
  return (
    <>
      <p className="mt-4 font-mono-app text-[11px] font-medium uppercase tracking-[0.06em] text-dim">
        Every profile: identity checked with an independent provider, TRN checked against the ID
      </p>
      {/* auto-fit rather than a fixed 2/3 column count, changed 6 Sep 2026
          with the job board redesign. This component renders in two very
          different widths: full page on /workers, and beside a 316px rail on
          the board's worker tab. A fixed lg:grid-cols-3 gave the board three
          175px cards, which is narrower than the two buttons at the bottom of
          one. Letting the track decide means the same card is comfortable in
          both places without either page knowing about the other. */}
      <div className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(min(100%,280px),1fr))] gap-3.5">
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
                {/* "New" rather than "0", 6 Sep 2026. A bold zero beside a name
                    reads as a score, and the thing it is actually saying is that
                    this person has not been booked through Yaadly yet, which is a
                    fact about the platform's age and not about the tradesperson.
                    They have all passed the same checks either way. */}
                <span className="text-right font-mono-app text-[11px] font-semibold text-goldb">
                  {(w.jobs_completed ?? 0) > 0 ? w.jobs_completed : "New"}
                  <small className="block font-mono-app text-[9px] font-medium uppercase tracking-[0.08em] text-dim">
                    {(w.jobs_completed ?? 0) > 0 ? "jobs" : "on Yaadly"}
                  </small>
                </span>
              </div>

              {(w.about || w.years) && (
                <p className="text-[12.5px] leading-relaxed text-mute">
                  {w.years ? <b className="font-semibold text-ink">{w.years} years in the trade. </b> : null}
                  {w.about ? w.about.slice(0, 150) + (w.about.length > 150 ? "…" : "") : null}
                </p>
              )}

              <div className="flex flex-wrap gap-1.5">
                {/* "ID verified" is literal, not marketing: the publish gate
                    (enforce_profile_publish_checks) refuses to make a profile
                    active unless Persona reads back approved or completed, so
                    every row this view can return has actually cleared it. */}
                <span className="rounded-full border border-line bg-panel2 px-2.5 py-1 text-[10.5px] font-semibold text-mute">ID verified</span>
                <span className={"rounded-full px-2.5 py-1 text-[10.5px] font-semibold " + (w.lane === "cert" ? "border border-gold/35 bg-gold/[0.08] text-goldb" : "border border-purple/30 bg-purple/[0.08] text-purpleb")}>
                  {w.lane === "cert" ? "Certified professional" : "Evidence vetted"}
                </span>
                {/* Probation is a real gate (20260831d): hidden from top-tier
                    jobs until the police check and references clear. A card
                    identical to a fully verified worker's said nothing of
                    that, so a probation worker and a verified one read the
                    same on this board. */}
                {w.vetting_state === "probation" && (
                  <span className="rounded-full border border-mango/40 bg-mango/10 px-2.5 py-1 text-[10.5px] font-semibold text-mango">Vetting in progress</span>
                )}
              </div>

              <div className="mt-auto grid grid-cols-2 gap-2">
                {w.slug ? (
                  <Link href={"/workers/" + encodeURIComponent(w.slug)} className="rounded-full border-[1.5px] border-purple/30 py-2.5 text-center text-[12.5px] font-semibold text-purpleb transition hover:border-purple hover:bg-panel2">
                    View profile
                  </Link>
                ) : (
                  // A profile with no slug yet cannot be linked to. That is a
                  // real, current state (some active profiles predate the
                  // slug column), not a bug in this card, so it says so
                  // rather than leaving a blank cell where a button should be.
                  <span className="grid place-items-center rounded-full border border-dashed border-line py-2.5 text-center text-[12px] font-semibold text-dim">Profile page coming soon</span>
                )}
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
