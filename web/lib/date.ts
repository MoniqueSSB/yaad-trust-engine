/**
 * Timestamps, formatted one way.
 *
 * Before this, the job room alone had four different renderings of the same
 * kind of value: a raw "2026-09-02 14:30" ISO slice for the room's own
 * lastUpdated, chat and arrival timestamps; a separate toISOString().slice()
 * inside EvidenceLedger; a bare .slice(0, 10) inside MaterialsStore and
 * MoneyPanel; and, one component over in JobList, an actually friendly
 * "3 Sep 2026". A client reading "2026-09-02 14:30" next to "3 Sep 2026" on
 * the same page has no reason to think they are looking at the same kind of
 * fact, on a product whose whole premise is that its records can be trusted.
 *
 * Two shapes, because the call sites genuinely need two: a date on its own
 * for anything that only matters by the day (a signature, a materials
 * release), and a date with time for anything a client might reasonably ask
 * "when exactly", like a chat message or a stage's last movement.
 */

/** "3 Sep 2026". Short, unambiguous across UK, US and Jamaican readers, which
 *  a numeric date is not. Same rendering JobList already used. */
/* Both helpers render in Jamaica time, where the work happens and the worker
   is. Until 28 Sep 2026 they used the runtime's zone, which on Cloudflare is
   UTC: a check-in at 10:10 am in Kingston, 3:10 pm in London, read "2:10 pm",
   true for nobody. The time carries its zone so a client abroad knows what it
   is. Jamaica keeps no daylight saving, so this never shifts. */
const SITE_TZ = "America/Jamaica";

export function whenDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: SITE_TZ });
}

/** "3 Sep 2026, 2:30 pm". */
export function whenDateTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const date = whenDate(iso);
  const time = d
    .toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: SITE_TZ })
    .replace(/^0/, "")
    .toLowerCase();
  return `${date}, ${time} Jamaica time`;
}
