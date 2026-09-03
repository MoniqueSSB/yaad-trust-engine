import Link from "next/link";

/**
 * page.tsx calls notFound() for any slug that is not an active worker: never
 * published, deactivated, or mistyped. Before this file, that fell through
 * to Next's bare default 404, which does not say what happened or where to
 * go next, on a page every worker card in the app links to directly.
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
