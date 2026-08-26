import { redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/auth";
import { signOut } from "../actions";

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
 * Sign-in lives OUTSIDE this (gated) route group on purpose. The first cut
 * had it inside, which meant: signed out -> redirect to sign-in -> layout
 * runs again -> redirect to sign-in. A loop, caught before it shipped.
 */
export default async function PortalLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const user = await getUser();
  if (!user) redirect("/portal/sign-in");

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-50 border-b border-line bg-bg/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1080px] flex-wrap items-center gap-3 px-5 py-3">
          <span className="grid size-8 place-items-center rounded-[9px] bg-teal font-display text-[17px] text-[#04211D]">
            Y
          </span>
          <b className="text-[17px]">
            Yaadly<span className="text-mango">Hub</span>
          </b>
          <span className="ml-auto text-[12.5px] text-dim">{user.email}</span>
          <form action={signOut}>
            <button
              type="submit"
              className="rounded-[9px] border border-line px-3 py-1.5 text-[13px] text-mute transition hover:border-teal hover:text-tealb"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-[1080px] px-5 py-8">{children}</main>
    </div>
  );
}
