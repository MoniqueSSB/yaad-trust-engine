import Link from "next/link";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { BankDetailsForm } from "@/components/portal/BankDetailsForm";
import { PayoutSetupButton } from "@/components/portal/PayoutSetupButton";
import { checkPayoutSetup, startPayoutSetup, type PayoutState } from "@/app/portal/payout-actions";

// Never cached: whether Yaadly can pay this worker yet is the point of the page.
export const dynamic = "force-dynamic";

export const metadata = { title: "How Yaadly pays you · Yaadly" };

/**
 * How Yaadly pays a worker.
 *
 * Two ways, both bank transfer in J$ to the worker's own Jamaican account,
 * never cash (founder, 14 Sep 2026). Yaadly stores no bank details either way.
 *
 *  1. Stripe (16 Sep 2026, back on the page once Global Payouts was found
 *     enabled and Jamaica offered). The worker types their details into
 *     Stripe's own form; Yaadly keeps only Stripe's reference. Stripe's link
 *     is single use and lasts ten minutes, so it is made fresh on the tap.
 *  2. Wise (20260914240000). The worker types their details here and they
 *     go straight to Yaadly's Wise account; Yaadly keeps only Wise's id.
 *
 * Either way nobody is paid until a person at Yaadly has called the worker
 * back to check the details, and new details need a fresh call-back.
 */
const STRIPE_WORDS: Record<PayoutState, { title: string; detail: string; button: string }> = {
  none: {
    title: "Stripe: not set up yet",
    detail: "Add the bank account you want to be paid into, on Stripe's secure page. It takes a few minutes.",
    button: "Set up with Stripe",
  },
  started: {
    title: "Stripe: started, not finished",
    detail: "Stripe still needs a few details from you before it can pay you. Pick up where you left off.",
    button: "Carry on with Stripe",
  },
  needs_info: {
    title: "Stripe needs something from you",
    detail: "Stripe cannot pay you yet. Open it to see what is missing.",
    button: "Open Stripe",
  },
  ready: {
    title: "Stripe: ready",
    detail: "Stripe has your bank details. To change the account you are paid into, update it on Stripe.",
    button: "Update your details on Stripe",
  },
};

function day(iso: string | null | undefined) {
  return iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "";
}

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

  const supabase = await createClient();
  const { data } = await supabase
    .from("worker_profiles")
    .select("wise_recipient_set_at,bank_callback_at,stripe_recipient_status")
    .eq("worker_user", user.id)
    .maybeSingle();
  const setAt = (data?.wise_recipient_set_at as string | null | undefined) ?? null;
  const checkedAt = (data?.bank_callback_at as string | null | undefined) ?? null;

  // Coming back from Stripe: ask Stripe, which records the answer. Otherwise
  // read what was last recorded.
  let stripeState: PayoutState | null = back ? await checkPayoutSetup() : null;
  if (!stripeState) stripeState = ((data?.stripe_recipient_status as PayoutState | undefined) ?? "none");
  const sw = STRIPE_WORDS[stripeState];

  const callback = checkedAt
    ? `Checked by phone on ${day(checkedAt)}. Yaadly can pay you.`
    : (setAt || stripeState !== "none")
      ? "Yaadly will call you on the number we have for you to check your details before any money goes."
      : "";

  return (
    <main className="mx-auto max-w-[720px] px-5 py-10">
      <Link href="/portal/worker" className="text-[12.5px] text-tealb underline-offset-2 hover:underline">
        Back to your work
      </Link>
      <h1 className="mt-4 font-display text-[clamp(26px,4vw,38px)] uppercase leading-none">How Yaadly pays you</h1>
      <p className="mt-3 max-w-[62ch] text-[14px] leading-relaxed text-mute">
        Yaadly pays you in J$ by bank transfer, into your own Jamaican bank account. Yaadly does not pay in cash, and
        it does not keep your bank details: you give them to Stripe or to Wise, the services Yaadly pays through.
      </p>
      {callback && (
        <p className="mt-3 max-w-[62ch] text-[13px] leading-relaxed text-ink">{callback}</p>
      )}

      <section className="mt-6 rounded-2xl border border-line bg-panel p-5">
        <p className="text-[10.5px] font-bold uppercase tracking-[.2em] text-tealb">{sw.title}</p>
        <p className="mt-2 text-[13.5px] leading-relaxed text-ink">{sw.detail}</p>
        <PayoutSetupButton label={sw.button} />
        <p className="mt-3 text-[12px] leading-relaxed text-dim">
          Stripe pays into your account in J$, usually within a few working days of Yaadly sending it.
        </p>
      </section>

      <section className="mt-4 rounded-2xl border border-line bg-panel p-5">
        <p className="text-[10.5px] font-bold uppercase tracking-[.2em] text-tealb">
          {setAt ? `Wise: details sent on ${day(setAt)}` : "Or give your details to Wise"}
        </p>
        <p className="mt-2 text-[13.5px] leading-relaxed text-ink">
          {setAt
            ? "Yaadly can also pay you through Wise with the details you gave."
            : "If you would rather not use Stripe, type your bank details here and they go straight to Wise."}
        </p>
        <BankDetailsForm hasDetails={Boolean(setAt)} />
        <p className="mt-4 text-[12.5px] leading-relaxed text-dim">
          Rather not type them at all? Yaadly can take them on a call instead.
        </p>
      </section>

      <p className="mt-5 max-w-[62ch] text-[12.5px] leading-relaxed text-dim">
        Never type bank details into WhatsApp, including to Yaadly&apos;s number. Messages there are kept with your
        job. If anybody asks you for your bank details in a message, say no and tell Yaadly.
      </p>
    </main>
  );
}
