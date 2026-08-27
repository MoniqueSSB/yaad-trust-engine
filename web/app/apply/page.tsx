import { SiteNav } from "@/components/SiteNav";
import { JoinFlow } from "./JoinFlow";

export const dynamic = "force-dynamic";

export const metadata = { title: "Join as a pro · Yaadly" };

/**
 * Join as a pro.
 *
 * This was a single flat form. It is now the nine-step check from the
 * preview, because that is what joining actually is: getting on the board is
 * not a form, it is a check, and the screen should say so before a
 * tradesperson has typed anything.
 *
 * It lives on the app rather than the marketing site because by step 3 it is
 * asking for a passport, a live face video, a TRN and a proof of address.
 * Those files go to the private `vetting` bucket, which no browser token can
 * read and which is destroyed on a clock once the decision is recorded.
 *
 * Joining is not signing in. A tradesperson already on the platform who wants
 * to find their job goes to the worker portal; the header carries both, and
 * they are separate doors on purpose.
 */
export default function Apply() {
  return (
    <>
      <SiteNav active="join" />
      <main className="mx-auto max-w-[1080px] px-5 py-10">
        <JoinFlow />
      </main>
    </>
  );
}
