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

export type Trade = (typeof TRADES)[number];
export type Parish = (typeof PARISHES)[number];
