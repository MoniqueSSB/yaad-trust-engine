import Link from "next/link";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/auth";

export const metadata = { title: "How Yaadly pays you · Yaadly" };

/**
 * How Yaadly pays a worker.
 *
 * Founder, 14 Sep 2026: bank transfer only for now, never cash. Lynk waits
 * until Yaadly is registered in Jamaica. Stripe payouts, where a worker types
 * bank details into Stripe's own form (20260914200000, yaad-payout-setup),
 * stay "coming soon" until Global Payouts is approved: the function is
 * deployed and dormant, and this page does not call it. Yaadly never stores
 * worker bank details; they are taken by phone and saved in Yaadly's own bank.
 */
export default async function Payouts() {
  const user = await getUser();
  if (!user) redirect("/portal/sign-in");

  return (
    <main className="mx-auto max-w-[720px] px-5 py-10">
      <Link href="/portal/worker" className="text-[12.5px] text-tealb underline-offset-2 hover:underline">
        Back to your work
      </Link>
      <h1 className="mt-4 font-display text-[clamp(26px,4vw,38px)] uppercase leading-none">How Yaadly pays you</h1>
      <p className="mt-3 max-w-[62ch] text-[14px] leading-relaxed text-mute">
        Yaadly pays you in J$ by bank transfer, into your own Jamaican bank account. Yaadly does not pay in cash.
      </p>

      <section className="mt-6 rounded-2xl border border-line bg-panel p-5">
        <p className="text-[10.5px] font-bold uppercase tracking-[.2em] text-tealb">Your bank details</p>
        <p className="mt-2 text-[13.5px] leading-relaxed text-ink">
          Yaadly calls you to take your bank details before your first payment, and saves them in its own bank, not on
          this site. When a payment goes, you get a WhatsApp with the amount and the reference.
        </p>
        <p className="mt-3 text-[12.5px] leading-relaxed text-dim">
          <b className="text-mute">Coming soon:</b> setting up your bank details yourself, on Stripe&apos;s secure page.
        </p>
      </section>

      <p className="mt-5 max-w-[62ch] text-[12.5px] leading-relaxed text-dim">
        Never type bank details into WhatsApp, including to Yaadly&apos;s number. Messages there are kept with your
        job. If anybody asks you for your bank details in a message, say no and tell Yaadly.
      </p>
    </main>
  );
}
