"use client";

import { useState } from "react";
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

  return (
    <div className="mx-auto max-w-[420px] px-5 py-16">
      <div className="mb-6 flex items-center gap-2.5">
        <span className="grid size-8 place-items-center rounded-[9px] bg-teal font-display text-[17px] text-[#04211D]">
          Y
        </span>
        <b className="text-[17px]">
          Yaadly<span className="text-mango">Hub</span>
        </b>
      </div>

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

      <p className="mt-5 text-[12.5px] leading-relaxed text-dim">
        No account yet? A portal is created for you when your job is set up,
        and the code comes to you on WhatsApp or by email. Nothing here is
        public.
      </p>
    </div>
  );
}
