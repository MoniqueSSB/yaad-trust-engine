"use client";

import Link from "next/link";
import type { ReactNode } from "react";

/**
 * A link that lands on a section and shows the reader which one.
 *
 * Every row in "Everything outstanding" points at a #section, often on
 * another tab. The first version leaned on the CSS :target rule for the
 * gold outline, and it never showed: the portal switches tabs with
 * history.pushState, and browsers do not update :target on pushState, only
 * on a full load. Found by the founder trying it, 13 Sep 2026.
 *
 * So the click does it directly. The section on the new tab only exists
 * once the server has rendered that tab, so this waits for it (up to five
 * seconds), then scrolls it into view and outlines it for a moment.
 */

const WAIT_MS = 5000;
const STEP_MS = 100;
const SHOW_MS = 2400;

export function landOn(id: string) {
  const started = Date.now();
  const tick = () => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ block: "start", behavior: "smooth" });
      el.classList.remove("yaad-landed");
      // Restart the animation if the same section is landed on twice.
      void el.offsetWidth;
      el.classList.add("yaad-landed");
      window.setTimeout(() => el.classList.remove("yaad-landed"), SHOW_MS);
      return;
    }
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
