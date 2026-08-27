import { redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/auth";

/**
 * The door.
 *
 * Everything under /portal is checked here, on the server, before a single
 * byte of the page is sent. A signed-out visitor never receives the portal
 * markup at all. That is the whole point of moving this out of the marketing
 * site, where the page was delivered to everybody and JavaScript decided
 * afterwards whether to show it.
 *
 * The check is repeated in each page rather than trusted from here alone.
 * A layout does not re-run for every navigation, so a layout-only gate is a
 * gate that can be walked around.
 *
 * The frame around this, including the header, is app/portal/layout.tsx.
 * This file is only the gate.
 *
 * Sign-in lives OUTSIDE this (gated) route group on purpose. The first cut
 * had it inside, which meant: signed out -> redirect to sign-in -> layout
 * runs again -> redirect to sign-in. A loop, caught before it shipped.
 */
export default async function PortalLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const user = await getUser();
  if (!user) redirect("/portal/sign-in");

  return <>{children}</>;
}

