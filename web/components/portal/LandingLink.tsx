"use client";

import Link from "next/link";
import type { ReactNode } from "react";

/**
 * A link that lands on a section and shows the reader which one.
 *
 * Every row in "Everything outstanding" points at a #section, often on
 * another tab. Two things went wrong on the way to this, both found by the
 * founder trying it on the live portal, 13 Sep 2026:
 *
 * 1. The gold outline leaned on CSS :target, which never showed: the
 *    portal switches tabs with history.pushState, and browsers do not
 *    update :target on pushState, only on a full load.
 * 2. The page landed on the section and was then thrown back to the top.
 *    Next's own navigation scroll ran after this one and won. So this link
 *    tells Next not to scroll (scroll={false}) and does it alone.
 *
 * The section on the new tab only exists once the server has rendered that
 * tab, so this waits for it (up to five seconds), jumps to it, and holds it
 * in view for a moment in case a late render nudges the page.
 */

const WAIT_MS = 5000;
const STEP_MS = 100;
const HOLD_MS = 1200;
const SHOW_MS = 2400;

function place(el: HTMLElement) {
  el.scrollIntoView({ block: "start" });
  el.classList.remove("yaad-landed");
  // Restart the animation if the same section is landed on twice.
  void el.offsetWidth;
  el.classList.add("yaad-landed");
  window.setTimeout(() => el.classList.remove("yaad-landed"), SHOW_MS);

  const until = Date.now() + HOLD_MS;
  const hold = () => {
    if (!el.isConnected) return;
    const top = el.getBoundingClientRect().top;
    if (top < -8 || top > window.innerHeight / 2) el.scrollIntoView({ block: "start" });
    if (Date.now() < until) window.setTimeout(hold, 150);
  };
  window.setTimeout(hold, 150);
}

export function landOn(id: string) {
  const started = Date.now();
  const tick = () => {
    const el = document.getElementById(id);
    if (el) return place(el);
    if (Date.now() - started < WAIT_MS) window.setTimeout(tick, STEP_MS);
  };
  tick();
}

export function LandingLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: ReactNode;
}) {
  const hash = href.includes("#") ? decodeURIComponent(href.split("#")[1]) : "";
  return (
    <Link
      href={href}
      scroll={hash ? false : undefined}
      className={className}
      onClick={(e) => {
        // A new tab or window loads the page in full, where :target works.
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        if (hash) landOn(hash);
      }}
    >
      {children}
    </Link>
  );
}
