import Link from "next/link";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { BankDetailsForm } from "@/components/portal/BankDetailsForm";

// Never cached: whether Yaadly has checked the details is the point of the page.
export const dynamic = "force-dynamic";

export const metadata = { title: "How Yaadly pays you · Yaadly" };

/**
 * How Yaadly pays a worker.
 *
 * Founder, 14 Sep 2026: bank transfer only, never cash, through Yaadly's Wise
 * Business account. The worker's details go straight to Wise from this page
 * (yaad-wise-recipient, 20260914240000); Yaadly keeps only Wise's reference.
 * Nobody is paid until a person has called the worker back to check them,
 * and new details need a fresh call-back. Stripe payouts stay "coming soon".
 */
function day(iso: string | null | undefined) {
  return iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "";
}

export default async function Payouts() {
  const user = await getUser();
  if (!user) redirect("/portal/sign-in");

  const supabase = await createClient();
  const { data } = await supabase
    .from("worker_profiles")
    .select("wise_recipient_set_at,bank_callback_at")
    .eq("worker_user", user.id)
    .maybeSingle();
  const setAt = (data?.wise_recipient_set_at as string | null | undefined) ?? null;
  const checkedAt = (data?.bank_callback_at as string | null | undefined) ?? null;

  const status = checkedAt
    ? `Checked by phone on ${day(checkedAt)}. Yaadly can pay you.`
    : setAt
      ? `Sent to Wise on ${day(setAt)}. Yaadly will call you on the number we have for you to check them before any money goes.`
      : "Not given yet.";

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
        <p className="mt-2 text-[13.5px] leading-relaxed text-ink">{status}</p>
        <BankDetailsForm hasDetails={Boolean(setAt)} />
        <p className="mt-4 text-[12.5px] leading-relaxed text-dim">
          Rather not type them? Yaadly can take them on a call instead.
        </p>
      </section>

      <p className="mt-5 max-w-[62ch] text-[12.5px] leading-relaxed text-dim">
        Never type bank details into WhatsApp, including to Yaadly&apos;s number. Messages there are kept with your
        job. If anybody asks you for your bank details in a message, say no and tell Yaadly.
      </p>
    </main>
  );
}
