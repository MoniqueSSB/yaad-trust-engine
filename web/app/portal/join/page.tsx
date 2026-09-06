"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { isCodeComplete, normalizeCode } from "@/lib/portal/sign-in";

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
 * TWO visual stages on one page, changed back from a single all-fields screen
 * on the founder's own instruction, 3 Sep 2026: three boxes at once (email,
 * job code, sign-in code) read as confusing rather than efficient, mainly
 * because most people arriving here already have their job code sitting in
 * the link they tapped and had no reason to expect a box asking them to
 * retype it. So: stage one asks for an email, nothing else, and sends the
 * code. Stage two, on the same URL, asks for that code and signs them in.
 * The 31 Aug rebuild this replaces solved a real problem too (a hidden code
 * box nobody could find), and the fix for that is kept: the code box is
 * never hidden behind a stage the person does not know exists, because stage
 * two only ever appears after we have told them, out loud, that something
 * was sent and where to type it.
 *
 * The job code itself is normally invisible now. It arrives pre-filled from
 * the WhatsApp link (yaad-inbound and yaad-notify-client both build
 * /portal/join links with ?code=...), so a returning-to-finish visitor never
 * types it by hand. It only surfaces as a field, on stage one, next to email,
 * when that link's code param is empty: yaad-inbound's own comment says that
 * can happen if a job reaches "done" before its portal_code is set. Hiding
 * the field unconditionally would strand that person with a link that leads
 * nowhere, which is worse than the box being confusing.
 */

const CODE_FN = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/yaad-portal-code`;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

const field =
  "mb-4 w-full rounded-xl border border-line bg-bg px-3.5 py-3 text-[15px] text-ink outline-none focus:border-teal";
const label =
  "mb-1.5 block text-[11px] font-bold uppercase tracking-[.13em] text-dim";
const labelRow = "mb-1.5 flex items-baseline justify-between";
const required = "text-[10px] font-bold uppercase tracking-[.1em] text-coral";

type Stage = "email" | "code" | "link";

/* Takes the sign-in token out of a query string and leaves everything else
   exactly as it was. Everything else matters: `code`, `job`, `quote`, `want`
   and `next` all still steer where this page sends somebody, and a blunter
   "clear the whole query string" would strand a one-tap arrival that came
   from a quote button. */
function stripToken(search: string): string {
  const q = new URLSearchParams(search);
  q.delete("t");
  const rest = q.toString();
  return rest ? `?${rest}` : "";
}

function JoinForm() {
  const router = useRouter();
  const params = useSearchParams();

  // The link sent on WhatsApp usually carries this already. Read straight
  // into the initial state rather than written in after mount: an effect
  // whose only job is to setState costs a second render and leaves the field
  // empty for one beat on a page whose whole point is that it arrives filled
  // in.
  const [jobCode, setJobCode] = useState(() => (params.get("code") ?? "").toUpperCase());
  const [job] = useState(() => params.get("job") ?? "");

  // Whether the job code came in on the link, or still needs to be typed by
  // hand. See the file comment: this is the fallback for the one case where
  // the link's own code param can be empty.
  const jobCodeKnown = jobCode.trim().length > 0;

  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");

  /* ONE TAP, founder's decision 5 Sep 2026, on reading her own booking email:
     "why does it email when I was already sent the key".

     She was right. The booking email goes to a mailbox, and then the join
     page emailed the SAME mailbox a second time to prove it was hers. In the
     ordinary case, somebody tapping the link from the inbox it landed in, the
     second email proved nothing the first had not.

     So the booking email now carries a single-use sign-in token of its own
     (minted by yaad-notify-client, see its oneTapJoinLink) and this page
     spends it on arrival. One email, one tap, no code box.

     THE TRADE, stated plainly because it is a real one and it was hers to
     make: while that token is unspent, the booking email IS the login.
     Forward it and the person you forwarded it to is you. Before this, a
     forwarded email handed over the job key but never the account. What
     limits the damage is that the token is single use and short lived, and
     that it is off the address bar before anything else on this page runs. */
  const [token] = useState(() => params.get("t") ?? "");
  const spent = useRef(false);
  const [signedIn, setSignedIn] = useState(false);

  /* The one thing driving which fields show. "email" asks for an address
     (and the job code too, only when it did not arrive on the link) and
     sends the sign-in code. "code" asks for that code and signs them in.
     Moving to "code" only ever happens after sendCode has confirmed
     something was actually delivered, never before: a hidden stage nobody
     asked to be in is the exact bug the 31 Aug version fixed, and moving the
     stage boundary must not bring that back.

     "link" is the one-tap arrival (5 Sep 2026): the booking email carried a
     single-use token, so there is nothing to type and nothing to ask for. It
     is chosen at first render rather than switched to, so a tapped link never
     flashes a form the person is not going to fill in. */
  const [stage, setStage] = useState<Stage>(() => (params.get("t") ? "link" : "email"));
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
        body: JSON.stringify({ email: email.trim(), code: jobCode.trim(), role: "client" }),
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
      setStage("code");
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

      await finishSignIn(supabase);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not work.");
    }
  }

  /* Everything after the mailbox is proved: bind the job to the account and
     land them where they were going.

     Lifted out of verifyCode on 5 Sep 2026, when the booking email started
     carrying a one-tap link. There are now TWO ways to prove a mailbox, a
     typed code and a tapped link, and they have to end identically. A second
     copy of this would drift, and the half that drifts is the half that binds
     the job to the account, which is the half nobody notices until a client
     is signed in and staring at an empty portal. */
  async function finishSignIn(supabase: ReturnType<typeof createClient>) {
    // Signed in and confirmed in one step. Now bind the job.
    const { data: claimed } = await supabase.rpc("claim_code_as_me", { p_code: jobCode.trim() });
    if (claimed !== true) {
      throw new Error(
        "You are signed in, but that job code would not attach to your account. Check it against the message Yaadly sent you, or message Yaadly.",
      );
    }

    /* Arriving here from a quote means the account WAS the step that
       pressing that button needed. Finish what they pressed rather than
       landing them in a portal and making them find the quote again.
       Postgres still decides in both cases, and still refuses anybody who
       is not this job's client. Neither books anyone.

       `want` says WHICH button it was. It arrived on 4 Sep 2026, when the
       Kickoff Pack came out of the default flow: before that there was one
       button and this could assume it. Anything other than "pack" confirms
       the price, which is the ordinary route, so an old link with no `want`
       on it still does the safe, smaller thing rather than silently
       ordering a project pack nobody asked for. */
    const quote = params.get("quote");
    if (quote) {
      const wantsPack = params.get("want") === "pack";
      const { error: requestErr } = wantsPack
        ? await supabase.rpc("request_kickoff_as_me", { p_quote: quote })
        : await supabase.rpc("agree_quote_as_me", { p_quote: quote });
      if (requestErr) {
        throw new Error(
          "Your account is ready and you are signed in, but the request did not go through: " +
            requestErr.message +
            " Open your quotes again and press the button.",
        );
      }
    }

    /* next=photos comes off the confirmation screen of /jobs/new, which
       has just told somebody that photographs are the single thing that
       turns a guess into a quote. Landing them in the portal and making
       them find the job, find the board preview and press "Add a photo"
       is three steps of hunting for the thing they came here to do. Only
       this one value is honoured, and only alongside a job: everything
       else, WhatsApp arrivals included, still lands on /portal exactly as
       before. */
    const next = params.get("next");
    if (next === "photos" && job) {
      router.replace(`/portal/jobs/${encodeURIComponent(job)}?photos=1`);
      router.refresh();
      return;
    }

    router.replace("/portal");
    router.refresh();
  }

  /* Sits here, below finishSignIn and below every piece of state it touches,
     because the lint rule that catches "used before declared" is right: an
     effect reaching upward for a setter is how you end up holding a stale
     one. */
  useEffect(() => {
    if (!token || spent.current) return;
    // Guarded, not because React is being awkward, but because a single-use
    // token really is spent by the first call. A development double-render
    // would otherwise show every tester an "expired link" screen on a link
    // that worked perfectly.
    spent.current = true;

    /* Off the address bar before anything else. An unspent sign-in token in
       a query string is a live credential: it goes into browser history, it
       is what a Referer header hands to the next site, and it is what gets
       pasted into a chat window by somebody asking for help. Verifying it
       does not need it to stay visible. */
    window.history.replaceState(null, "", window.location.pathname + stripToken(window.location.search));

    (async () => {
      setBusy(true);
      try {
        const supabase = createClient();

        /* Both types tried, in this order, and the order is not arbitrary.
           The file already records that this project's tokens verify as
           "email" (founder's own sign-in, 30 Aug 2026, one call, no retry).
           "magiclink" is the type these are MINTED as, and GoTrue returns
           the identical "expired or invalid" for a type mismatch as for a
           wrong token, so a failure here cannot tell us which it was. A
           failed verify does not consume the token, so trying the second
           costs nothing and removes a whole class of silent lockout. */
        let ok = false;
        for (const type of ["email", "magiclink"] as const) {
          const { error: e } = await supabase.auth.verifyOtp({ token_hash: token, type });
          if (!e) { ok = true; break; }
        }

        if (!ok) {
          // Expired, already used, or simply old. Not a dead end: the typed
          // code still works and is one button away, so say what happened
          // and put them in front of it.
          setStage("email");
          setError(
            "That link has expired, or it has already been used. Type your email below and we will send you a fresh sign-in code.",
          );
          return;
        }

        setSignedIn(true);
        await finishSignIn(supabase);
      } catch (err) {
        setError(err instanceof Error ? err.message : "That did not work.");
      } finally {
        setBusy(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (stage === "code") {
      if (!isCodeComplete(otp)) {
        setError("Type the full code we sent you, then press the button.");
        return;
      }
      setBusy(true);
      await verifyCode(normalizeCode(otp));
      setBusy(false);
      return;
    }

    setBusy(true);
    await sendCode();
    setBusy(false);
  }

  return (
    <form onSubmit={onSubmit} aria-busy={busy}>
      {job && (
        <p className="mb-5 rounded-xl border border-softline bg-soft px-3.5 py-3 text-[13px] leading-relaxed text-mute">
          Finishing <b className="font-mono text-tealb">{job}</b>, the job you
          described on WhatsApp. Everything you told us is already saved. This
          is only the account it belongs to.
        </p>
      )}

      {stage === "link" ? (
        /* Nothing to fill in. Either it is working, or it failed and the
           person needs to know which, in a sentence that says what to do
           next rather than what went wrong. */
        error ? (
          <>
            <p role="alert" className="mb-4 rounded-xl border border-coral/30 bg-coral/10 px-3.5 py-3 text-[13px] leading-relaxed text-mute">
              {error}
            </p>
            {signedIn && (
              <Link
                href="/portal"
                className="block w-full rounded-full bg-linear-to-r from-teal to-mango py-3.5 text-center text-[14.5px] font-bold text-onbrand transition hover:brightness-110"
              >
                Open your portal
              </Link>
            )}
          </>
        ) : (
          <p role="status" className="rounded-xl border border-softline bg-soft px-3.5 py-3 text-[13px] leading-relaxed text-mute">
            Signing you in from your booking email. One moment.
          </p>
        )
      ) : stage === "email" ? (
        <>
          {/* Said out loud because the alternative is what happened on
              5 Sep 2026: the booking email named the reference as "the
              code", the page then offered to send "a code", and the two
              read as the same thing, so being asked for an email looked
              like being asked to request something already in hand. The
              page HAS the reference, out of ?code=, which is exactly why
              there is no box for it. Silence about that is what made it
              look broken. Only shown when it really did arrive on the
              link: when it did not, the field below asks for it and this
              sentence would be a lie. */}
          {jobCodeKnown && (
            <p className="mb-5 rounded-xl border border-softline bg-soft px-3.5 py-3 text-[13px] leading-relaxed text-mute">
              Your booking reference is already in this link. The only thing
              we need from you is an email.
            </p>
          )}

          <div className={labelRow}>
            <label htmlFor="join-email" className={label}>Email</label>
            <span className={required}>Required</span>
          </div>
          <input
            id="join-email"
            type="email"
            autoComplete="username"
            autoFocus
            required
            disabled={busy}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={`${field} disabled:opacity-60`}
          />
          <p className="-mt-2 mb-4 text-[12px] text-dim">
            <b className="text-mute">No password to choose and none to remember.</b>{" "}
            Type your email and we will send you a one-time sign-in code, here
            and on WhatsApp if we have your number.
          </p>

          {!jobCodeKnown && (
            <>
              <div className={labelRow}>
                <label htmlFor="join-job-code" className={label}>Job code</label>
                <span className={required}>Required</span>
              </div>
              <input
                id="join-job-code"
                required
                disabled={busy}
                value={jobCode}
                onChange={(e) => setJobCode(e.target.value.toUpperCase())}
                placeholder="On the message we sent you"
                className={`${field} font-mono tracking-[2px] disabled:opacity-60`}
              />
              <p className="-mt-2 mb-4 text-[12px] text-dim">
                Not on the link you tapped? Check the message Yaadly sent you
                on WhatsApp or by email.
              </p>
            </>
          )}

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
            {busy ? "Sending your code..." : "Email me a sign-in code"}
          </button>
        </>
      ) : (
        <>
          <p role="status" className="mb-5 rounded-xl border border-softline bg-soft px-3.5 py-3 text-[13px] leading-relaxed text-mute">
            Sent to <b className="text-mute">{email.trim()}</b>, and your
            WhatsApp if we have your number. It lasts about an hour: type it
            in below.
          </p>

          <div className={labelRow}>
            <label htmlFor="join-otp" className={label}>The sign-in code we sent you</label>
            <span className={required}>Required</span>
          </div>
          <input
            id="join-otp"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            required
            disabled={busy}
            value={otp}
            onChange={(e) => setOtp(e.target.value)}
            placeholder="Type the code here"
            className={`${field} font-mono text-[20px] tracking-[6px] placeholder:font-sans placeholder:text-[13px] placeholder:tracking-normal placeholder:text-dim disabled:opacity-60`}
          />

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
            {busy ? "Signing in..." : "Sign in"}
          </button>

          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setStage("email");
              setOtp("");
              setError(null);
            }}
            className="mt-3 w-full text-center text-[12.5px] text-dim underline disabled:opacity-40"
          >
            Wrong email, or no code arrived? Go back
          </button>
        </>
      )}
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
