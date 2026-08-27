/**
 * The four-tile strip from the preview's portal, `tiles()`.
 *
 * One line each: what it is, the number, and why the number matters. It sits
 * directly under the stage rail because it answers the three questions
 * somebody opens a portal to ask, in the order they ask them: where is my
 * money, what is waiting on me, and what happens next.
 *
 * The preview hard-codes its figures. Every value here is passed in from the
 * job row, so an empty job shows honest blanks rather than somebody else's
 * numbers.
 */
export type Tile = {
  label: string;
  value: string;
  /** mango, for anything held or owed to a decision */
  held?: boolean;
  note?: string;
};

export function PortalTiles({ tiles }: { tiles: Tile[] }) {
  if (tiles.length === 0) return null;
  return (
    <div className="mt-4 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
      {tiles.map((t) => (
        <div
          key={t.label}
          className="rounded-2xl border border-line bg-panel px-4 py-3.5"
        >
          <div className="text-[10px] font-bold uppercase tracking-[.14em] text-dim">
            {t.label}
          </div>
          <div
            className={
              "mt-1.5 font-display text-[23px] leading-none " +
              (t.held ? "text-mango" : "text-tealb")
            }
          >
            {t.value}
          </div>
          {t.note && (
            <div className="mt-1.5 text-[11.5px] leading-snug text-dim">
              {t.note}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
