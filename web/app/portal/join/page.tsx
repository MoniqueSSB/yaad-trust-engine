"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { isCodeComplete, normalizeCode, signInButtonLabel } from "@/lib/portal/sign-in";

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
 * ONE screen, all three fields, on purpose (rebuilt 31 Aug 2026 from a
 * two-step ask-then-enter form, same rebuild sign-in already had, missed on
 * this page the first time and found live: a person on this exact page said
 * there was "no button" to sign in, only a way to ask for a code, because the
 * code box was hidden until a first submit). Email and job code are both
 * required, always, this page only exists to open a NEW account. The code
 * itself is optional: type one straight in if you already have it from a
 * message sent minutes ago, or leave it blank and the same button sends one.
 */

const CODE_FN = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/yaad-portal-code`;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

const field =
  "mb-4 w-full rounded-xl border border-line bg-bg px-3.5 py-3 text-[15px] text-ink outline-none focus:border-teal";
const label =
  "mb-1.5 block text-[11px] font-bold uppercase tracking-[.13em] text-dim";
const labelRow = "mb-1.5 flex items-baseline justify-between";
const required = "text-[10px] font-bold uppercase tracking-[.1em] text-coral";
const optional = "text-[10px] font-bold uppercase tracking-[.1em] text-dim";

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
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* No password is chosen here and none is asked for anywhere: the job code
     was always the real gate, and a password is a second secret to lose on
     top of it. */
  async function sendCode() {
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
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not work.");
    }
  }

  /* The code itself. Verifying happens against Supabase directly, so it
     never comes back through our own server: it went to their mailbox or
     their phone, and only they can have it. */
  async function verifyCode(otpDigits: string) {
    try {
      const supabase = createClient();

      /* type "email", and this is settled rather than assumed. The founder
         signed in through this page on 30 Aug 2026 and the auth log records
         a single POST /verify returning 200, login_method "otp", provider
         "email". One call, first type, no retry.

         Worth writing down because the storage says otherwise and would send
         the next person down the wrong path: generateLink files the token in
         GoTrue's recovery_token slot and logs the event as
         "user_recovery_requested". It verifies as "email" all the same. And
         GoTrue returns the identical "Token has expired or is invalid" for
         every type when the token does not match, checked against all four,
         so a wrong type is indistinguishable from a wrong code and this
         cannot be rediscovered by probing. */
      const { error: otpErr } = await supabase.auth.verifyOtp({
        email: email.trim(),
        token: otpDigits,
        type: "email",
      });
      if (otpErr) {
        setOtp("");
        throw new Error(
          "That code did not match, or it has expired. Press the button below to send a fresh one.",
        );
      }

      // Signed in and confirmed in one step. Now bind the job.
      const { data: claimed } = await supabase.rpc("claim_code_as_me", { p_code: code.trim() });
      if (claimed !== true) {
        throw new Error(
          "You are signed in, but that job code would not attach to your account. Check it against the message Yaadly sent you, or message Yaadly.",
        );
      }

      /* Arriving here from a quote means the account WAS the step that
         requesting a Kickoff Pack needed. Finish what they pressed rather
         than landing them in a portal and making them find the quote
         again. request_kickoff_as_me still decides, and it still refuses
         anybody who is not this job's client. This does not book anyone;
         it asks the worker to write a Kickoff Pack against their price. */
      const quote = params.get("quote");
      if (quote) {
        const { error: requestErr } = await supabase.rpc("request_kickoff_as_me", { p_quote: quote });
        if (requestErr) {
          throw new Error(
            "Your account is ready and you are signed in, but the request did not go through: " +
              requestErr.message +
              " Open your quotes again and press the button.",
          );
        }
      }

      router.replace("/portal");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not work.");
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const digits = normalizeCode(otp);
    if (isCodeComplete(otp)) {
      await verifyCode(digits);
    } else {
      await sendCode();
    }
    setBusy(false);
  }

  return (
    <form onSubmit={onSubmit}>
      {job && (
        <p className="mb-5 rounded-xl border border-softline bg-soft px-3.5 py-3 text-[13px] leading-relaxed text-mute">
          Finishing <b className="font-mono text-tealb">{job}</b>, the job you
          described on WhatsApp. Everything you told us is already saved. This
          is only the account it belongs to.
        </p>
      )}

      {sent && (
        <p className="mb-5 rounded-xl border border-softline bg-soft px-3.5 py-3 text-[13px] leading-relaxed text-mute">
          Sent. Check your email, and your WhatsApp if we have your number.
          It lasts about an hour: type it in below.
        </p>
      )}

      <div className={labelRow}>
        <label className={label}>Email</label>
        <span className={required}>Required</span>
      </div>
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
        We send you a code instead, here and on WhatsApp if we have your
        number.
      </p>

      <div className={labelRow}>
        <label className={label}>Job code</label>
        <span className={required}>Required</span>
      </div>
      <input
        required
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
        placeholder="On the message we sent you"
        className={`${field} font-mono tracking-[2px]`}
      />

      <div className={labelRow}>
        <label className={label}>Your code</label>
        <span className={optional}>Optional</span>
      </div>
      <input
        inputMode="numeric"
        autoComplete="one-time-code"
        value={otp}
        onChange={(e) => setOtp(e.target.value)}
        placeholder="Leave blank and we'll send you one"
        className={`${field} font-mono text-[20px] tracking-[6px] placeholder:font-sans placeholder:text-[13px] placeholder:tracking-normal placeholder:text-dim`}
      />
      <p className="-mt-2 mb-4 text-[12px] text-dim">
        Already got a code from a message we sent? Type it above and press
        the button.
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
