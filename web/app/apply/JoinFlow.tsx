"use client";

import { useState } from "react";

/**
 * Join as a pro, ported from the preview's #s-join.
 *
 * Nine steps and a vetting record that fills in beside them. The wording,
 * the order and the rules are the preview's, carried over rather than
 * re-written, because they have been through rounds and are decided.
 *
 * This lives on the app and not on the marketing site for one reason: by
 * step 3 it is asking for a government photo ID, a live face video, a TRN
 * and a proof of address. That belongs behind auth, and the files belong in
 * the private `vetting` bucket, which is admin-read-only and closed to every
 * browser token. Nothing here writes a file directly; the server mints a
 * signed upload URL for one path and records the row afterwards.
 *
 * Joining is a separate channel from signing in. A tradesperson who is
 * already on the platform and wants to see their job goes to the worker
 * portal, never through here.
 */

const TRADES = [
  "Plumbing", "Roofing", "Electrical", "Tiling", "Masonry & Concrete",
  "Painting & Decorating", "Grille & Gate Welding", "Air Conditioning",
  "Landscaping", "General Handyman", "Solar Install", "Water Tank & Pump",
  "Locks & Security Doors", "Windows & Glazing", "Carpentry & Joinery",
  "Drainage & Septic", "Fencing", "CCTV & Alarms",
];

const PARISHES = [
  "Kingston", "St Andrew", "St Catherine", "Clarendon", "Manchester",
  "St Elizabeth", "Westmoreland", "Hanover", "St James", "Trelawny",
  "St Ann", "St Mary", "Portland", "St Thomas",
];

type Step = { n: string; h: string; p: string; body: BodyKind; note: string };
type BodyKind = "form" | "port" | "id" | "police" | "refs" | "agent" | "sign" | "trial" | "live";

const STEPS: Step[] = [
  { n: "1 · Apply", body: "form",
    h: "Your trades, and every parish you cover",
    p: "Take as many trades as you actually do, and name one yourself if it is not on our list. Pick every parish you will travel to, a job in a parish you have not ticked never reaches you.",
    note: "Your trades and job types come from the same list a client picks from. That is the only reason a client's roofing job and your roofing profile can find each other at all." },
  { n: "2 · Your work", body: "port",
    h: "Show us the work, however you have it",
    p: "A CV, a portfolio, a link to your site or socials, photos of finished jobs. <b>Any one of these is enough to start</b>, but the more you show the faster vetting moves. If you hold a certificate, upload it, we verify it with the body that issued it, not just look at the picture.",
    note: "We accept CVs. Plenty of good tradespeople have one and nobody has ever asked them for it." },
  { n: "3 · Identity", body: "id",
    h: "A live photo and a live video, not an upload",
    p: "Government photo ID, a <b>live photo</b> taken in the moment, and a <b>short video where you turn your face slowly left to right</b>. The turn is the check, a photograph of a photograph cannot do it. Then your TRN and proof of address dated within three months.",
    note: "An upload proves somebody has a document. A live turn proves the person holding it is you, now." },
  { n: "4 · Police check", body: "police",
    h: "JCF record check, required over £500",
    p: "A current police record check from the Jamaica Constabulary Force. <b>Mandatory</b> for any job over £500, any work inside an occupied home, and any time you hold keys or attend an empty property. Get it once and it covers every job you take.",
    note: "Without it your profile still publishes, but you are locked out of every job over £500 and every occupied-home job. That is most of the money on the board." },
  { n: "5 · References", body: "refs",
    h: "Three people who know we are calling",
    p: "Past clients, or trades you have worked alongside. We phone them, an emailed reference is a form somebody filled in. <b>You must confirm each one has been told we will call.</b> If we ring and they have no idea who we are, that is not a reference, and it does not count.",
    note: "This rule exists because a name on a form is not a referee. Somebody who was never asked cannot vouch for you, and putting them down is a mark against the application, not a neutral." },
  { n: "6 · Documents checked", body: "agent",
    h: "A machine reads the file before a person does",
    p: "Every document you upload is read for the things a person skims past: does the name match, is the date inside the window, is the certificate number real. Then a person makes the decision. <b>The machine never decides, it only flags.</b>",
    note: "The decision is always a person's. What the check buys you is speed, not a shortcut." },
  { n: "7 · Sign", body: "sign",
    h: "The Worker Guidelines, signed once",
    p: "How quoting works, what evidence you owe on every job, how you get paid, and what loses you the platform. You sign the current version once, not once per job. If the wording is ever revised you are asked to sign the new version before your next job.",
    note: "Written to doc_signatures with a timestamp and the exact consent sentence. No edit, no delete." },
  { n: "8 · Trial job", body: "trial",
    h: "One job with an independent reviewer, at our cost",
    p: "Your first job carries an independent reviewer on site, paid for by Yaadly, not by you and not by the client. They record what they see against the same evidence standard you will be held to afterwards.",
    note: "It is the only way to know the standard holds on a real site rather than in an application form." },
  { n: "9 · Live", body: "live",
    h: "Published, and the board opens",
    p: "Your profile publishes with your trades, your parishes, your verified badges and your first completed job. From here you quote freely, and every completed job builds a record that belongs to you.",
    note: "Free to join, free to quote, win or lose. The one charge is 12% of your labour price on a completed job." },
];

type Check = { k: string; b: string; s: string; req?: boolean };
const CHECKS: Check[] = [
  { k: "form",   b: "Trades and parishes set", s: "From the same list clients pick from" },
  { k: "port",   b: "CV, portfolio or links",  s: "Any one of them is enough to start" },
  { k: "id",     b: "Government photo ID",     s: "Live photo and a left-to-right video turn" },
  { k: "id2",    b: "TRN verified",            s: "Matched to the name on the ID" },
  { k: "id3",    b: "Proof of address",        s: "Dated within three months" },
  { k: "police", b: "JCF police record check", s: "Required over £500 and for any occupied home", req: true },
  { k: "refs",   b: "3 references, confirmed and called", s: "Each one told in advance that we would call", req: true },
  { k: "agent",  b: "Documents machine-read",  s: "Name, dates and certificate numbers checked" },
  { k: "sign",   b: "Worker Guidelines signed", s: "The current version, once" },
  { k: "trial",  b: "Trial job reviewed",      s: "Independent reviewer on site, at our cost" },
  { k: "live",   b: "Profile published",       s: "You are on the board" },
];

/** Which vetting-record rows a given step is responsible for. */
const OWNS: Record<number, string[]> = {
  0: ["form"], 1: ["port"], 2: ["id", "id2", "id3"], 3: ["police"],
  4: ["refs"], 5: ["agent"], 6: ["sign"], 7: ["trial"], 8: ["live"],
};

export function JoinFlow() {
  const [step, setStep] = useState(0);
  const [trades, setTrades] = useState<string[]>([]);
  const [parishes, setParishes] = useState<string[]>([]);
  const [refsTold, setRefsTold] = useState<boolean[]>([false, false, false]);
  const [signed, setSigned] = useState(false);

  const toggle = (list: string[], set: (v: string[]) => void, v: string) =>
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const doneKeys = new Set<string>();
  for (let i = 0; i < step; i++) OWNS[i]?.forEach((k) => doneKeys.add(k));
  const nowKeys = new Set(OWNS[step] ?? []);

  const d = STEPS[step];

  return (
    <>
      <p className="text-[10.5px] font-bold uppercase tracking-[.2em] text-mango">
        For tradespeople
      </p>
      <h1 className="mt-2 font-display text-[clamp(28px,5vw,52px)] uppercase leading-[.95]">
        Getting on the board
        <br />
        <span className="bg-gradient-to-r from-mango to-coral bg-clip-text text-transparent">
          is not a form. It is a check.
        </span>
      </h1>
      <p className="mt-4 max-w-[62ch] text-[16px] leading-relaxed text-mute">
        Free to join. Free to quote, win or lose. But nobody reaches a client&rsquo;s
        gate unverified, and that is the reason a client trusts the quote you send
        them.
      </p>

      <div className="jrail">
        {STEPS.map((s, i) => (
          <button
            key={s.n}
            onClick={() => setStep(i)}
            className={i === step ? "on" : i < step ? "done" : ""}
          >
            {s.n}
          </button>
        ))}
      </div>

      <div className="jlane">
        <div>
          <div className="jhead">
            <span className="jbadge">Step {step + 1} of {STEPS.length}</span>
            <h2 className="font-display text-[clamp(22px,3.4vw,32px)] uppercase leading-none">
              {d.h}
            </h2>
            <p
              className="mt-3 max-w-[62ch] text-[14.5px] leading-relaxed text-mute"
              dangerouslySetInnerHTML={{ __html: d.p }}
            />
          </div>

          <div className="mt-4 rounded-2xl border border-line bg-panel p-5">
            {d.body === "form" && (
              <>
                <div className="fgroup">
                  <label className="fl">
                    Your trades, tick every one you take{" "}
                    <span className="src ok">{trades.length} selected</span>
                  </label>
                  <div className="chips">
                    {TRADES.map((t) => (
                      <button key={t} className={trades.includes(t) ? "on" : ""}
                        onClick={() => toggle(trades, setTrades, t)}>
                        {trades.includes(t) ? "✓ " : "+ "}{t}
                      </button>
                    ))}
                  </div>
                  <p className="mt-2 text-[12.5px] leading-relaxed text-dim">
                    Not on the list? Tell us at the end. We would rather know what
                    you actually do than squeeze you into the nearest box.
                  </p>
                </div>
                <div className="fgroup">
                  <label className="fl">
                    Parishes you will travel to{" "}
                    <span className="src ok">{parishes.length} selected</span>
                  </label>
                  <div className="chips">
                    {PARISHES.map((p) => (
                      <button key={p} className={parishes.includes(p) ? "on" : ""}
                        onClick={() => toggle(parishes, setParishes, p)}>
                        {parishes.includes(p) ? "✓ " : "+ "}{p}
                      </button>
                    ))}
                  </div>
                  <p className="mt-2 text-[12.5px] leading-relaxed text-dim">
                    A job posted in a parish you have not ticked never reaches you.
                    Tick wide, decline what you do not want.
                  </p>
                </div>
              </>
            )}

            {d.body === "port" && (
              <div className="grid gap-3">
                {["A CV or a written history", "A portfolio, or photos of finished jobs",
                  "A link to your site, Instagram or Facebook", "Trade certificates, if you hold any"].map((x) => (
                  <label key={x} className="flex items-center gap-3 rounded-xl border border-line bg-bg px-4 py-3 text-[13.5px]">
                    <span className="grid size-7 place-items-center rounded-lg border border-line2 text-dim">+</span>
                    {x}
                  </label>
                ))}
                <p className="text-[12.5px] leading-relaxed text-dim">
                  Certificates are verified with the body that issued them, not
                  read off the picture.
                </p>
              </div>
            )}

            {d.body === "id" && (
              <div className="grid gap-3">
                {[["Government photo ID", "Passport, driver's licence or national ID"],
                  ["A live photo", "Taken in the moment, not from your camera roll"],
                  ["A short video, face left to right", "The turn is the check"],
                  ["Your TRN", "Matched to the name on the ID"],
                  ["Proof of address", "Dated within the last three months"]].map(([a, b]) => (
                  <div key={a} className="rounded-xl border border-line bg-bg px-4 py-3">
                    <b className="text-[13.5px]">{a}</b>
                    <span className="mt-1 block text-[12px] text-dim">{b}</span>
                  </div>
                ))}
                <div className="rounded-xl border border-softline bg-soft px-4 py-3 text-[12.5px] leading-relaxed text-mute">
                  <b className="text-ink">These files never touch the public site.</b>{" "}
                  They upload straight into a private store that only Yaadly admins
                  can read, and they are destroyed once vetting is decided. What we
                  keep forever is the decision, not your passport.
                </div>
              </div>
            )}

            {d.body === "police" && (
              <>
                <div className="pcrule">
                  <div className="pcbox must">
                    <div className="pch">Over £500</div>
                    <p><b className="text-ink">Mandatory.</b> Any job above £500 in
                    value needs a current JCF police record check on file before you
                    can be matched to it. No exceptions, no client opt-out.</p>
                  </div>
                  <div className="pcbox must">
                    <div className="pch">Inside a home</div>
                    <p><b className="text-ink">Mandatory.</b> Any work inside an
                    occupied home, any job where you hold keys, and any attendance at
                    an empty property, whatever the value.</p>
                  </div>
                  <div className="pcbox">
                    <div className="pch">Under £500</div>
                    <p>Optional, with the owner present. The client can still ask for
                    it and we will require it, free to them, and you keep the
                    certificate for every job after.</p>
                  </div>
                </div>
                <div className="mt-4 rounded-xl border border-softline bg-soft px-4 py-3 text-[13px] leading-relaxed text-mute">
                  <b className="text-ink">Why it is drawn at £500.</b> That is roughly
                  where a job stops being a call-out and starts being someone&rsquo;s
                  savings. Above it, a client is trusting you with real money and real
                  access, so the bar goes up. Get the check once and it covers every
                  job you take.
                </div>
              </>
            )}

            {d.body === "refs" && (
              <div className="grid gap-3">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="rounded-xl border border-line bg-bg p-4">
                    <b className="text-[13.5px]">Reference {i + 1}</b>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      <input className="jf" placeholder="Name" />
                      <input className="jf" placeholder="Phone number" />
                    </div>
                    <label className="mt-3 flex items-start gap-2.5 text-[12.5px] leading-relaxed text-mute">
                      <input type="checkbox" checked={refsTold[i]} className="mt-0.5 size-4 accent-teal"
                        onChange={() => setRefsTold(refsTold.map((v, j) => j === i ? !v : v))} />
                      I have told this person that Yaadly will call them.
                    </label>
                  </div>
                ))}
                <p className="text-[12.5px] leading-relaxed text-dim">
                  We phone every one. If we ring and they have no idea who we are,
                  it does not count.
                </p>
              </div>
            )}

            {d.body === "agent" && (
              <div className="grid gap-3">
                {[["Name match", "The name on every document is the same name"],
                  ["Dates in window", "Proof of address inside three months, police check current"],
                  ["Certificate numbers", "Checked against the issuing body, not read off the image"]].map(([a, b]) => (
                  <div key={a} className="rounded-xl border border-line bg-bg px-4 py-3">
                    <b className="text-[13.5px]">{a}</b>
                    <span className="mt-1 block text-[12px] text-dim">{b}</span>
                  </div>
                ))}
                <div className="rounded-xl border border-softline bg-soft px-4 py-3 text-[12.5px] leading-relaxed text-mute">
                  <b className="text-ink">The machine never decides.</b> It flags, and
                  a person makes the call. What it buys you is speed, not a shortcut.
                </div>
              </div>
            )}

            {d.body === "sign" && (
              <div className="grid gap-3">
                <div className={"sigbox" + (signed ? " done" : "")}>
                  <b>{signed ? "✓ Worker Guidelines signed" : "Worker Guidelines, current version"}</b>
                  <span>
                    How quoting works, the evidence you owe on every job, how you are
                    paid, and what loses you the platform.
                  </span>
                </div>
                <label className="flex items-start gap-2.5 text-[13px] leading-relaxed text-mute">
                  <input type="checkbox" checked={signed} className="mt-0.5 size-4 accent-teal"
                    onChange={() => setSigned(!signed)} />
                  I have read the Worker Guidelines and I agree to work to them on
                  every Yaadly job.
                </label>
                <input className="jf" placeholder="Type your full name to sign" />
                <p className="text-[12px] leading-relaxed text-dim">
                  Written to <span className="font-mono">doc_signatures</span> with a
                  timestamp and the exact consent sentence. No edit, no delete.
                </p>
              </div>
            )}

            {d.body === "trial" && (
              <div className="rounded-xl border border-softline bg-soft px-4 py-4 text-[13.5px] leading-relaxed text-mute">
                <b className="text-ink">One job, with somebody watching, at our cost.</b>
                <p className="mt-2">
                  An independent reviewer attends your first job and records what they
                  see against the same evidence standard you will be held to
                  afterwards. Yaadly pays for it. Not you, and not the client.
                </p>
              </div>
            )}

            {d.body === "live" && (
              <div className="rounded-xl border border-softline bg-soft px-4 py-4 text-[13.5px] leading-relaxed text-mute">
                <b className="text-ink">Published, and the board opens.</b>
                <p className="mt-2">
                  Your profile carries your trades, your parishes, your verified
                  badges and your first completed job. From here you quote freely, and
                  every completed job builds a record that belongs to you.
                </p>
              </div>
            )}
          </div>

          <p className="mt-3 text-[12.5px] leading-relaxed text-dim">{d.note}</p>

          <div className="mt-5 flex flex-wrap items-center gap-2.5">
            {step > 0 && (
              <button onClick={() => setStep(step - 1)}
                className="rounded-full border border-line2 px-5 py-2.5 text-[13px] font-bold transition hover:border-teal hover:text-tealb">
                Back
              </button>
            )}
            {step < STEPS.length - 1 ? (
              <button onClick={() => setStep(step + 1)}
                className="rounded-full bg-linear-to-r from-teal to-mango px-5 py-2.5 text-[13px] font-bold text-[#04211D] transition hover:brightness-110">
                Continue
              </button>
            ) : (
              <a href="/portal/worker"
                className="rounded-full bg-linear-to-r from-teal to-mango px-5 py-2.5 text-[13px] font-bold text-[#04211D] transition hover:brightness-110">
                Go to your worker portal
              </a>
            )}
          </div>
        </div>

        <div className="vrec">
          <p className="mb-2 text-[10.5px] font-bold uppercase tracking-[.2em] text-mango">
            Your vetting record
          </p>
          {CHECKS.map((c) => {
            const done = doneKeys.has(c.k);
            const now = nowKeys.has(c.k);
            return (
              <div className="vitem" key={c.k}>
                <span className={"vdot" + (done ? " done" : now ? " now" : "")}>
                  {done ? "✓" : now ? "•" : ""}
                </span>
                <div className="flex-1">
                  <b>
                    {c.b}{" "}
                    {c.req && <span className="src req">Required</span>}
                  </b>
                  <span>{c.s}</span>
                </div>
                <span className="st">{done ? "Done" : now ? "Now" : "Waiting"}</span>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
