import Link from "next/link";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { PayoutSetupButton } from "@/components/portal/PayoutSetupButton";
import { checkPayoutSetup, startPayoutSetup, type PayoutState } from "@/app/portal/payout-actions";

// Never cached: what Stripe last said about this worker is the whole page.
export const dynamic = "force-dynamic";

export const metadata = { title: "How Yaadly pays you · Yaadly" };

/**
 * How Yaadly pays a worker, 20260914200000.
 *
 * The page the booking WhatsApp points at, and the page Stripe sends the
 * worker back to. The worker types their bank details into Stripe's own
 * form; Yaadly never sees or keeps them (founder decision, 14 Sep 2026).
 * Stripe's sign-up link is single use and lasts ten minutes, so it is never
 * put in a message: it is made fresh here, for the signed-in worker, on the
 * tap of the button.
 */
const WORDS: Record<PayoutState, { title: string; detail: string; button: string }> = {
  none: {
    title: "Not set up yet",
    detail: "Before Yaadly can pay you, add the bank account you want to be paid into. It takes a few minutes on Stripe's secure page.",
    button: "Set up with Stripe",
  },
  started: {
    title: "Started, not finished",
    detail: "Stripe still needs a few details from you before it can pay you. Pick up where you left off.",
    button: "Carry on with Stripe",
  },
  needs_info: {
    title: "Stripe needs something from you",
    detail: "Stripe cannot pay you yet. Open it to see what is missing.",
    button: "Open Stripe",
  },
  ready: {
    title: "Ready to be paid",
    detail: "Stripe has your bank details and Yaadly can pay you. To change the account you are paid into, update it on Stripe.",
    button: "Update your details",
  },
};

export default async function Payouts({
  searchParams,
}: {
  searchParams: Promise<{ back?: string; again?: string }>;
}) {
  const user = await getUser();
  if (!user) redirect("/portal/sign-in");
  const { back, again } = await searchParams;

  // Stripe sends the worker here with ?again=1 when its one-time link had
  // expired or been opened twice: make a fresh one and go straight back.
  if (again) {
    const out = await startPayoutSetup();
    if (out.ok) redirect(out.url);
  }

  // Coming back from Stripe: ask Stripe, which records the answer. Otherwise
  // read what was last recorded.
  let state: PayoutState | null = back ? await checkPayoutSetup() : null;
  if (!state) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("worker_profiles")
      .select("stripe_recipient_status")
      .eq("worker_user", user.id)
      .maybeSingle();
    state = ((data?.stripe_recipient_status as PayoutState | undefined) ?? "none");
  }
  const w = WORDS[state];

  return (
    <main className="mx-auto max-w-[720px] px-5 py-10">
      <Link href="/portal/worker" className="text-[12.5px] text-tealb underline-offset-2 hover:underline">
        Back to your work
      </Link>
      <h1 className="mt-4 font-display text-[clamp(26px,4vw,38px)] uppercase leading-none">How Yaadly pays you</h1>
      <p className="mt-3 max-w-[62ch] text-[14px] leading-relaxed text-mute">
        Yaadly pays you through Stripe, in J$, into your own Jamaican bank account. You type your bank details into
        Stripe&apos;s secure page. Yaadly never sees them and does not keep them.
      </p>

      <section className="mt-6 rounded-2xl border border-line bg-panel p-5">
        <p className="text-[10.5px] font-bold uppercase tracking-[.2em] text-tealb">{w.title}</p>
        <p className="mt-2 text-[13.5px] leading-relaxed text-ink">{w.detail}</p>
        <PayoutSetupButton label={w.button} />
      </section>

      <p className="mt-5 max-w-[62ch] text-[12.5px] leading-relaxed text-dim">
        Never type bank details into WhatsApp, including to Yaadly&apos;s number. Messages there are kept with your
        job. If anybody asks you for your bank details in a message, say no and tell Yaadly.
      </p>
    </main>
  );
}
