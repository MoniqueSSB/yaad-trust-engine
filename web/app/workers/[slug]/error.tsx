"use client";

import Link from "next/link";

/**
 * Next.js requires error.tsx to be a Client Component: it renders in place
 * of the segment after a render-time throw (a Supabase call failing, say),
 * and reset() re-runs the segment without a full page reload. Before this
 * file, a failed query here hit the root layout's error boundary instead,
 * which has no framing specific to "a worker profile failed to load".
 */
export default function WorkerProfileError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto max-w-[560px] px-5 py-16 text-center">
      <p className="font-display text-[15px] uppercase tracking-[.2em] text-tealb">Something went wrong</p>
      <h1 className="mt-2 font-display text-[26px] leading-tight">
        This profile couldn&apos;t load.
      </h1>
      <p className="mt-3 text-[13.5px] leading-relaxed text-mute">
        Nothing on your end. Try again, and if it keeps happening the worker
        network is still browsable from the link below.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <button
          onClick={reset}
          className="rounded-full bg-tealb px-5 py-2.5 text-[13px] font-bold text-onbrand transition hover:brightness-105"
        >
          Try again
        </button>
        <Link href="/jobs?tab=workers" className="text-[12.5px] font-semibold text-tealb underline-offset-2 hover:underline">
          Browse the worker network
        </Link>
      </div>
    </div>
  );
}
