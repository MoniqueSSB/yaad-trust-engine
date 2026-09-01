"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";

/**
 * The same header the landing page wears, so app.yaadly.co.uk reads as a
 * tab of one Yaadly site rather than a separate place. Same tab order, same
 * labels, same one filled button, as docs/yaadly.css's nav.top. Fixed 1 Sep
 * 2026: this used to run its own order ("Website", "Services" pointing at a
 * marketing anchor that no longer exists) and its own filled active-tab pill
 * sitting next to the "Post a job" button, two solid CTAs fighting in one
 * header. Managed services, For business, Contact and Book a call only exist
 * on the marketing site, so those tabs link back across; Marketplace stays
 * pointed at the live board here, because that is where it actually lives
 * once you are in the app.
 *
 * The portal used to render its own cut-down header instead of this one:
 * logo, email, sign out, and no tabs at all. That is what made signing in
 * feel like leaving Yaadly and arriving somewhere else, with no way back
 * except the browser's back button. It now uses this header too, and passes
 * the signed-in email and the sign-out action in so nothing is lost.
 *
 * The client portal and the worker portal are two separate products, so they
 * are two links. An existing tradesperson signing in to find their job must
 * never be routed through "join as a pro": joining is a third, separate
 * channel and it is not what they are there for.
 */
const SITE = "https://yaadly.co.uk";

export function SiteNav({
  active,
  email,
  signOut,
}: {
  active?: "market" | "client" | "worker" | "join";
  email?: string | null;
  signOut?: () => Promise<void>;
}) {
  /* The layout renders this once for every /portal route, so it cannot know
     which tab to light. The URL can. An explicit `active` still wins, for the
     screens that are not under /portal. */
  const path = usePathname() ?? "";
  const here =
    active ??
    (path.startsWith("/portal/worker") ? "worker"
      : path.startsWith("/apply") ? "join"
      : path.startsWith("/jobs") ? "market"
      : path.startsWith("/portal") ? "client"
      : undefined);
  const tab = (on: boolean) =>
    "rounded-[9px] px-3 py-1.5 text-[13px] transition " +
    (on
      ? "font-bold text-tealb"
      : "font-medium text-ink hover:bg-panel2");
  const quiet = "text-[12.5px] text-ink hover:text-tealb transition";
  return (
    <nav className="sticky top-0 z-50 border-b border-line bg-bg/95 backdrop-blur">
      <div className="mx-auto flex max-w-[1080px] flex-wrap items-center gap-3 px-5 py-3">
        <a href={SITE} className="flex items-center gap-2.5">
          <span className="grid size-8 place-items-center rounded-[9px] bg-teal font-display text-[17px] text-[#04211D]">
            Y
          </span>
          <b className="text-[17px]">
            Yaadly<span className="text-mango">Hub</span>
          </b>
        </a>
        <div className="ml-auto flex flex-wrap items-center gap-1">
          <Link href="/jobs" className={tab(here === "market")}>Marketplace</Link>
          <a href={`${SITE}/services.html`} className={tab(false)}>Managed services</a>
          <a href={`${SITE}/business.html`} className={tab(false)}>For business</a>
          <a href={`${SITE}/contact.html`} className={tab(false)}>Contact</a>
          <a href="https://cal.com/yaadly/15min" target="_blank" rel="noopener" className={tab(false)}>Book a call</a>
        </div>
        <div className="flex flex-wrap items-center gap-3.5">
          <Link href="/portal/client" className={quiet + (here === "client" ? " font-bold text-tealb" : "")}>Client portal</Link>
          <Link href="/portal/worker" className={quiet + (here === "worker" ? " font-bold text-tealb" : "")}>Worker portal</Link>
          <Link href="/apply" className={quiet + (here === "join" ? " font-bold text-tealb" : "")}>Join as a pro</Link>
        </div>

        {email ? (
          <span className="text-[12.5px] text-dim">{email}</span>
        ) : null}

        {signOut ? (
          <form action={signOut}>
            <button
              type="submit"
              className="rounded-[9px] border border-line px-3 py-1.5 text-[13px] text-mute transition hover:border-teal hover:text-tealb"
            >
              Sign out
            </button>
          </form>
        ) : (
          /* The app, not the marketing site. The funnel that used to live at
             yaadly.co.uk/#post was deleted when docs/ became short marketing,
             and for a while this button sent people to a hash that redirected
             to the board: a list of other people's jobs, with no way to post
             one. The job is created here now, and only here. */
          <a
            href="/jobs/new"
            className="rounded-full bg-linear-to-r from-teal to-mango px-4 py-2 text-[13px] font-bold text-[#04211D] transition hover:brightness-110"
          >
            Post a job
          </a>
        )}
      </div>
    </nav>
  );
}
