"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * The far end of the reset link.
 *
 * A recovery link hands back a real session, in the URL fragment, exactly like
 * a confirmation link does. That has a sharp edge: arriving here signed in is
 * the normal case, not an error, and any page that redirects a signed-in
 * visitor away would bounce somebody straight past the password box they came
 * to use. Hence its own route rather than folding it into sign in.
 *
 * The fragment is read explicitly rather than left to the client library,
 * for the same reason as sign in: this is a step where silence looks exactly
 * like success.
 */

const field =
  "mb-4 w-full rounded-xl border border-line bg-bg px-3.5 py-3 text-[15px] text-ink outline-none focus:border-teal";
const label =
  "mb-1.5 block text-[11px] font-bold uppercase tracking-[.13em] text-dim";

export default function Reset() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [ok, setOk] = useState(false);
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    (async () => {
      try {
        const frag = new URLSearchParams(window.location.hash.replace(/^#/, ""));

        const problem = frag.get("error_description") ?? frag.get("error");
        if (problem) {
          window.history.replaceState(null, "", window.location.pathname);
          setError(
            "That reset link has expired or has already been used. Ask for a new one below.",
          );
          setReady(true);
          return;
        }

        const access_token = frag.get("access_token");
        const refresh_token = frag.get("refresh_token");
        if (access_token && refresh_token) {
          await supabase.auth.setSession({ access_token, refresh_token });
          // A live session in the address bar gets copied into messages.
          window.history.replaceState(null, "", window.location.pathname);
        }

        const { data } = await supabase.auth.getSession();
        setOk(Boolean(data.session));
        if (!data.session) {
          setError(
            "This page needs to be opened from the reset link in your email. Ask for a new one below.",
          );
        }
      } catch (_) {
        setError("Something went wrong reading that link. Ask for a new one below.");
      }
      setReady(true);
    })();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("Your password needs to be at least 8 characters.");
      return;
    }
    // Caught here rather than after the fact, because there is no "are you
    // sure" on a password you cannot see and will not be shown again.
    if (password !== again) {
      setError("Those two passwords are not the same.");
      return;
    }

    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setError(
        error.message.match(/same|different/i)
          ? "That is the password you already have. Choose a different one."
          : "Could not set that password. Ask for a new link and try again.",
      );
      setBusy(false);
      return;
    }

    setPassword("");
    setAgain("");
    router.replace("/portal");
    router.refresh();
  }

  if (!ready) {
    return (
      <div className="mx-auto max-w-[420px]">
        <h1 className="font-display text-[32px] uppercase leading-none">
          New password
        </h1>
        <p className="mt-3 text-[14px] leading-relaxed text-mute">
          One moment, checking your link.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[420px]">
      <h1 className="font-display text-[32px] uppercase leading-none">
        New password
      </h1>
      <p className="mt-3 text-[14px] leading-relaxed text-mute">
        {ok
          ? "Set it here and you are straight into your portal. Everything on your jobs is untouched."
          : "This link is not one we can use."}
      </p>

      {error && (
        <p
          role="alert"
          className="mt-5 rounded-xl border border-coral/30 bg-coral/10 px-3.5 py-3 text-[13px] text-mute"
        >
          {error}
        </p>
      )}

      {ok ? (
        <form onSubmit={submit} className="mt-7">
          <label className={label}>New password</label>
          <input
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={field}
          />

          <label className={label}>Type it again</label>
          <input
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={again}
            onChange={(e) => setAgain(e.target.value)}
            className={field}
          />
          <p className="-mt-2 mb-4 text-[12px] text-dim">
            At least 8 characters.
          </p>

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-full bg-linear-to-r from-teal to-mango py-3.5 text-[14.5px] font-bold text-[#04211D] transition hover:brightness-110 disabled:opacity-40"
          >
            {busy ? "Saving..." : "Set my password"}
          </button>
        </form>
      ) : (
        <Link
          href="/portal/forgot"
          className="mt-5 inline-flex rounded-full bg-linear-to-r from-teal to-mango px-5 py-2.5 text-[13px] font-bold text-[#04211D] transition hover:brightness-110"
        >
          Send me a new link
        </Link>
      )}
    </div>
  );
}
