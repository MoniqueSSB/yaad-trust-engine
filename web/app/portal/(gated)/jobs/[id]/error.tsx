"use client";

import Link from "next/link";

/**
 * Client Component, required by Next for error.tsx. Catches a render-time
 * throw anywhere in the job room and offers reset() instead of the root
 * layout's generic error screen. Never shows the caught error's own message,
 * and never implies money or evidence has moved: a failed page load is not
 * evidence that anything about the job itself has changed.
 */
export default function JobRoomError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto max-w-[520px] px-5 py-16 text-center">
      <p className="text-[10.5px] font-bold uppercase tracking-[.2em] text-mango">
        Something went wrong
      </p>
      <h1 className="mt-2 font-display text-[24px] uppercase leading-tight">
        This job couldn&apos;t load.
      </h1>
      <p className="mt-3 text-[13.5px] leading-relaxed text-mute">
        Nothing about this job has changed. Give it another try, or go back
        to your jobs list.
      </p>
      {/* The commonest cause, found 28 Sep 2026: a button pressed after the
          session had ended. Every portal action refuses a signed-out caller
          by throwing, and production strips the reason, so this screen is
          where that lands. Said as a possibility, never as a diagnosis. */}
      <p className="mt-2 text-[13px] leading-relaxed text-mute">
        If you have been signed out,{" "}
        <Link href="/portal/sign-in" className="font-bold text-tealb underline-offset-2 hover:underline">
          sign in again
        </Link>{" "}
        and press the button once more.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <button
          onClick={reset}
          className="rounded-full bg-linear-to-r from-teal to-mango px-5 py-2.5 text-[13px] font-bold text-onbrand transition hover:brightness-110"
        >
          Try again
        </button>
        <Link
          href="/portal"
          className="text-[13px] font-bold text-tealb underline-offset-2 hover:underline"
        >
          All your jobs
        </Link>
      </div>
    </div>
  );
}
