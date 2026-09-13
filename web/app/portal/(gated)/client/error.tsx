"use client";

/**
 * Client Component, required by Next for error.tsx. Catches a render-time
 * throw anywhere in the client portal's jobs list and offers reset() instead
 * of the root layout's generic error screen. Never shows the caught error's
 * own message: a raw Postgres or Supabase error is not something a client
 * should have to read, and it is not this screen's place to explain why the
 * query failed.
 */
export default function ClientPortalError({
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
        Your jobs couldn&apos;t load.
      </h1>
      <p className="mt-3 text-[13.5px] leading-relaxed text-mute">
        Nothing on your end, and nothing has changed on any of your jobs.
        Give it another try.
      </p>
      <button
        onClick={reset}
        className="mt-6 rounded-full bg-linear-to-r from-teal to-mango px-5 py-2.5 text-[13px] font-bold text-onbrand transition hover:brightness-110"
      >
        Try again
      </button>
    </div>
  );
}
