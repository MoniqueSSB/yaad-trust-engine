import Link from "next/link";

/**
 * Shown for any slug that is not an active worker: never published,
 * deactivated, or mistyped. Before this file, that fell through to Next's bare
 * default 404, which does not say what happened or where to go next, on a page
 * every worker card in the app links to directly.
 *
 * IT LIVES IN /workers, NOT IN /workers/[slug], and that is load bearing.
 * The notFound() that matters is thrown by `[slug]/layout.tsx`, because that
 * is the only place on this route that runs before the shell is flushed and
 * can therefore still set a 404 (see the long comment in that file). A layout's
 * notFound() is caught by the boundary ABOVE it, so a not-found.tsx sitting
 * beside that layout is inside its own boundary and never renders: the reader
 * gets Next's bare 404 instead, with the right status and none of the words.
 * Moved up one level on 3 September 2026 after exactly that happened.
 *
 * Nothing else lives under /workers, so this covers only worker profiles and
 * the copy can stay specific to them.
 */
export default function WorkerNotFound() {
  return (
    <div className="mx-auto max-w-[560px] px-5 py-16 text-center">
      <p className="font-display text-[15px] uppercase tracking-[.2em] text-tealb">Worker not found</p>
      <h1 className="mt-2 font-display text-[26px] leading-tight">
        This profile isn&apos;t here, or isn&apos;t published yet.
      </h1>
      <p className="mt-3 text-[13.5px] leading-relaxed text-mute">
        The link may be out of date, or the worker isn&apos;t active on
        Yaadly right now. Their profile appears here the moment vetting
        clears.
      </p>
      <Link
        href="/jobs?tab=workers"
        className="mt-6 inline-block rounded-full bg-tealb px-5 py-2.5 text-[13px] font-bold text-onbrand transition hover:brightness-105"
      >
        Browse the worker network
      </Link>
    </div>
  );
}
