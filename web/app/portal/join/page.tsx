"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

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
 * door, it is checked server side by yaad-portal-code with rate limiting on
 * pend_portal_code, and nothing here can talk its way past that.
 *
 * The email typed here is not checked against the job, it is attached to it.
 * A job that arrived on WhatsApp has a phone number and no email, so there was
 * nothing to check against and the door never opened for anyone who came that
 * way.
 *
 * NO PASSWORD, anywhere in here (31 Aug 2026). This audience is diaspora
 * clients, often older, often on a phone in another country, who have already
 * explained the whole job once. "Choose a password, at least 8 characters" is
 * where those people stop, and it bought nothing: the job code was always the
 * real gate and a password was a second secret to lose on top of it.
 *
 * A six digit code goes to the mailbox, and to WhatsApp when we have a number
 * for them. Typing it back proves the mailbox exactly as the old confirmation
 * link did, and it does it without stranding somebody who opens the link in a
 * different browser than the one they started in, which is the classic way
 * magic links fail. It also costs them a retry rather than their job when
 * they mistype their own address, which is the likeliest thing to go wrong.
 */

const CODE_FN = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/yaad-portal-code`;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

const field =
  "mb-4 w-full rounded-xl border border-line bg-bg px-3.5 py-3 text-[15px] text-ink outline-none focus:border-teal";
const label =
  "mb-1.5 block text-[11px] font-bold uppercase tracking-[.13em] text-dim";

function JoinForm() {
  const router = useRouter();
  const params = useSearchParams();

  // The link sent on WhatsApp carries both, so the only thing left to type is
  // an email. Read straight into the initial state rather than written in
  // after mount: an effect whose only job is to setState costs a second
  // render and leaves the field empty for one beat on a page whose whole
  // point is that it arrives filled in.
  const [code, setCode] = useState(() => (params.get("code") ?? "").toUpperCase());
  const [job] = useState(() => params.get("job") ?? "");

  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [stage, setStage] = useState<"ask" | "enter">("ask");
  const [sentTo, setSentTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* Step one. Ask for a code. No password is chosen here and none is asked
     for anywhere: the job code was always the real gate, and a password is a
     second secret to lose on top of it. */
  async function askForCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(CODE_FN, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: KEY, Authorization: `Bearer ${KEY}` },
        body: JSON.stringify({ email: email.trim(), code: code.trim(), role: "client" }),
      });
      const res = await r.json().catch(() => ({}));
      if (!r.ok || res.error) throw new Error(res.error || "That did not work.");

      // Never claim a code was sent when nothing went anywhere. Somebody
      // staring at an empty inbox because we said "check your email" is the
      // worst version of this page.
      if (!res.delivered) {
        throw new Error(
          "Your account is ready but the code would not send, which is our end and not yours. Message Yaadly and we will get you in.",
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

  /* Step two. The six digits. Verifying happens against Supabase directly,
     so the code never comes back through our own server: it went to their
     mailbox or their phone, and only they can have it. */
  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      const token = otp.replace(/\D/g, "");

      /* Two types tried, and this is a version difference rather than a
         guess. generateLink({type:"magiclink"}) files its one time token in
         GoTrue's recovery_token slot, confirmed by reading
         auth.one_time_tokens on this project, and which verifyOtp type
         matches that has moved between GoTrue releases. "email" is the
         documented one for a magic link OTP and is tried first; "magiclink"
         is the older name for the same thing. A wrong TYPE and a wrong CODE
         are indistinguishable to the caller otherwise, and telling somebody
         their correct code is wrong is the worst failure this page has. */
      let otpErr = (await supabase.auth.verifyOtp({ email: sentTo, token, type: "email" })).error;
      if (otpErr) {
        otpErr = (await supabase.auth.verifyOtp({ email: sentTo, token, type: "magiclink" })).error;
      }
      if (otpErr) {
        throw new Error(
          "That code did not match, or it has expired. Ask for a new one and try again.",
        );
      }

      // Signed in and confirmed in one step. Now bind the job.
      const { data: claimed } = await supabase.rpc("claim_code_as_me", { p_code: code.trim() });
      if (claimed !== true) {
        throw new Error(
          "You are signed in, but that job code would not attach to your account. Check it against the message Yaadly sent you, or message Yaadly.",
        );
      }

      /* Arriving here from a quote means the account WAS the booking step.
         Finish what they pressed rather than landing them in a portal and
         making them find the quote again. accept_quote_as_me still decides,
         and it still refuses anybody who is not this job's client. */
      const quote = params.get("quote");
      if (quote) {
        const { error: acceptErr } = await supabase.rpc("accept_quote_as_me", { p_quote: quote });
        if (acceptErr) {
          throw new Error(
            "Your account is ready and you are signed in, but the booking did not go through: " +
              acceptErr.message +
              " Open your quotes again and press book.",
          );
        }
      }

      router.replace("/portal");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not work.");
      setBusy(false);
    }
  }

  if (stage === "enter") {
    return (
      <form onSubmit={verify}>
        <p className="mb-5 rounded-xl border border-softline bg-soft px-3.5 py-3 text-[13px] leading-relaxed text-mute">
          We sent a six digit code to <b className="text-ink">{sentTo}</b>, and
          to your WhatsApp number if we have one. It lasts about an hour.
        </p>

        <label className={label}>The six digit code</label>
        <input
          inputMode="numeric"
          autoComplete="one-time-code"
          required
          value={otp}
          onChange={(e) => setOtp(e.target.value)}
          placeholder="123456"
          className={`${field} font-mono text-[20px] tracking-[6px]`}
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
    );
  }

  return (
    <form onSubmit={askForCode}>
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
      <p className="-mt-2 mb-4 text-[12px] text-dim">
        <b className="text-mute">No password to choose and none to remember.</b>{" "}
        We send you a six digit code instead, here and on WhatsApp if we have
        your number.
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
