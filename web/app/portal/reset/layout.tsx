import type { Metadata } from "next";

/* This exists only to carry the title.
   The reset screen next to it is a Client Component, because the browser
   client is what holds the session, and a Client Component cannot export
   metadata. A layout can. Without it the tab said bare "Yaadly", the same as
   every other portal screen, which is no help to somebody who has sign-in
   open in one tab and their job in another.

   It renders its children and nothing else. Do not put a header here: the
   shell at app/portal/layout.tsx is the one header for every portal route. */
export const metadata: Metadata = { title: "Reset your access · Yaadly" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
