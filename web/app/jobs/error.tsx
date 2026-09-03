"use client";

/**
 * Client Component, required by Next for error.tsx. Catches a render-time
 * throw anywhere in jobs/page.tsx (open jobs or the worker directory tab)
 * and offers reset() instead of the root layout's generic error screen.
 */
export default function BoardError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto max-w-[560px] px-5 py-16 text-center">
      <p className="font-mono-app text-[11px] font-medium uppercase tracking-[0.06em] text-dim">Something went wrong</p>
      <h1 className="mt-2 font-display text-[26px] font-light leading-tight">The marketplace couldn&apos;t load.</h1>
      <p className="mt-3 text-[13.5px] leading-relaxed text-mute">
        Nothing on your end. Give it another try.
      </p>
      <button
        onClick={reset}
        className="mt-6 rounded-full bg-linear-to-r from-purple to-gold px-5 py-2.5 text-[13.5px] font-bold text-white transition hover:-translate-y-px hover:brightness-110"
      >
        Try again
      </button>
    </div>
  );
}
