"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { isCodeComplete, normalizeCode, signInButtonLabel } from "@/lib/portal/sign-in";

const CODE_FN = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/yaad-portal-code`;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

/**
 * Sign in is a Client Component on purpose: the browser client is what holds
 * the session and refreshes the token. See lib/supabase/auth.ts for why this
 * stack cannot use the usual middleware refresh.
 *
 * ONE screen, both fields, on purpose (rebuilt 31 Aug 2026 from a two-step
 * ask-then-enter form). The founder's own words: sign in should work with
 * "the code or the email and their code", and the page should show "what is
 * essential and what is optional" rather than hide the code box behind a
 * click. Email is essential, it is who is signing in. The code is optional:
 * a returning visitor may already be holding one, sent minutes ago and good
 * for about an hour, and should be able to type it straight in rather than
 * being forced through a fresh send first. Leave it blank and the same
 * button sends one instead of trying to verify an empty box.
 *
 * There is no way to sign in on the code alone, with no email at all. A six
 * digit code is not unique across every account by itself, only paired with
 * the address it was sent to, so nothing here can tell whose code it is
 * without being told the address too. That is a real limit, not a
 * shortcut not taken: turning a bare code into a working identifier would
 * need its own design (a phone-only sign in, most likely) and is not one to
 * make quietly inside what was asked as a UI fix.
 */
export default function SignIn() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [arriving, setArriving] = useState(true);

  /* A code is the only way in, and there is no password anywhere on
     this page. Accounts opened since 31 Aug never chose one, so a password box
     was asking those people for something they do not have. The founder
     confirmed there are no live client accounts holding an old password, so
     nothing is being taken away from anybody. */
  const [otp, setOtp] = useState("");
  const [sent, setSent] = useState(false);

  // Arriving from a confirmation link.
  //
  // GoTrue returns that session in the URL FRAGMENT, and a fragment is never
  // sent to the server, so no amount of server-side gating can see it. It has
  // to be picked up here, in the browser, or the client stands on a page
  // holding a valid session it cannot use. That is exactly what happened: the
  // link landed on the site root with the tokens in the address bar and
  // nothing listening for them.
  //
  // Reading the fragment explicitly rather than relying on the client library
  // to detect it, because this is the one step of the whole journey where
  // silence looks identical to success.
  useEffect(() => {
    const supabase = createClient();
    (async () => {
      try {
        const raw = window.location.hash.replace(/^#/, "");
        const frag = new URLSearchParams(raw);

        // An expired or already-used link comes back here too, and saying so
        // is kinder than a sign in form that looks like it forgot them.
        const problem = frag.get("error_description") ?? frag.get("error");
        if (problem) {
          window.history.replaceState(null, "", window.location.pathname);
          setError(
            "That confirmation link has expired or has already been used. Sign in below, or ask Yaadly for a new one.",
          );
          setArriving(false);
          return;
        }

        const access_token = frag.get("access_token");
        const refresh_token = frag.get("refresh_token");
        if (access_token && refresh_token) {
          await supabase.auth.setSession({ access_token, refresh_token });
          // Do not leave a live session sitting in the address bar, where it
          // gets copied into a message or a bug report.
          window.history.replaceState(null, "", window.location.pathname);
        }

        // A recovery link used to be sent to /portal/reset so somebody could
        // choose a new password. There are no passwords now, so that page
        // could only ask for something nobody needs. The link still carries a
        // valid session, so the useful thing to do with it is the obvious
        // one: let them in.

        const { data } = await supabase.auth.getSession();
        if (data.session) {
          router.replace("/portal");
          router.refresh();
          return;
        }
      } catch {
        // Fall through to the form. A broken hand-off should still leave
        // somebody able to sign in the ordinary way.
      }
      setArriving(false);
    })();
  }, [router]);

  /* No job code is asked for here. This page is for people who already have
     an account, and yaad-portal-code only demands a job code when it is
     opening a NEW one. Asking a returning client for a code they were given
     months ago would lock them out of their own history. */
  async function sendCode() {
    try {
      const r = await fetch(CODE_FN, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: KEY, Authorization: `Bearer ${KEY}` },
        body: JSON.stringify({ email: email.trim(), role: "client" }),
      });
      const res = await r.json().catch(() => ({}));
      if (!r.ok || res.error) throw new Error(res.error || "That did not work.");
      if (!res.delivered) {
        throw new Error(
          "The code would not send, which is our end and not yours. Message Yaadly and we will get you in.",
        );
      }
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not work.");
    }
  }

  async function verifyCode(code: string) {
    const supabase = createClient();
    const { error: otpErr } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: code,
      type: "email",
    });
    if (otpErr) {
      // Clear the box rather than leave a wrong code sitting there: the
      // button below reverts to "Send me a sign in code" on its own,
      // instead of retrying the same wrong digits.
      setOtp("");
      setError("That code did not match, or it has expired. Press the button below to send a fresh one.");
      return;
    }
    router.replace("/portal");
    router.refresh();
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const code = normalizeCode(otp);
    if (isCodeComplete(otp)) {
      await verifyCode(code);
    } else {
      await sendCode();
    }
    setBusy(false);
  }

  // Somebody who has just confirmed is already signed in and about to be sent
  // on. Showing them a sign in form for the half second in between reads as
  // "it did not work" and is how people end up typing their password again.
  if (arriving) {
    return (
      <div className="mx-auto max-w-[420px]">
        <h1 className="font-display text-[32px] uppercase leading-none">
          Your portal
        </h1>
        <p role="status" className="mt-3 text-[14px] leading-relaxed text-mute">
          One moment, opening your portal.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[420px]">
      <h1 className="font-display text-[32px] uppercase leading-none">
        Your portal
      </h1>
      <p className="mt-3 text-[14px] leading-relaxed text-mute">
        Your jobs, your evidence, and the documents with your signature on
        them. Sign in here if you already have a Yaadly account, as a client
        or a tradesperson.
      </p>

      <form onSubmit={onSubmit} className="mt-7" aria-busy={busy}>
        {sent && (
          <p role="status" className="mb-5 rounded-xl border border-softline bg-soft px-3.5 py-3 text-[13px] leading-relaxed text-mute">
            Sent. Check your email, and your WhatsApp if we have your number.
            It lasts about an hour: type it in below.
          </p>
        )}

        <div className="mb-1.5 flex items-baseline justify-between">
          <label htmlFor="email" className="text-[11px] font-bold uppercase tracking-[.13em] text-dim">
            Email
          </label>
          <span className="text-[10px] font-bold uppercase tracking-[.1em] text-coral">
            Required
          </span>
        </div>
        <input
          id="email"
          type="email"
          autoComplete="username"
          autoFocus
          required
          disabled={busy}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mb-4 w-full rounded-xl border border-line bg-bg px-3.5 py-3 text-[15px] text-ink outline-none focus:border-teal disabled:opacity-60"
        />

        <div className="mb-1.5 flex items-baseline justify-between">
          <label htmlFor="otp" className="text-[11px] font-bold uppercase tracking-[.13em] text-dim">
            Your code
          </label>
          <span className="text-[10px] font-bold uppercase tracking-[.1em] text-dim">
            Optional
          </span>
        </div>
        <input
          id="otp"
          inputMode="numeric"
          autoComplete="one-time-code"
          aria-describedby="otp-hint"
          disabled={busy}
          value={otp}
          onChange={(e) => setOtp(e.target.value)}
          placeholder="Leave blank and we'll send you one"
          className="mb-4 w-full rounded-xl border border-line bg-bg px-3.5 py-3 font-mono text-[20px] tracking-[6px] text-ink outline-none focus:border-teal placeholder:font-sans placeholder:text-[13px] placeholder:tracking-normal placeholder:text-dim disabled:opacity-60"
        />
        <p id="otp-hint" className="-mt-2 mb-4 text-[12px] leading-relaxed text-dim">
          <b className="text-mute">No password.</b> Already got a code from a
          message we sent? Type it above and press the button. Otherwise
          leave it blank: we send one to your email, and your WhatsApp if we
          have your number.
        </p>

        {error && (
          <p role="alert" className="mb-4 rounded-xl border border-coral/30 bg-coral/10 px-3.5 py-3 text-[13px] text-mute">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-full bg-linear-to-r from-teal to-mango py-3.5 text-[14.5px] font-bold text-onbrand transition hover:brightness-110 disabled:opacity-40"
        >
          {signInButtonLabel(otp, busy)}
        </button>
      </form>

      <p className="mt-5 text-[12.5px] leading-relaxed text-dim">
        No account yet? Your job code comes to you on WhatsApp or by email, and
        it is what creates your portal.{" "}
        <Link href="/portal/join" className="text-tealb underline">
          Finish setting up your job
        </Link>
        . Nothing here is public.
      </p>

      <p className="mt-3 text-[12.5px] leading-relaxed text-dim">
        Stuck, or a code never arrives?{" "}
        <a
          href="https://wa.me/447878877567"
          target="_blank"
          rel="noopener"
          className="text-tealb underline"
        >
          Message us on WhatsApp
        </a>
        .
      </p>
    </div>
  );
}
