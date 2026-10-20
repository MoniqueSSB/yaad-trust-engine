import { getUser } from "@/lib/supabase/auth";
import { signOut } from "./actions";
import { SiteNav } from "@/components/SiteNav";
import { SessionWatch } from "@/components/portal/SessionWatch";

/**
 * The shell every /portal route wears, signed in or not.
 *
 * It exists because the portal used to be three different shapes. The gated
 * pages had a cut-down header with no tabs, sign-in had a bare logo and no
 * way back, and guidelines returned a fragment with no wrapper at all, so it
 * rendered full-bleed with no header whatsoever. Clicking "Client portal" on
 * the marketing site therefore felt like leaving Yaadly for somewhere else,
 * with the browser's back button as the only exit.
 *
 * One shell, one header, every route. The gated layout below stays the door
 * and does nothing else; this is only the frame around it.
 *
 * getUser() here is a read, never a redirect. Sign-in lives outside the
 * (gated) group precisely so it can render for a signed-out visitor, and a
 * redirect at this level would put that back into the loop the gated layout
 * warns about.
 */
export default async function PortalShell({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const user = await getUser();

  return (
    /* portal-skin switches on the portal's own low-strain surfaces and text
       (globals.css, "Portal surfaces"). Public pages on this app keep the
       marketing site's colours. Founder, 20 Oct 2026: portal only for now. */
    <div className="portal-skin min-h-screen">
      <SiteNav
        email={user?.email}
        signOut={user ? signOut : undefined}
      />
      <main className="mx-auto max-w-[1080px] px-5 py-8">{children}</main>
      {/* Only for somebody who arrived signed in. Mounting it for a signed-out
          visitor would arm a "your session has ended" banner for a person who
          never had one. */}
      {user ? <SessionWatch /> : null}
    </div>
  );
}
