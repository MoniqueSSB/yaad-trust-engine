"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

/**
 * Says so when the session has gone, instead of letting the page lie.
 *
 * lib/supabase/auth.ts names this gap and then nothing acted on it: token
 * refresh happens in the BROWSER on this stack, not on the server, because
 * Next 16 pins Proxy to the Node runtime and Cloudflare Workers cannot run it.
 * So a portal page renders server-side with a valid session, the tab is left
 * open, the refresh token eventually fails, and the page carries on looking
 * completely normal. Every figure on it is real but stale, and the next thing
 * the person presses fails with whatever the server action happens to throw.
 * On the job room that is the approve button.
 *
 * A BANNER, NOT A REDIRECT, and that is the whole design decision.
 *
 * Yanking somebody to a sign-in screen the moment a token expires throws away
 * whatever they were part-way through: a half-written dispute, an evidence
 * comment, a materials store they were typing. It also races the deliberate
 * sign-out, which already redirects, and would leave a person who chose to
 * leave being told their session had expired.
 *
 * So this does the smaller, truer thing: it says the session has ended, keeps
 * the page where it is, and offers the way back. The gated layout still
 * refuses the next navigation, so nothing here is load bearing for security.
 * It exists so the failure is legible rather than silent.
 *
 * SIGNED_OUT is the event Supabase fires for BOTH a deliberate sign-out and a
 * refresh that could not be completed, with nothing to tell them apart. The
 * pathname check is what separates them: a deliberate sign-out has already
 * been redirected to /portal/sign-in by the server action, so if we are still
 * on a portal page when the event lands, the session ended on its own.
 */
export function SessionWatch() {
  const [ended, setEnded] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
        setEnded(false);
        return;
      }
      if (event === "SIGNED_OUT" && !session) {
        const here = window.location.pathname;
        // Already on the way out, or already out. Not our business.
        if (here.startsWith("/portal/sign-in") || here.startsWith("/portal/join")) return;
        setEnded(true);
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);

  if (!ended) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-gold/40 bg-[#1a1408] px-5 py-3.5"
    >
      <div className="mx-auto flex max-w-[1080px] flex-wrap items-center gap-x-4 gap-y-2">
        <p className="min-w-[240px] flex-1 text-[13.5px] leading-relaxed text-goldb">
          <b className="font-semibold">Your session has ended.</b>{" "}
          <span className="text-mute">
            Nothing on this page is lost, but it will not save until you sign in
            again. Open sign in on another tab if you are part-way through
            something here.
          </span>
        </p>
        {/* No ?next= on this link. Sign in does not read one, and a parameter
            that promises to bring somebody back to where they were, and then
            does not, is worse than sending them to the door and letting them
            navigate. Worth adding to sign-in later; not worth pretending now. */}
        <Link
          href="/portal/sign-in"
          className="rounded-full border border-gold/50 px-4 py-2 text-[12.5px] font-bold text-goldb transition hover:bg-gold/10"
        >
          Sign in again
        </Link>
      </div>
    </div>
  );
}
