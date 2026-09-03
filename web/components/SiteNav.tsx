"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";

/**
 * The one Yaadly header. Same markup, same order, same labels as
 * docs/nav.css on the marketing site, so app.yaadly.co.uk reads as another
 * page of one site rather than somewhere else you were sent.
 *
 * Fixed 2 Sep 2026: this used to run a shorter menu than the marketing site,
 * "Marketplace" where the site said "Overview" and no "Job board" tab at all,
 * so the header changed shape the moment you crossed from yaadly.co.uk into
 * the app. The tabs are now the same six on both sides. Overview is the story
 * page and lives on the marketing site; Job board is the live board and lives
 * here, which is why one crosses back and the other does not.
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
  /* Same values as docs/nav.css, kept in Tailwind here because this is the
     only header in the app. The marketing gradient is written out in full
     rather than reached for through a token, because --grad is a marketing
     stylesheet variable and this bundle does not load that stylesheet. */
  const GRAD = "bg-[linear-gradient(135deg,#7B4FE0,#9B73F5_45%,#F59E0B)]";
  const tab = (on: boolean) =>
    "rounded-[8px] px-[8px] py-1.5 whitespace-nowrap text-[13px] transition " +
    (on
      ? "font-semibold text-purpleb bg-[rgba(155,115,245,0.12)]"
      : "font-medium text-mute hover:text-ink hover:bg-[rgba(155,115,245,0.09)]");
  const quiet =
    "px-[6px] py-1.5 whitespace-nowrap text-[12px] text-dim transition hover:text-purpleb";
  return (
    <nav className="sticky top-0 z-50 border-b border-line bg-bg/85 backdrop-blur-[14px]">
      <div className="mx-auto flex min-h-[58px] max-w-[1100px] flex-nowrap items-center px-6 max-[820px]:flex-wrap max-[820px]:gap-y-2 max-[820px]:px-[18px] max-[820px]:py-2">
        <a href={SITE} className="mr-auto flex shrink-0 items-center gap-2 font-display text-[18px] font-medium">
          <span className={`grid size-[30px] place-items-center rounded-[8px] text-[16px] font-bold text-white ${GRAD}`}>
            Y
          </span>
          <b className="font-medium">
            Yaadly<span className="font-light text-mute">Hub</span>
          </b>
        </a>
        <div className="flex items-center gap-0.5 max-[820px]:order-3 max-[820px]:w-full max-[820px]:overflow-x-auto">
          <a href={`${SITE}/marketplace`} className={tab(false)}>Overview</a>
          <Link href="/jobs" className={tab(here === "market")}>Job board</Link>
          <a href={`${SITE}/services`} className={tab(false)}>Managed services</a>
          <a href={`${SITE}/business`} className={tab(false)}>For business</a>
          <a href={`${SITE}/contact`} className={tab(false)}>Contact</a>
          <a href="https://cal.com/yaadly/15min" target="_blank" rel="noopener" className={tab(false)}>Book a call</a>
        </div>
        {/* Signed out, these are the three doors in, and they are the same
            three the marketing site shows. Signed in, they come out: the
            email and Sign out take that space, "Join as a pro" is not what
            a signed-in person is there for, and keeping all of it would push
            the row past the page edge. */}
        {signOut ? null : (
          <div className="ml-2.5 flex items-center border-l border-line pl-2.5 max-[1080px]:hidden">
            <Link href="/portal/client" className={quiet + (here === "client" ? " font-semibold text-purpleb" : "")}>Client portal</Link>
            <Link href="/portal/worker" className={quiet + (here === "worker" ? " font-semibold text-purpleb" : "")}>Worker portal</Link>
            <Link href="/apply" className={quiet + (here === "join" ? " font-semibold text-purpleb" : "")}>Join as a pro</Link>
          </div>
        )}

        {email ? (
          <span className="ml-auto max-w-[220px] truncate pl-3 text-[12.5px] text-dim">{email}</span>
        ) : null}

        {signOut ? (
          <form action={signOut}>
            <button
              type="submit"
              className="ml-3.5 rounded-[9px] border border-line px-3 py-1.5 text-[13px] text-mute transition hover:border-purple hover:text-purpleb"
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
            className={`ml-3 shrink-0 whitespace-nowrap rounded-full px-[15px] py-2 text-[12.5px] font-bold text-white transition hover:brightness-110 ${GRAD}`}
          >
            Post a job
          </a>
        )}
      </div>
    </nav>
  );
}
