"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

/**
 * Forgetting a password was the end of the road.
 *
 * Sign up is closed and accounts are only ever created against a job code, so
 * "make another one" is not a way back in: the code is spent, the job is
 * already attached to the address they cannot get into, and a second account
 * would not be able to see it. Without this page a client who forgot their
 * password lost their job, their evidence and their signed documents.
 *
 * Public on purpose. Somebody who cannot sign in cannot be behind the gate.
 */

const field =
  "mb-4 w-full rounded-xl border border-line bg-bg px-3.5 py-3 text-[15px] text-ink outline-none focus:border-teal";

export default function Forgot() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const supabase = createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/portal/reset`,
    });

    // Deliberately the same answer either way, including on failure. "No
    // account with that email" turns this box into a way of finding out which
    // of your clients uses Yaadly, and anybody can load this page.
    if (error) console.error("resetPasswordForEmail", error.message);
    setSent(true);
    setBusy(false);
  }

  if (sent) {
    return (
      <div className="mx-auto max-w-[420px]">
        <h1 className="font-display text-[32px] uppercase leading-none">
          Check your email
        </h1>
        <p className="mt-3 text-[14px] leading-relaxed text-mute">
          If <b>{email.trim()}</b> has a Yaadly account, a link to set a new
          password is on its way. It is good for one hour and can only be used
          once.
        </p>
        <p className="mt-3 text-[13.5px] leading-relaxed text-dim">
          Nothing about your jobs changes in the meantime, and nobody is
          notified. If the mail does not arrive, check the spam folder before
          asking us: it comes from yaadly.co.uk and it is the first one we have
          ever sent you.
        </p>
        <Link
          href="/portal/sign-in"
          className="mt-5 inline-flex rounded-full border border-line2 px-4 py-2 text-[12.5px] font-bold transition hover:border-teal hover:text-tealb"
        >
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[420px]">
      <h1 className="font-display text-[32px] uppercase leading-none">
        Forgotten password
      </h1>
      <p className="mt-3 text-[14px] leading-relaxed text-mute">
        Put in the email you use for Yaadly and we will send you a link to set
        a new password. Your jobs, your evidence and anything you have signed
        stay exactly where they are.
      </p>

      <form onSubmit={submit} className="mt-7">
        <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-[.13em] text-dim">
          Email
        </label>
        <input
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={field}
        />

        {error && (
          <p
            role="alert"
            className="mb-4 rounded-xl border border-coral/30 bg-coral/10 px-3.5 py-3 text-[13px] text-mute"
          >
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-full bg-linear-to-r from-teal to-mango py-3.5 text-[14.5px] font-bold text-onbrand transition hover:brightness-110 disabled:opacity-40"
        >
          {busy ? "Sending..." : "Send me a reset link"}
        </button>
      </form>

      <p className="mt-5 text-[12.5px] leading-relaxed text-dim">
        Remembered it?{" "}
        <Link href="/portal/sign-in" className="text-tealb underline">
          Sign in
        </Link>
        .
      </p>
    </div>
  );
}
