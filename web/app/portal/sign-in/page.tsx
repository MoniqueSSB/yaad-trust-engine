"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Sign in is a Client Component on purpose: the browser client is what holds
 * the session and refreshes the token. See lib/supabase/auth.ts for why this
 * stack cannot use the usual middleware refresh.
 */
export default function SignIn() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [arriving, setArriving] = useState(true);

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

        // A recovery link also arrives as a valid session, so without this it
        // would be treated as an ordinary arrival and the person would be sent
        // into the portal, sailing straight past the password box they came
        // here to use. They land here only when the reset mail falls back to
        // Site URL, but that is exactly when they most need it to work.
        if (frag.get("type") === "recovery") {
          router.replace("/portal/reset");
          return;
        }

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

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (error) {
      // Deliberately not "no account with that email". That tells a stranger
      // which addresses are real.
      setError("That email and password did not match. Try again.");
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
          className="mb-4 w-full rounded-xl border border-line bg-bg px-3.5 py-3 text-[15px] text-ink outline-none focus:border-teal"
        />

        <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-[.13em] text-dim">
          Password
        </label>
        <input
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mb-4 w-full rounded-xl border border-line bg-bg px-3.5 py-3 text-[15px] text-ink outline-none focus:border-teal"
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
          className="w-full rounded-full bg-linear-to-r from-teal to-mango py-3.5 text-[14.5px] font-bold text-[#04211D] transition hover:brightness-110 disabled:opacity-40"
        >
          {busy ? "Signing in..." : "Sign in"}
        </button>
      </form>

      <p className="mt-4 text-[12.5px] leading-relaxed text-dim">
        <Link href="/portal/forgot" className="text-tealb underline">
          Forgotten your password?
        </Link>
      </p>

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
