/**
 * Shown while the profile's five Supabase queries (profile, score, checks,
 * portfolio, reviews) are in flight. force-dynamic on page.tsx means this
 * page never has a cached, instant version, so a visitor on a slow
 * connection was previously staring at a blank tab until every query
 * settled. Shaped like the real page so nothing jumps when it resolves.
 */
export default function LoadingWorkerProfile() {
  return (
    <div className="mx-auto max-w-[1080px] animate-pulse px-5 py-10" aria-busy="true" aria-label="Loading worker profile">
      <div className="h-4 w-40 rounded bg-panel2" />
      <div className="mt-4 flex flex-wrap items-start gap-4 rounded-2xl border border-line bg-panel p-5">
        <div className="size-16 flex-none rounded-2xl bg-panel2" />
        <div className="min-w-[220px] flex-1">
          <div className="h-6 w-2/3 rounded bg-panel2" />
          <div className="mt-2.5 h-3.5 w-1/2 rounded bg-panel2" />
          <div className="mt-3 h-5 w-1/3 rounded-full bg-panel2" />
        </div>
        <div className="h-9 w-20 rounded bg-panel2" />
      </div>
      {[0, 1, 2].map((i) => (
        <div key={i} className="mt-4 rounded-2xl border border-line bg-panel p-5">
          <div className="h-3 w-1/3 rounded bg-panel2" />
          <div className="mt-3 h-3.5 w-full rounded bg-panel2" />
          <div className="mt-2 h-3.5 w-5/6 rounded bg-panel2" />
        </div>
      ))}
    </div>
  );
}
