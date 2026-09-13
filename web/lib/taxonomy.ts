/* The trades and parishes, in one place.
   They were declared inside JoinFlow.tsx, and the client funnel needs the same
   two lists. Two copies drift, and the day they drift a client posts a job in
   a trade no worker profile can carry, or in a parish nobody can tick. The
   whole reason a client's roofing job and a worker's roofing profile find each
   other is that both came from this list. */

export const TRADES = [
  "Plumbing", "Roofing", "Electrical", "Tiling", "Masonry & Concrete",
  "Painting & Decorating", "Grille & Gate Welding", "Air Conditioning",
  "Landscaping", "General Handyman", "Solar Install", "Water Tank & Pump",
  "Locks & Security Doors", "Windows & Glazing", "Carpentry & Joinery",
  "Drainage & Septic", "Fencing", "CCTV & Alarms",
] as const;

export const PARISHES = [
  "Kingston", "St Andrew", "St Catherine", "Clarendon", "Manchester",
  "St Elizabeth", "Westmoreland", "Hanover", "St James", "Trelawny",
  "St Ann", "St Mary", "Portland", "St Thomas",
] as const;

/**
 * The launch area, as one list rather than three names repeated.
 *
 * "Kingston and Portmore" is always written together (founder decision,
 * 10 Aug 2026) and Portmore is in St Catherine, so the area is three parishes:
 * the two that make up the Kingston metro plus the one Portmore sits in.
 *
 * The trio was already spelled out inside JoinFlow's "+ Kingston and Portmore"
 * button, with exactly that reasoning in a comment beside it. It is here so
 * the client funnel and the worker funnel cannot disagree about where the
 * business currently operates, which is a thing both of them tell people.
 */
export const LAUNCH_PARISHES = ["Kingston", "St Andrew", "St Catherine"] as const;

export type Trade = (typeof TRADES)[number];
export type Parish = (typeof PARISHES)[number];
