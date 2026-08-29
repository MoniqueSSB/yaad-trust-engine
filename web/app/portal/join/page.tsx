"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

/**
 * Where a WhatsApp conversation turns into a live job.
 *
 * This page was missing, and its absence was the hole in the whole journey.
 * Sign in already told people "the code comes to you on WhatsApp or by email"
 * and then gave them nowhere to use it. Somebody could describe their job
 * perfectly on WhatsApp, get a reference and a code, arrive at the site, and
 * find only a sign in form for an account that does not exist yet.
 *
 * It matters more than it looks. `jobs.open` is guarded in Postgres by
 * enforce_signed_before_open, which needs BOTH a signed set of Client
 * Guidelines AND a row in client_profiles. No account means no profile means
 * the job never reaches a worker, however good the description was.
 *
 * Public sign-up is switched off in Auth on purpose. The job code is the only
 * door, it is checked server side by yaad-portal-signup with rate limiting on
 * pend_portal_code, and nothing here can talk its way past that.
 *
 * The email typed here is not checked against the job, it is attached to it.
 * A job that arrived on WhatsApp has a phone number and no email, so there was
 * nothing to check against and the door never opened for anyone who came that
 * way.
 *
 * The attaching happens when the confirmation link is clicked, not when this
 * form is submitted. Somebody typing their own address wrong on a phone is the
 * likeliest thing that goes wrong here, and this way it costs them a retry
 * rather than their job.
 */

const SIGNUP = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/yaad-portal-signup`;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

const field =
  "mb-4 w-full rounded-xl border border-line bg-bg px-3.5 py-3 text-[15px] text-ink outline-none focus:border-teal";
const label =
  "mb-1.5 block text-[11px] font-bold uppercase tracking-[.13em] text-dim";

function JoinForm() {
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [job, setJob] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  // The link sent on WhatsApp carries both, so the only thing left to type is
  // an email and a password. Somebody on a phone, in another country, having
  // already explained the whole job once, should not be copying a six
  // character code across from another app.
  useEffect(() => {
    setCode((params.get("code") ?? "").toUpperCase());
    setJob(params.get("job") ?? "");
  }, [params]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    if (password.length < 8) {
      setError("Your password needs to be at least 8 characters.");
      setBusy(false);
      return;
    }

    try {
      const r = await fetch(SIGNUP, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: KEY,
          Authorization: `Bearer ${KEY}`,
        },
        body: JSON.stringify({
          email: email.trim(),
          password,
          code: code.trim(),
          role: "client",
        }),
      });
      const res = await r.json().catch(() => ({}));
      if (!r.ok || res.error) throw new Error(res.error || "That did not work.");

      // The account is created unconfirmed, deliberately. Possession of an
      // email address is not proof you can read that mailbox, and until they
      // click the link nothing about this job goes anywhere.
      setPassword("");
      setDone(
        res.message ||
          `Check ${email.trim()} for a confirmation link, then sign in.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-2xl border border-line bg-panel p-6">
        <h2 className="font-display text-[22px] uppercase leading-none">
          One more step
        </h2>
        <p className="mt-3 text-[14px] leading-relaxed text-mute">{done}</p>
        <p className="mt-3 text-[13.5px] leading-relaxed text-mute">
          The Client Guidelines are waiting inside. Signing them is what opens
          your job to vetted workers, and nothing reaches anyone before that.
        </p>
        <Link
          href="/portal/sign-in"
          className="mt-5 inline-flex rounded-full border border-line2 px-4 py-2 text-[12.5px] font-bold transition hover:border-teal hover:text-tealb"
        >
          Go to sign in
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit}>
      {job && (
        <p className="mb-5 rounded-xl border border-softline bg-soft px-3.5 py-3 text-[13px] leading-relaxed text-mute">
          Finishing <b className="font-mono text-tealb">{job}</b>, the job you
          described on WhatsApp. Everything you told us is already saved. This
          is only the account it belongs to.
        </p>
      )}

      <label className={label}>Email</label>
      <input
        type="email"
        autoComplete="username"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className={field}
      />

      <label className={label}>Choose a password</label>
      <input
        type="password"
        autoComplete="new-password"
        required
        minLength={8}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className={field}
      />
      <p className="-mt-2 mb-4 text-[12px] text-dim">
        At least 8 characters. This is what gets you back into your portal.
      </p>

      <label className={label}>Job code</label>
      <input
        required
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
        placeholder="On the message we sent you"
        className={`${field} font-mono tracking-[2px]`}
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
        {busy ? "Checking your code..." : "Create my portal"}
      </button>
    </form>
  );
}

export default function Join() {
  return (
    <div className="mx-auto max-w-[420px]">
      <h1 className="font-display text-[32px] uppercase leading-none">
        Finish your job
      </h1>
      <p className="mt-3 text-[14px] leading-relaxed text-mute">
        Your job is written up and waiting. This creates the portal it lives
        in, where you sign the Client Guidelines, see every quote, and approve
        each stage before any money moves.
      </p>

      <div className="mt-7">
        <Suspense
          fallback={<p className="text-[13px] text-dim">Loading...</p>}
        >
          <JoinForm />
        </Suspense>
      </div>

      <p className="mt-5 text-[12.5px] leading-relaxed text-dim">
        Been here before?{" "}
        <Link href="/portal/sign-in" className="text-tealb underline">
          Sign in instead
        </Link>
        . Sign-up is not open to the public; the job code is the only door.
      </p>
    </div>
  );
}
