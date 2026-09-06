/**
 * The marketplace board (jobs/page.tsx) is force-dynamic and runs several
 * Supabase queries, sometimes photo-signing on top, before it can render
 * either tab. This fills the wait instead of a blank page, on the one route
 * every "Quote this job" and "The worker network" link in the app points at.
 */
export default function LoadingBoard() {
  return (
    <div className="mx-auto max-w-[1040px] animate-pulse px-5 py-10" aria-busy="true" aria-label="Loading the marketplace">
      <div className="h-10 w-2/3 rounded bg-panel2" />
      <div className="mt-3.5 h-4 w-1/2 rounded bg-panel2" />
      <div className="mt-6 flex gap-2 border-b border-line pb-4.5">
        <div className="h-9 w-32 rounded-full bg-panel2" />
        <div className="h-9 w-44 rounded-full bg-panel2" />
      </div>
      {[0, 1, 2].map((i) => (
        <div key={i} className="mt-3.5 h-32 rounded-[18px] border border-line bg-panel" />
      ))}
    </div>
  );
}
