"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const CODE_FN = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/yaad-portal-code`;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

/**
 * Sign in is a Client Component on purpose: the browser client is what holds
 * the session and refreshes the token. See lib/supabase/auth.ts for why this
 * stack cannot use the usual middleware refresh.
 */
export default function SignIn() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [arriving, setArriving] = useState(true);

  /* A six digit code is the only way in, and there is no password anywhere on
     this page. Accounts opened since 31 Aug never chose one, so a password box
     was asking those people for something they do not have. The founder
     confirmed there are no live client accounts holding an old password, so
     nothing is being taken away from anybody. */
  const [otp, setOtp] = useState("");
  const [stage, setStage] = useState<"ask" | "enter">("ask");
  const [sentTo, setSentTo] = useState("");

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
      } catch (_) {
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
  async function askForCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
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
      setSentTo(email.trim());
      setStage("enter");
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = createClient();
    // type "email", measured on 30 Aug: a single POST /verify returning 200,
    // login_method "otp". See the note in portal/join for why the storage
    // slot says recovery and this still does not.
    const { error: otpErr } = await supabase.auth.verifyOtp({
      email: sentTo,
      token: otp.replace(/\D/g, ""),
      type: "email",
    });
    if (otpErr) {
      setError("That code did not match, or it has expired. Ask for a new one and try again.");
      setBusy(false);
      return;
    }
    router.replace("/portal");
    router.refresh();
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
        <p className="mt-3 text-[14px] leading-relaxed text-mute">
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
        them. Same sign in whether you are a client or a tradesperson.
      </p>

      {stage === "enter" ? (
        <form onSubmit={verifyCode} className="mt-7">
          <p className="mb-5 rounded-xl border border-softline bg-soft px-3.5 py-3 text-[13px] leading-relaxed text-mute">
            We sent a six digit code to <b className="text-ink">{sentTo}</b>, and
            to your WhatsApp number if we have one. It lasts about an hour.
          </p>

          <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-[.13em] text-dim">
            The six digit code
          </label>
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            value={otp}
            onChange={(e) => setOtp(e.target.value)}
            placeholder="123456"
            className="mb-4 w-full rounded-xl border border-line bg-bg px-3.5 py-3 font-mono text-[20px] tracking-[6px] text-ink outline-none focus:border-teal"
          />

          {error && (
            <p role="alert" className="mb-4 rounded-xl border border-coral/30 bg-coral/10 px-3.5 py-3 text-[13px] text-mute">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-full bg-linear-to-r from-teal to-mango py-3.5 text-[14.5px] font-bold text-[#04211D] transition hover:brightness-110 disabled:opacity-40"
          >
            {busy ? "Checking..." : "Open my portal"}
          </button>

          <button
            type="button"
            onClick={() => { setStage("ask"); setOtp(""); setError(null); }}
            className="mt-3 w-full text-[12.5px] text-dim underline"
          >
            Send it again, or use a different address
          </button>
        </form>
      ) : (
        <form onSubmit={askForCode} className="mt-7">
          <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-[.13em] text-dim">
            Email
          </label>
          <input
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mb-4 w-full rounded-xl border border-line bg-bg px-3.5 py-3 text-[15px] text-ink outline-none focus:border-teal"
          />
          <p className="-mt-2 mb-4 text-[12px] leading-relaxed text-dim">
            <b className="text-mute">No password.</b> We send a six digit code
            to your email, and to your WhatsApp number if we have one.
          </p>

          {error && (
            <p role="alert" className="mb-4 rounded-xl border border-coral/30 bg-coral/10 px-3.5 py-3 text-[13px] text-mute">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-full bg-linear-to-r from-teal to-mango py-3.5 text-[14.5px] font-bold text-[#04211D] transition hover:brightness-110 disabled:opacity-40"
          >
            {busy ? "Sending your code..." : "Send me a sign in code"}
          </button>
        </form>
      )}

      <p className="mt-5 text-[12.5px] leading-relaxed text-dim">
        No account yet? Your job code comes to you on WhatsApp or by email, and
        it is what creates your portal.{" "}
        <Link href="/portal/join" className="text-tealb underline">
          Finish setting up your job
        </Link>
        . Nothing here is public.
      </p>
    </div>
  );
}
