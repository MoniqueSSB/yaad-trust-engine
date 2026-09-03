/**
 * One colour convention for every status pill in the portal.
 *
 * Before this, a job row, an invoice row and a money row each chose their own
 * colours, and the commonest choice was "the same pill for everything". So
 * "Closed", "Draft, not live yet" and "Evidence waiting on you" arrived in one
 * shade, and a client with six jobs had to read all six to find the one that
 * needed them. Colour should do that work before the words are read.
 *
 * The convention is the admin desk's, carried across so the desk and the
 * portal describe the same job the same way:
 *
 *   waiting  gold    the person reading this is the one holding it up
 *   moving   purple  in flight, correctly, and not on the reader
 *   done     green   finished and paid
 *   idle     grey    not live yet, or a state we have no name for
 *
 * Tone is per audience, not per status. "Open for quotes" is `moving` for a
 * client with nothing to do but wait and `waiting` for a worker who can quote
 * it right now, which is why the two portals pass their own maps.
 *
 * All four clear WCAG AA on the panel background. If a fifth is ever added,
 * check it does too, and add it here rather than in the component asking for
 * it, or the convention is back to being a suggestion.
 */
export type StatusTone = "waiting" | "moving" | "done" | "idle";

export type StatusLabel = { label: string; tone: StatusTone };

export const STATUS_TONE: Record<StatusTone, string> = {
  waiting: "border-gold/45 bg-gold/12 text-goldb",
  moving: "border-softline bg-soft text-purpleb",
  done: "border-green/35 bg-green/10 text-green",
  idle: "border-line bg-panel2 text-mute",
};
