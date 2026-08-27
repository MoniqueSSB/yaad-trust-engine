"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";

/**
 * The same header the landing page wears, so app.yaadly.co.uk reads as a
 * tab of one Yaadly site rather than a separate place. Marketplace is the
 * lit tab here; everything else links back across.
 *
 * The portal used to render its own cut-down header instead of this one:
 * logo, email, sign out, and no tabs at all. That is what made signing in
 * feel like leaving Yaadly and arriving somewhere else, with no way back
 * except the browser's back button. It now uses this header too, and passes
 * the signed-in email and the sign-out action in so nothing is lost.
 *
 * The client portal and the worker portal are two separate products, so they
 * are two tabs. An existing tradesperson signing in to find their job must
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
    "rounded-[9px] border px-3 py-1.5 text-[13px] transition " +
    (on
      ? "border-softline bg-soft font-bold text-tealb"
      : "border-transparent font-medium text-mute hover:bg-panel2 hover:text-ink");
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
          <a href={SITE} className={tab(false)}>Website</a>
          <Link href="/jobs" className={tab(here === "market")}>Marketplace</Link>
          <a href={`${SITE}/#services`} className={tab(false)}>Services</a>
          <Link href="/portal/client" className={tab(here === "client")}>Client portal</Link>
          <Link href="/portal/worker" className={tab(here === "worker")}>Worker portal</Link>
          <Link href="/apply" className={tab(here === "join")}>Join as a pro</Link>
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
          /* #post, not #startform: the single intake form was replaced by the
             six-step wizard, which lives in its own pane and is reached by
             that hash. The old anchor pointed at markup that no longer exists. */
          <a
            href={`${SITE}/#post`}
            className="rounded-full bg-linear-to-r from-teal to-mango px-4 py-2 text-[13px] font-bold text-[#04211D] transition hover:brightness-110"
          >
            Post a job
          </a>
        )}
      </div>
    </nav>
  );
}
