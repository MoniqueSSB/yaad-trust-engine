"use client";

/* ── Post a job ────────────────────────────────────────────────────────────
 *
 * The client funnel. It lives here because the app is the only place a job is
 * created now: the duplicate funnel inside docs/index.html was deleted, and
 * for a short while after that there was nowhere to post a job at all.
 *
 * THREE THINGS THIS KEEPS, deliberately, because the old funnel got them right
 * and a rewrite is the easiest place to lose them.
 *
 *   1. The job saves as a DRAFT before anything personal is asked. Somebody who
 *      closes the tab on screen two has a job on file, not an empty form.
 *   2. The phone field says the contact details are hidden from workers until
 *      the client starts a chat. That sentence is the reason people type a real
 *      number instead of a fake one.
 *   3. The reply promise is stated and it is one working day.
 *
 * NO ACCOUNT HERE. Founder decision, 30 Aug 2026: no account to get quotes, an
 * account once a job is booked. So there is no password on this page and no
 * sign-up. The account is created at booking, where it pays for itself:
 * approving evidence, holding the invoice, carrying the property record.
 *
 * The work goes to yaad-post-job in draft mode, which stores no personal data
 * at all. The contact details go separately to yaad-enquiry, which is the
 * hardened path: per-recipient throttle, receipt tracking, and a real answer
 * when somebody gave a phone number rather than an email. Neither is a new
 * table and neither needed changing.
 */

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { TRADES, PARISHES } from "@/lib/taxonomy";

const POST_JOB_FN = "yaad-post-job";
const ENQUIRY_FN = "yaad-enquiry";

const looksLikeEmail = (v: string) => /^[^\s@]+@[^\s@.]+\.[^\s@]{2,}$/.test(v.trim());
const looksLikePhone = (v: string) => v.replace(/\D/g, "").length >= 7;

type Step = 0 | 1 | 2;

export function PostJob({ initialTrade, requestedWorker }: { initialTrade?: string; requestedWorker?: string }) {
  const [step, setStep] = useState<Step>(0);

  const [trade, setTrade] = useState(initialTrade && (TRADES as readonly string[]).includes(initialTrade) ? initialTrade : "");
  const [parish, setParish] = useState("");
  const [desc, setDesc] = useState("");

  const [name, setName] = useState("");
  const [contact, setContact] = useState("");

  const [jobId, setJobId] = useState("");
  const [portalCode, setPortalCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  const workReady = trade !== "" && parish !== "" && desc.trim().length > 10;
  const contactOk = looksLikeEmail(contact) || looksLikePhone(contact);
  const reachReady = name.trim().length > 1 && contactOk;

  async function call(fn: string, body: Record<string, unknown>) {
    const sb = createClient();
    const { data, error: err } = await sb.functions.invoke(fn, { body });
    if (err) {
      let msg = "Something went wrong. Nothing is lost on your side.";
      try {
        const ctx = (err as { context?: Response }).context;
        const j = ctx ? await ctx.json() : null;
        if (j?.error) msg = String(j.error);
      } catch { /* keep the generic message */ }
      throw new Error(msg);
    }
    const d = (data ?? {}) as Record<string, unknown>;
    if (d.error) throw new Error(String(d.error));
    return d;
  }

  /* The draft is written on leaving screen one, before a name is asked for.
     The same jobId is sent again on later saves, so this never makes a second
     job for the same person going back and forward. */
  async function saveDraft() {
    setError("");
    setBusy(true);
    try {
      const d = await call(POST_JOB_FN, {
        mode: "draft",
        jobId: jobId || undefined,
        workType: trade,
        parish,
        desc: desc.trim(),
      });
      if (d.jobId) setJobId(String(d.jobId));
      if (d.portalCode) setPortalCode(String(d.portalCode));
      setStep(1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save your job.");
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    setError("");
    setBusy(true);
    try {
      const joinLink = jobId && portalCode
        ? `https://app.yaadly.co.uk/portal/join?job=${encodeURIComponent(jobId)}&code=${encodeURIComponent(portalCode)}`
        : "";
      await call(ENQUIRY_FN, {
        name: name.trim(),
        contact: contact.trim(),
        topic: "Property in Jamaica that needs work doing",
        message:
          `Job posted from the site, no account.\n\n` +
          `Reference: ${jobId || "draft not saved"}\n` +
          (requestedWorker ? `Client asked for: ${requestedWorker}\n` : "") +
          `Trade: ${trade}\nParish: ${parish}\n\n${desc.trim()}` +
          (joinLink ? `\n\nSet up your portal: ${joinLink}\nJob code, if asked: ${portalCode}` : ""),
      });
      setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not send.");
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <>
        <p className="text-[10.5px] font-bold uppercase tracking-[.2em] text-mango">Job received</p>
        <h1 className="mt-2 font-display text-[clamp(28px,5vw,52px)] uppercase leading-[.95]">
          A person is reading it.
          {jobId && (
            <>
              <br />
              <span className="bg-gradient-to-r from-mango to-coral bg-clip-text text-transparent">
                Your reference is {jobId}.
              </span>
            </>
          )}
        </h1>
        {/* This used to be the end of the road: the wizard told the client
            "job received" and then had no way to reach them again except a
            person reading a free text enquiry and copying a reference number
            by eye. The portal link and code were always generated, at draft
            time, and never shown. WhatsApp already hands a client this exact
            link the moment they ask about a job in this state; the wizard is
            the same product and should not be a worse route to the same
            door. */}
        {jobId && portalCode && (
          <div className="mt-6 max-w-[62ch] rounded-2xl border border-teal/40 bg-teal/5 p-6 text-[14.5px] leading-relaxed text-mute">
            <b className="text-ink">One more thing, thirty seconds: set up your portal.</b>
            <p className="mt-2">
              This is what lets quotes, evidence and approvals reach you.
              We would send you this same link by message either way, but
              there is no reason to wait for it.
            </p>
            <Link
              href={`/portal/join?job=${encodeURIComponent(jobId)}&code=${encodeURIComponent(portalCode)}`}
              className="mt-4 inline-block rounded-full bg-linear-to-r from-teal to-mango px-5 py-2.5 text-[13px] font-bold text-onbrand transition hover:brightness-110"
            >
              Finish setting up your portal
            </Link>
            <p className="mt-3 text-[12.5px]">
              Your job code, if you are asked for it: <span className="font-mono text-ink">{portalCode}</span>
            </p>
            {/* The photo route, named at the one moment it is useful. Before
                2 Sep 2026 the only way a picture could reach us was WhatsApp,
                and this screen said so, which made a client who does not use
                WhatsApp a client we never got photographs from. */}
            <p className="mt-3 text-[12.5px]">
              It is also where you send photographs of the job, straight from
              your phone. They are private to you, us and the worker booked on
              the job.
            </p>
          </div>
        )}
        {/* Not "your job is saved". That says nothing about what happens to
            somebody who has just described a problem with their mother's roof
            and wants to know when a human will look at it. */}
        <div className="mt-6 max-w-[62ch] rounded-2xl border border-softline bg-soft p-6 text-[14.5px] leading-relaxed text-mute">
          <b className="text-ink">What happens next, in order.</b>
          <p className="mt-3">
            <b className="text-ink">Monique reads this herself and comes back
            within one working day.</b> Not a queue and not an auto reply.
          </p>
          <p className="mt-3">
            Then an <b className="text-ink">itemised quote</b>, labour split
            from materials, benchmarked against real Jamaican material costs and
            day rates rather than guessed at from a distance. A{" "}
            <b className="text-ink">written scope</b> you agree before anybody
            lifts a tool.
          </p>
          <p className="mt-3">
            The work is then <b className="text-ink">proven with timestamped
            evidence</b> at every stage, and nobody is paid for a stage until
            you have approved it.
          </p>
          <p className="mt-3">
            <b className="text-ink">You do not need an account yet.</b> One is
            set up when you book the job, because that is when it starts earning
            its keep: approving the evidence, holding the invoice and carrying
            the record of the property between jobs.
          </p>
        </div>
      </>
    );
  }

  return (
    <>
      <p className="text-[10.5px] font-bold uppercase tracking-[.2em] text-mango">Post a job</p>
      <h1 className="mt-2 font-display text-[clamp(28px,5vw,52px)] uppercase leading-[.95]">
        Tell us what needs
        <br />
        <span className="bg-gradient-to-r from-mango to-coral bg-clip-text text-transparent">
          doing.
        </span>
      </h1>
      <p className="mt-4 max-w-[62ch] text-[16px] leading-relaxed text-mute">
        Free, and nothing is charged here. <b className="text-ink">No account
        needed to get a quote.</b>
      </p>

      <div className="mt-6 max-w-[62ch]">
        <div className="jhead">
          <span className="jbadge">Step {step + 1} of 3</span>
        </div>

        <div className="mt-4 rounded-2xl border border-line bg-panel p-5">
          {step === 0 && (
            <div className="grid gap-4">
              <div className="fgroup">
                {/* A group with a name, and buttons that say whether they are
                    on. These were bare <button>s inside a plain <div>, so a
                    screen reader heard eighteen unrelated buttons, could not
                    tell which one was chosen, and never heard that the group
                    was required. aria-pressed rather than a radiogroup because
                    these really are toggles: tapping the chosen one clears it,
                    which a radio cannot do. The tick and plus are decoration
                    once the state is announced, so they are hidden. */}
                <label className="fl" id="lbl-trade">
                  What kind of work is it{" "}
                  <span className={"src " + (trade ? "ok" : "req")}>
                    {trade ? "Chosen" : "Required"}
                  </span>
                </label>
                <div className="chips" role="group" aria-labelledby="lbl-trade">
                  {TRADES.map((t) => (
                    <button key={t} type="button" aria-pressed={trade === t}
                      className={trade === t ? "on" : ""}
                      onClick={() => setTrade(trade === t ? "" : t)}>
                      <span aria-hidden="true">{trade === t ? "✓ " : "+ "}</span>{t}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-[12.5px] leading-relaxed text-dim">
                  Not sure which? Pick the closest. A person reads this and will
                  put it right if it needs changing.
                </p>
              </div>

              <div className="fgroup">
                <label className="fl" id="lbl-parish">
                  Which parish is the property in{" "}
                  <span className={"src " + (parish ? "ok" : "req")}>
                    {parish ? "Chosen" : "Required"}
                  </span>
                </label>
                <div className="chips" role="group" aria-labelledby="lbl-parish">
                  {PARISHES.map((p) => (
                    <button key={p} type="button" aria-pressed={parish === p}
                      className={parish === p ? "on" : ""}
                      onClick={() => setParish(parish === p ? "" : p)}>
                      <span aria-hidden="true">{parish === p ? "✓ " : "+ "}</span>{p}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-[12.5px] leading-relaxed text-dim">
                  We are working in <b className="text-mute">Kingston and Portmore</b> first.
                  Post from anywhere in Jamaica anyway: we will tell you
                  straight whether we can reach you yet.
                </p>
              </div>

              <div className="fgroup" style={{ marginBottom: 0 }}>
                <label className="fl" htmlFor="desc">
                  What is happening{" "}
                  <span className={"src " + (desc.trim().length > 10 ? "ok" : "req")}>
                    {desc.trim().length > 10 ? "Enough to start" : "Required"}
                  </span>
                </label>
                <textarea id="desc" className="jf" rows={5}
                  placeholder="For example: the zinc lift off the back roof in the storm and water is running down the bedroom wall. The house is empty, my aunt next door has the key."
                  value={desc} onChange={(e) => setDesc(e.target.value)} />
                <p className="mt-2 text-[12.5px] leading-relaxed text-dim">
                  Your own words are fine. Patois is fine. What it is, where in
                  the house, and how long it has been happening.
                </p>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="grid gap-3">
              <div className="rounded-xl border border-softline bg-soft px-4 py-3 text-[12.5px] leading-relaxed">
                <b className="text-ink">Saved.</b>{" "}
                <span className="text-mute">
                  Your job is on file{jobId ? <> as <span className="font-mono text-ink">{jobId}</span></> : null}, before
                  we have asked you for a single personal detail.{" "}
                  <b className="text-ink">No worker can see it.</b> Nothing goes
                  anywhere until you finish the next screen.
                </span>
              </div>
              <div className="rounded-xl border border-line bg-bg px-4 py-4 text-[13.5px] leading-relaxed text-mute">
                <b className="text-ink">Photos help more than anything else you
                can send.</b>
                <p className="mt-2">
                  They are what turns a guess into a quote. You do not need them
                  to carry on. On the next screen you get a link to your portal,
                  and that is where you send them, straight from your phone or
                  from whoever is at the property. WhatsApp works too, once we
                  reply.
                </p>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="grid gap-4">
              <div className="fgroup">
                <label className="fl">
                  Your name{" "}
                  <span className={"src " + (name.trim().length > 1 ? "ok" : "req")}>
                    {name.trim().length > 1 ? "Done" : "Required"}
                  </span>
                </label>
                <input className="jf" autoComplete="name" placeholder="Your full name"
                  value={name} onChange={(e) => setName(e.target.value)} />
              </div>

              <div className="fgroup" style={{ marginBottom: 0 }}>
                <label className="fl">
                  One way to reach you{" "}
                  <span className={"src " + (contactOk ? "ok" : "req")}>
                    {contactOk ? "Done" : "Required, either one"}
                  </span>
                </label>
                <input className="jf" placeholder="An email address or a WhatsApp number"
                  value={contact} onChange={(e) => setContact(e.target.value)} />
                {/* The sentence that makes people type a real number. It was
                    on the old funnel and it stays word for word. */}
                <p className="mt-2 text-[12.5px] leading-relaxed text-dim">
                  <b className="text-mute">Hidden from workers until you start a
                  chat with one. You control when it&rsquo;s shared.</b>{" "}
                  Either one is enough, you do not need both, and there is no
                  password and no account at this stage.
                </p>
              </div>
            </div>
          )}

          {error && (
            <div className="mt-4 rounded-xl border border-coral/50 bg-coral/5 px-4 py-3 text-[13px] text-coral">
              {error}
            </div>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-2.5">
            {step > 0 && (
              <button type="button" onClick={() => setStep((step - 1) as Step)}
                className="rounded-full border border-line2 px-5 py-2.5 text-[13px] font-bold transition hover:border-teal hover:text-tealb">
                Back
              </button>
            )}
            {step === 0 && (
              <button type="button" disabled={busy || !workReady} onClick={saveDraft}
                className="rounded-full bg-linear-to-r from-teal to-mango px-5 py-2.5 text-[13px] font-bold text-onbrand transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50">
                {busy ? "Saving…" : "Save and carry on"}
              </button>
            )}
            {step === 1 && (
              <button type="button" onClick={() => setStep(2)}
                className="rounded-full bg-linear-to-r from-teal to-mango px-5 py-2.5 text-[13px] font-bold text-onbrand transition hover:brightness-110">
                Continue
              </button>
            )}
            {step === 2 && (
              <button type="button" disabled={busy || !reachReady} onClick={send}
                className="rounded-full bg-linear-to-r from-teal to-mango px-5 py-3 text-[14px] font-bold text-onbrand transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50">
                {busy ? "Sending…" : "Send my job"}
              </button>
            )}
          </div>

          {step === 0 && !workReady && (
            <p className="mt-3 text-[12.5px] text-dim">
              Pick a trade and a parish, and say what is happening, to carry on.
            </p>
          )}
        </div>

        <p className="mt-4 text-[12.5px] leading-relaxed text-dim">
          A person, Monique, reads every job and replies within one working day.
        </p>
      </div>
    </>
  );
}
