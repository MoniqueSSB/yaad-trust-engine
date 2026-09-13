/**
 * The job room is force-dynamic and runs a dozen Supabase queries in
 * parallel (evidence, quotes, packs, messages, disputes, photos, arrivals,
 * invoices, materials) before it can render. This fills the wait instead of
 * a blank screen, the same convention app/jobs/loading.tsx already uses for
 * the marketplace board.
 */
export default function LoadingJobRoom() {
  return (
    <div className="animate-pulse" aria-busy="true" aria-label="Loading this job">
      <div className="h-3 w-16 rounded bg-panel2" />
      <div className="mt-4 h-24 rounded-2xl border border-line2 bg-panel" />
      <div className="mt-4 h-16 rounded-2xl border border-line bg-panel" />
      <div className="mt-4 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-28 rounded-2xl border border-line bg-panel" />
        ))}
      </div>
      <div className="mt-6 h-9 w-full rounded bg-panel2" />
      <div className="mt-4 h-40 rounded-2xl border border-line bg-panel" />
    </div>
  );
}
