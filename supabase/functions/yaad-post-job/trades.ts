// The trade list, from ONE place.
//
// Generated from `data/job-taxonomy.js`, which CLAUDE.md §11 names as the
// source of truth for every trade and job type dropdown. Do not edit by hand:
// `trades_test.ts` reads the taxonomy and fails if this drifts from it. That
// is the same protection guardrails.ts and textmodel.ts already get from
// being shared, and it is the reason this file exists at all.
//
// ── Why there were three lists ──
//
// The agent audit of 4 September 2026 found four prompts that turn a
// description into a job card, drawing their trades from three different
// places: hard-coded in `yaad-inbound`, a local const in `yaad-post-job`, and
// `app_settings.trade_list` for `yaad-agent`. The first two happened to agree.
// The third had 13 lowercase trades against the taxonomy's 18, with different
// names for several, so eight trades were invisible to that classifier,
// including Solar Install, Drainage & Septic and CCTV & Alarms.
//
// It was latent rather than live, for two reasons that are both luck. Nothing
// calls that classifier. And `trade_key()` in Postgres normalises BOTH a job's
// trade and a worker's through the same regexes, so worker matching never
// depended on these lists agreeing with each other at all. Luck is what this
// file replaces.

export const TRADES: readonly string[] = [
  "Plumbing",
  "Roofing",
  "Electrical",
  "Tiling",
  "Masonry & Concrete",
  "Painting & Decorating",
  "Grille & Gate Welding",
  "Air Conditioning",
  "Landscaping",
  "General Handyman",
  "Solar Install",
  "Water Tank & Pump",
  "Locks & Security Doors",
  "Windows & Glazing",
  "Carpentry & Joinery",
  "Drainage & Septic",
  "Fencing",
  "CCTV & Alarms"
];

/** The line a prompt uses, built once so a new trade reaches every agent that
 *  reads a job description rather than only the two that happened to share a
 *  copy of the list. */
export const TRADES_PROMPT_LINE = `one of ${TRADES.join(", ")}. Empty if unclear.`;
