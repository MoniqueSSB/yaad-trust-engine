/**
 * The client portal (jobs list) is force-dynamic and runs two Supabase
 * queries plus a signature check before it can render anything. This fills
 * the wait instead of a blank screen, the same convention app/jobs/loading.tsx
 * already uses for the marketplace board.
 */
export default function LoadingClientPortal() {
  return (
    <div className="animate-pulse" aria-busy="true" aria-label="Loading your jobs">
      <div className="h-3 w-24 rounded bg-panel2" />
      <div className="mt-3 h-9 w-2/3 rounded bg-panel2" />
      <div className="mt-3 h-4 w-1/2 rounded bg-panel2" />
      <div className="mt-8 h-3 w-20 rounded bg-panel2" />
      {[0, 1, 2].map((i) => (
        <div key={i} className="mt-3 h-20 rounded-2xl border border-line bg-panel" />
      ))}
    </div>
  );
}
