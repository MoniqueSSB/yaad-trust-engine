"use client";

/* ── Post a job ────────────────────────────────────────────────────────────
 *
 * The client funnel. It lives here because the app is the only place a job is
 * created now: the duplicate funnel inside docs/index.html was deleted, and
 * for a short while after that there was nowhere to post a job at all.
 *
 * SIX STAGES since 3 Sep 2026, one question each, in the order somebody
 * actually thinks about a problem with a building. It was three, and the
 * middle one of the three had nothing on it to fill in, so a person was
 * charged a step for reading a paragraph. The rules behind the stages are in
 * lib/jobs/new-form.ts, because two of the answers are read by a Postgres
 * trigger and needed testing.
 *
 * FIVE THINGS THIS KEEPS, deliberately, because the old funnel got them right
 * and a rewrite is the easiest place to lose them.
 *
 *   1. The job saves as a DRAFT before anything personal is asked. Somebody who
 *      closes the tab on screen two has a job on file, not an empty form.
 *   2. And now they can get back to it. The reference and the answers are kept
 *      in the browser as well, which the old version did not do: the reference
 *      lived in React state, so a closed tab left a job on file that its own
 *      client could never reach again. See the storage notes in new-form.ts
 *      for what is deliberately NOT kept.
 *   3. The contact field says the details are hidden from workers until the
 *      client starts a chat. That sentence is the reason people type a real
 *      number instead of a fake one.
 *   4. The reply promise is stated and it is one working day.
 *   5. A failed draft save does not trap anybody. The throttle on
 *      yaad-post-job is per caller per hour and it can trip on a shared
 *      connection; when it does, the form offers to carry on without saving
 *      and the enquiry still reaches Monique with the words intact. Losing a
 *      reference number is a nuisance. Losing six sentences about somebody's
 *      mother's roof is not.
 *
 * NO ACCOUNT HERE. Founder decision, 30 Aug 2026: no account to get quotes, an
 * account once a job is booked. So there is no password on this page and no
 * sign-up. The account is created at booking, where it pays for itself:
 * approving evidence, holding the invoice, carrying the property record.
 *
 * NO FILE INPUT HERE either, and that is a decision rather than an omission.
 * yaad-post-job still accepts a photos array left over from the deleted
 * funnel: up to eight images, no size limit at all, written as base64 into
 * the evidence table, which is immutable, with the GPS coordinate the phone
 * wrote into the file left on them. The portal's own route (job_photos) is
 * capped, goes to private storage, strips the location and can be deleted by
 * the person who sent it. So stage four explains what to photograph and the
 * confirmation screen hands over a link that lands directly on the upload,
 * and the file itself only ever travels the safe path.
 *
 * The work goes to yaad-post-job in draft mode, which stores no personal data
 * at all. The contact details go separately to yaad-enquiry, which is the
 * hardened path: per-recipient throttle, receipt tracking, and a real answer
 * when somebody gave a phone number rather than an email. Neither is a new
 * table and neither needed changing.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { TRADES, PARISHES } from "@/lib/taxonomy";
import {
  ACCESS, DRAFT_KEY, EMPTY_FIELDS, STAGES, URGENCY,
  draftFields, firstIncomplete, looksLikeEmail, looksLikePhone,
  parseDraft, restoreFields, serialiseDraft, stageComplete, worthKeeping,
  type Fields, type StageKey,
} from "@/lib/jobs/new-form";

const POST_JOB_FN = "yaad-post-job";
const ENQUIRY_FN = "yaad-enquiry";

export function PostJob({ initialTrade, requestedWorker }: { initialTrade?: string; requestedWorker?: string }) {
  const [stage, setStage] = useState(0);
  const [f, setF] = useState<Fields>(() => ({
    ...EMPTY_FIELDS,
    trade: initialTrade && (TRADES as readonly string[]).includes(initialTrade) ? initialTrade : "",
  }));

  const [jobId, setJobId] = useState("");
  const [portalCode, setPortalCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saveFailed, setSaveFailed] = useState(false);
  const [sent, setSent] = useState(false);
  const [restored, setRestored] = useState(false);

  const set = <K extends keyof Fields>(k: K, v: Fields[K]) => setF((p) => ({ ...p, [k]: v }));
  const key = STAGES[stage].key;
  const canAdvance = stageComplete(key, f);

  /* ── bringing a draft back ──────────────────────────────────────────────
     Once, on mount. Anything unreadable or older than a week is ignored
     rather than repaired, and the person lands on the first stage that is
     still missing something rather than back at the beginning. */
  /* Restoring a saved draft on mount, which cannot be done any other way in a
     component that also renders on the server.

     The rule is right in general: setState in an effect usually means state
     that should have been derived during render. It is wrong here. The source
     is window.localStorage, which does not exist during the server render, so
     a lazy useState initialiser cannot read it without a hydration mismatch,
     and there is nothing to derive from because the value arrives from outside
     React entirely. One extra render on mount is the actual, intended cost.

     Disabled with a reason rather than restructured, deliberately. CLAUDE.md
     is explicit that a lint job must not be made green by quietly changing
     behaviour, and what this effect protects is the thing /jobs/new exists to
     protect: somebody who closed the tab halfway through gets their answers
     back. Rewriting that to satisfy a heuristic would be the exact trade the
     rule was added to prevent. */
  useEffect(() => {
    let raw: string | null = null;
    try { raw = window.localStorage.getItem(DRAFT_KEY); } catch { return; }
    const d = parseDraft(raw, Date.now());
    if (!d) return;
    const kept = restoreFields(d, { trades: TRADES, parishes: PARISHES });
    const next: Fields = { ...EMPTY_FIELDS, ...kept };
    if (!next.trade && initialTrade && (TRADES as readonly string[]).includes(initialTrade)) {
      next.trade = initialTrade;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- see the note above this effect
    setF(next);
    if (d.jobId) setJobId(d.jobId);
    setRestored(true);
    /* Name and contact are never stored, so firstIncomplete() would always
       point at the contact stage and skip the photos screen nobody has read
       yet. Land on the first of the three answered stages that is short,
       and on photos when all three are done. */
    const k = firstIncomplete(next);
    const i = k && k !== "reach" ? STAGES.findIndex((s) => s.key === k) : 3;
    setStage(i < 0 ? 0 : i);
  }, [initialTrade]);

  /* Written on every change, not on every stage. Somebody who closes the tab
     mid-sentence gets the sentence back. */
  useEffect(() => {
    if (sent) return;
    try {
      if (worthKeeping(draftFields(f))) {
        window.localStorage.setItem(DRAFT_KEY, serialiseDraft(jobId, f, Date.now()));
      }
    } catch { /* private browsing, a full quota: the form still works */ }
  }, [f, jobId, sent]);

  /* The browser's own "leave site?" prompt, for the accidental back button or
     the closed tab. The saved draft above is the belt; this is the braces,
     because a prompt somebody cancels costs them nothing and a restore
     banner they never see costs them the form. */
  useEffect(() => {
    if (sent || !worthKeeping(draftFields(f))) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [f, sent]);

  const startAgain = useCallback(() => {
    try { window.localStorage.removeItem(DRAFT_KEY); } catch { /* nothing to clear */ }
    setF({ ...EMPTY_FIELDS, trade: initialTrade && (TRADES as readonly string[]).includes(initialTrade) ? initialTrade : "" });
    setJobId(""); setPortalCode(""); setRestored(false); setError(""); setSaveFailed(false); setStage(0);
  }, [initialTrade]);

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

  /* The draft is written on leaving the first stage, before a name is asked
     for, and again on the way out of each stage that adds to the job card.
     The same jobId is sent every time, so this never makes a second job for
     the same person going back and forward, and only the first call counts
     against the hourly throttle (yaad-post-job records an attempt on create,
     not on update). */
  async function saveDraft(): Promise<boolean> {
    setError(""); setSaveFailed(false); setBusy(true);
    try {
      const d = await call(POST_JOB_FN, {
        mode: "draft",
        jobId: jobId || undefined,
        workType: f.trade,
        parish: f.parish,
        desc: f.desc.trim(),
        /* Two columns this form never used to fill. urgency prints on the
           board and chips red at the desk; accessType is read by
           enforce_vetted_worker_on_quote. See lib/jobs/new-form.ts. */
        urgency: f.urgency,
        accessType: f.accessType,
      });
      if (d.jobId) setJobId(String(d.jobId));
      if (d.portalCode) setPortalCode(String(d.portalCode));
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save your job.");
      setSaveFailed(true);
      return false;
    } finally {
      setBusy(false);
    }
  }

  /** Forward. The three stages that change the job card save on the way out;
   *  photos and contact have nothing to save. */
  async function forward() {
    if (!canAdvance) return;
    if (key === "work" || key === "property" || key === "urgency") {
      const ok = await saveDraft();
      if (!ok) return;
    }
    setError(""); setSaveFailed(false);
    setStage((s) => Math.min(s + 1, STAGES.length - 1));
  }

  /** What the error box offers when a save failed: go on anyway. The job then
   *  reaches Monique through the enquiry with no reference number on it,
   *  which is how every job arrived before drafts existed. */
  function carryOnAnyway() {
    setError(""); setSaveFailed(false);
    setStage((s) => Math.min(s + 1, STAGES.length - 1));
  }

  function goTo(k: StageKey) {
    const i = STAGES.findIndex((s) => s.key === k);
    if (i >= 0) { setError(""); setSaveFailed(false); setStage(i); }
  }

  async function send() {
    setError(""); setSaveFailed(false); setBusy(true);
    try {
      const joinLink = jobId && portalCode
        ? `https://app.yaadly.co.uk/portal/join?job=${encodeURIComponent(jobId)}&code=${encodeURIComponent(portalCode)}&next=photos`
        : "";
      await call(ENQUIRY_FN, {
        name: f.name.trim(),
        contact: f.contact.trim(),
        topic: "Property in Jamaica that needs work doing",
        message:
          `Job posted from the site, no account.\n\n` +
          `Reference: ${jobId || "draft not saved"}\n` +
          (requestedWorker ? `Client asked for: ${requestedWorker}\n` : "") +
          `Trade: ${f.trade}\nParish: ${f.parish}\n` +
          `Urgency: ${f.urgency}\nAccess: ${f.accessType}\n\n${f.desc.trim()}` +
          (joinLink ? `\n\nSet up your portal: ${joinLink}\nJob code, if asked: ${portalCode}` : ""),
      });
      /* Cleared only on a send that went through. A failed send keeps the
         draft exactly where it was so Send can simply be pressed again. */
      try { window.localStorage.removeItem(DRAFT_KEY); } catch { /* nothing to clear */ }
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
        {/* The requested worker was promised on the way in and was never
            mentioned again on the way out, so the one thing that person
            wanted to hear confirmed was the one thing missing. */}
        {requestedWorker && (
          <p className="mt-5 max-w-[62ch] text-[14.5px] leading-relaxed text-mute">
            We are taking this to <b className="text-goldb">{requestedWorker}</b> first,
            as you asked. If they cannot take it on, we will say so and come back
            with who else can.
          </p>
        )}
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
            <b className="text-ink">One more thing, thirty seconds: send your photos.</b>
            <p className="mt-2">
              This link sets up your portal and lands you straight on the photo
              screen. It is what lets quotes, evidence and approvals reach you.
              We would send you this same link by message either way, but
              there is no reason to wait for it.
            </p>
            <Link
              href={`/portal/join?job=${encodeURIComponent(jobId)}&code=${encodeURIComponent(portalCode)}&next=photos`}
              className="mt-4 inline-block rounded-full bg-linear-to-r from-teal to-mango px-5 py-2.5 text-[13px] font-bold text-onbrand transition hover:brightness-110"
            >
              Set up my portal and add photos
            </Link>
            <p className="mt-3 text-[12.5px]">
              Your job code, if you are asked for it: <span className="font-mono text-ink">{portalCode}</span>
            </p>
            {/* The photo route, named at the one moment it is useful. Before
                2 Sep 2026 the only way a picture could reach us was WhatsApp,
                and this screen said so, which made a client who does not use
                WhatsApp a client we never got photographs from. */}
            <p className="mt-3 text-[12.5px]">
              Photographs are private to you, us and the worker booked on the
              job, unless you choose to show one on the marketplace. Whoever is
              at the property can send them from their own phone.
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

      {/* Said once, at the top, rather than discovered one stage at a time.
          Somebody deciding whether to start a form wants to know what it is
          going to ask them for before they begin, not after screen two. */}
      <div className="mt-5 max-w-[62ch] rounded-2xl border border-softline bg-soft px-5 py-4 text-[13.5px] leading-relaxed text-mute">
        <b className="text-ink">What we ask you for, and nothing else.</b>{" "}
        What the work is and what is happening, which parish the property is in
        and who can let a worker in, how soon you need it, and one way to reach
        you. Six short screens, about two minutes.{" "}
        <b className="text-ink">No address, no account, no card.</b>
      </div>

      <div className="mt-6 max-w-[62ch]">
        {/* ── progress ────────────────────────────────────────────────────
            A named list with aria-current on the stage you are on, which is
            the pattern a screen reader can actually follow, rather than a
            badge that reads "Step 2 of 3" and says nothing about what step 2
            is. The bar itself is decoration over the same information. */}
        <div className="jhead">
          <ol aria-label="Progress through the form" className="flex flex-wrap gap-x-2 gap-y-1 text-[11px] font-bold uppercase tracking-[.1em]">
            {STAGES.map((s, i) => (
              <li
                key={s.key}
                aria-current={i === stage ? "step" : undefined}
                className={
                  i === stage
                    ? "text-tealb"
                    : i < stage
                      ? "text-mute"
                      : "text-dim/60"
                }
              >
                {i < stage && <span aria-hidden="true">✓ </span>}
                {s.short}
                {i < STAGES.length - 1 && <span aria-hidden="true" className="pl-2 text-dim/40">/</span>}
              </li>
            ))}
          </ol>
          <div aria-hidden="true" className="mt-2.5 flex gap-1.5">
            {STAGES.map((s, i) => (
              <span
                key={s.key}
                className={
                  "h-[3px] flex-1 rounded-full " +
                  (i <= stage ? "bg-linear-to-r from-teal to-mango" : "bg-line")
                }
              />
            ))}
          </div>
          <p className="mt-2.5 text-[12.5px] text-dim">
            Step {stage + 1} of {STAGES.length}. {STAGES[stage].label}.
          </p>
        </div>

        {restored && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-teal/40 bg-teal/5 px-4 py-3 text-[13px] leading-relaxed text-mute">
            <span>
              <b className="text-ink">We brought back what you typed.</b>{" "}
              {jobId ? <>Still the same job, <span className="font-mono text-ink">{jobId}</span>, not a second one.</> : "Nothing was sent."}
            </span>
            <button type="button" onClick={startAgain}
              className="rounded-full border border-line2 px-3.5 py-1.5 text-[12px] font-bold transition hover:border-coral hover:text-coral">
              Start again
            </button>
          </div>
        )}

        <div className="mt-4 rounded-2xl border border-line bg-panel p-5">
          {/* ── 1. what needs doing ─────────────────────────────────────── */}
          {key === "work" && (
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
                  <span className={"src " + (f.trade ? "ok" : "req")}>
                    {f.trade ? "Chosen" : "Required"}
                  </span>
                </label>
                <div className="chips" role="group" aria-labelledby="lbl-trade">
                  {TRADES.map((t) => (
                    <button key={t} type="button" aria-pressed={f.trade === t}
                      className={f.trade === t ? "on" : ""}
                      onClick={() => set("trade", f.trade === t ? "" : t)}>
                      <span aria-hidden="true">{f.trade === t ? "✓ " : "+ "}</span>{t}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-[12.5px] leading-relaxed text-dim">
                  Not sure which? Pick the closest. A person reads this and will
                  put it right if it needs changing.
                </p>
              </div>

              <div className="fgroup" style={{ marginBottom: 0 }}>
                <label className="fl" htmlFor="desc">
                  What is happening{" "}
                  <span className={"src " + (f.desc.trim().length >= 11 ? "ok" : "req")}>
                    {f.desc.trim().length >= 11 ? "Enough to start" : "Required"}
                  </span>
                </label>
                <textarea id="desc" className="jf" rows={5}
                  placeholder="For example: the zinc lift off the back roof in the storm and water is running down the bedroom wall. The house is empty, my aunt next door has the key."
                  value={f.desc} onChange={(e) => set("desc", e.target.value)} />
                <p className="mt-2 text-[12.5px] leading-relaxed text-dim">
                  Your own words are fine. Patois is fine. What it is, where in
                  the house, and how long it has been happening.
                </p>
              </div>
            </div>
          )}

          {/* ── 2. where the property is ────────────────────────────────── */}
          {key === "property" && (
            <div className="grid gap-4">
              <div className="fgroup">
                <label className="fl" id="lbl-parish">
                  Which parish is the property in{" "}
                  <span className={"src " + (f.parish ? "ok" : "req")}>
                    {f.parish ? "Chosen" : "Required"}
                  </span>
                </label>
                <div className="chips" role="group" aria-labelledby="lbl-parish">
                  {PARISHES.map((p) => (
                    <button key={p} type="button" aria-pressed={f.parish === p}
                      className={f.parish === p ? "on" : ""}
                      onClick={() => set("parish", f.parish === p ? "" : p)}>
                      <span aria-hidden="true">{f.parish === p ? "✓ " : "+ "}</span>{p}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-[12.5px] leading-relaxed text-dim">
                  We are working in <b className="text-mute">Kingston and Portmore</b> first.
                  Post from anywhere in Jamaica anyway: we will tell you
                  straight whether we can reach you yet.
                </p>
              </div>

              {/* The third thing a job needs to be quotable without a phone
                  call. The WhatsApp route has always asked it; this form
                  never did. Deliberately NOT a name and a number: that is a
                  third person's personal details and this form has not even
                  asked for yours yet. Monique picks the details up in the
                  reply. */}
              <div className="fgroup" style={{ marginBottom: 0 }}>
                <label className="fl" id="lbl-access">
                  Who can let a worker in{" "}
                  <span className={"src " + (f.accessType ? "ok" : "req")}>
                    {f.accessType ? "Chosen" : "Required"}
                  </span>
                </label>
                <div className="grid gap-2" role="group" aria-labelledby="lbl-access">
                  {ACCESS.map((a) => (
                    <button key={a.value} type="button" aria-pressed={f.accessType === a.value}
                      onClick={() => set("accessType", f.accessType === a.value ? "" : a.value)}
                      className={
                        "rounded-xl border px-4 py-3 text-left transition " +
                        (f.accessType === a.value
                          ? "border-teal bg-soft"
                          : "border-line bg-bg hover:border-teal")
                      }>
                      <b className={"block text-[13.5px] " + (f.accessType === a.value ? "text-tealb" : "text-ink")}>
                        {a.value}
                      </b>
                      <span className="mt-0.5 block text-[12.5px] leading-relaxed text-dim">{a.note}</span>
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-[12.5px] leading-relaxed text-dim">
                  No names and no numbers here. We sort out who meets the worker
                  when we reply, and{" "}
                  <b className="text-mute">the street address is never asked for
                  on this form.</b>
                </p>
              </div>
            </div>
          )}

          {/* ── 3. how urgent is it ─────────────────────────────────────── */}
          {key === "urgency" && (
            <div className="fgroup" style={{ marginBottom: 0 }}>
              <label className="fl" id="lbl-urgency">
                How soon do you need it done{" "}
                <span className={"src " + (f.urgency ? "ok" : "req")}>
                  {f.urgency ? "Chosen" : "Required"}
                </span>
              </label>
              <div className="grid gap-2" role="group" aria-labelledby="lbl-urgency">
                {URGENCY.map((u) => (
                  <button key={u.value} type="button" aria-pressed={f.urgency === u.value}
                    onClick={() => set("urgency", f.urgency === u.value ? "" : u.value)}
                    className={
                      "rounded-xl border px-4 py-3 text-left transition " +
                      (f.urgency === u.value
                        ? "border-teal bg-soft"
                        : "border-line bg-bg hover:border-teal")
                    }>
                    <b className={"block text-[13.5px] " + (f.urgency === u.value ? "text-tealb" : "text-ink")}>
                      {u.value}
                    </b>
                    <span className="mt-0.5 block text-[12.5px] leading-relaxed text-dim">{u.note}</span>
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[12.5px] leading-relaxed text-dim">
                This is honest information, not a promise on our side. Saying
                urgent moves you up the list a person reads; it does not make a
                roof arrive tomorrow, and we will tell you straight what is
                possible.
              </p>
            </div>
          )}

          {/* ── 4. photos and evidence ──────────────────────────────────── */}
          {key === "evidence" && (
            <div className="grid gap-3">
              <div className="rounded-xl border border-softline bg-soft px-4 py-3 text-[12.5px] leading-relaxed">
                <b className="text-ink">Saved.</b>{" "}
                <span className="text-mute">
                  Your job is on file{jobId ? <> as <span className="font-mono text-ink">{jobId}</span></> : null}, before
                  we have asked you for a single personal detail.{" "}
                  <b className="text-ink">No worker can see it.</b> Nothing goes
                  anywhere until you finish the last two screens.
                </span>
              </div>
              <div className="rounded-xl border border-line bg-bg px-4 py-4 text-[13.5px] leading-relaxed text-mute">
                <b className="text-ink">Photos help more than anything else you
                can send.</b>
                <p className="mt-2">
                  They are what turns a guess into a quote, and they are how a
                  price gets checked against what is actually there rather than
                  what somebody assumed from a distance.{" "}
                  <b className="text-ink">You do not need them to carry on.</b>
                </p>
                <p className="mt-3 text-ink">Four that are worth having.</p>
                <ul className="mt-1.5 grid gap-1.5 pl-4 text-[13px]">
                  <li className="list-disc">A <b className="text-mute">wide shot</b>, far enough back to see the whole wall, roof or room.</li>
                  <li className="list-disc">Then <b className="text-mute">close up on the actual problem</b>, as close as is safe.</li>
                  <li className="list-disc">Any <b className="text-mute">label, rating plate or serial number</b> on a tank, pump, unit or board.</li>
                  <li className="list-disc">The <b className="text-mute">gate or the road</b>, if the property is hard to find.</li>
                </ul>
                <p className="mt-3">
                  Whoever is at the property can take them, on their own phone.
                  A short video of a leak running is worth more than five
                  photographs of a stain.
                </p>
              </div>
              <div className="rounded-xl border border-teal/40 bg-teal/5 px-4 py-4 text-[13.5px] leading-relaxed text-mute">
                <b className="text-ink">Where they go, and this is the part that
                matters.</b>
                <p className="mt-2">
                  When you send this job, the next screen gives you a link that
                  sets up your portal and lands you straight on the photo
                  screen. That is the route: it stores them privately, strips
                  the location your phone writes into the file, and lets you
                  delete any of them later.{" "}
                  <b className="text-ink">Nothing is published unless you say
                  so.</b> WhatsApp works too, once we reply.
                </p>
              </div>
            </div>
          )}

          {/* ── 5. how to reach you ─────────────────────────────────────── */}
          {key === "reach" && (
            <div className="grid gap-4">
              <div className="fgroup">
                <label className="fl" htmlFor="cname">
                  Your name{" "}
                  <span className={"src " + (f.name.trim().length > 1 ? "ok" : "req")}>
                    {f.name.trim().length > 1 ? "Done" : "Required"}
                  </span>
                </label>
                <input id="cname" className="jf" autoComplete="name" placeholder="Your full name"
                  value={f.name} onChange={(e) => set("name", e.target.value)} />
              </div>

              <div className="fgroup" style={{ marginBottom: 0 }}>
                <label className="fl" htmlFor="ccontact">
                  One way to reach you{" "}
                  <span className={"src " + (looksLikeEmail(f.contact) || looksLikePhone(f.contact) ? "ok" : "req")}>
                    {looksLikeEmail(f.contact) || looksLikePhone(f.contact) ? "Done" : "Required, either one"}
                  </span>
                </label>
                <input id="ccontact" className="jf" placeholder="An email address or a WhatsApp number"
                  value={f.contact} onChange={(e) => set("contact", e.target.value)} />
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

          {/* ── 6. check it and send ────────────────────────────────────── */}
          {key === "review" && (
            <div className="grid gap-3">
              <p className="text-[13.5px] leading-relaxed text-mute">
                <b className="text-ink">Nothing has gone to anybody yet.</b> This
                is what we will read. Change anything that is not right.
              </p>
              <dl className="grid gap-0 overflow-hidden rounded-xl border border-line">
                {[
                  { k: "work" as StageKey, t: "The work", v: f.trade },
                  { k: "work" as StageKey, t: "What is happening", v: f.desc.trim(), wrap: true },
                  { k: "property" as StageKey, t: "Parish", v: f.parish },
                  { k: "property" as StageKey, t: "Who lets a worker in", v: f.accessType },
                  { k: "urgency" as StageKey, t: "How soon", v: f.urgency },
                  { k: "reach" as StageKey, t: "Your name", v: f.name.trim() },
                  { k: "reach" as StageKey, t: "Reach you on", v: f.contact.trim() },
                ].map((r, i) => (
                  <div key={r.t} className={"grid grid-cols-[1fr_auto] items-start gap-3 px-4 py-3 " + (i % 2 ? "bg-bg" : "bg-panel")}>
                    <div className="min-w-0">
                      <dt className="text-[10.5px] font-bold uppercase tracking-[.13em] text-dim">{r.t}</dt>
                      <dd className={"mt-0.5 text-[13.5px] text-ink " + (r.wrap ? "whitespace-pre-wrap" : "")}>
                        {r.v || <span className="text-coral">Still needed</span>}
                      </dd>
                    </div>
                    <button type="button" onClick={() => goTo(r.k)}
                      className="rounded-full border border-line2 px-3 py-1 text-[11.5px] font-bold text-mute transition hover:border-teal hover:text-tealb">
                      Edit<span className="sr-only"> {r.t.toLowerCase()}</span>
                    </button>
                  </div>
                ))}
              </dl>
              {requestedWorker && (
                <p className="text-[13px] leading-relaxed text-mute">
                  You are requesting <b className="text-goldb">{requestedWorker}</b>.
                  We take it to them first.
                </p>
              )}
              <p className="text-[12.5px] leading-relaxed text-dim">
                Photographs come after this, on the next screen. Your name and
                the way to reach you go to Yaadly only, never onto the
                marketplace.
              </p>
            </div>
          )}

          {error && (
            <div role="alert" className="mt-4 rounded-xl border border-coral/50 bg-coral/5 px-4 py-3 text-[13px] leading-relaxed text-coral">
              {error}
              {/* A save that failed must not be a locked door. Nothing typed
                  is lost either way; the only thing given up by carrying on
                  is the reference number. */}
              {saveFailed && (
                <>
                  <span className="mt-1.5 block text-mute">
                    Your answers are still here and still on this device. You can
                    try that again, or carry on without a reference number and
                    the job still reaches us.
                  </span>
                  <button type="button" onClick={carryOnAnyway}
                    className="mt-2.5 rounded-full border border-line2 px-4 py-1.5 text-[12px] font-bold text-mute transition hover:border-teal hover:text-tealb">
                    Carry on without saving
                  </button>
                </>
              )}
            </div>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-2.5">
            {stage > 0 && (
              <button type="button" onClick={() => { setError(""); setSaveFailed(false); setStage((s) => s - 1); }}
                className="rounded-full border border-line2 px-5 py-2.5 text-[13px] font-bold transition hover:border-teal hover:text-tealb">
                Back
              </button>
            )}
            {key !== "review" && (
              <button type="button" disabled={busy || !canAdvance} onClick={forward}
                className="rounded-full bg-linear-to-r from-teal to-mango px-5 py-2.5 text-[13px] font-bold text-onbrand transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50">
                {busy ? "Saving…" : saveFailed ? "Try again" : key === "evidence" ? "Continue" : "Save and carry on"}
              </button>
            )}
            {key === "review" && (
              <button type="button" disabled={busy || !canAdvance} onClick={send}
                className="rounded-full bg-linear-to-r from-teal to-mango px-5 py-3 text-[14px] font-bold text-onbrand transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50">
                {busy ? "Sending…" : "Send my job"}
              </button>
            )}
          </div>

          {!canAdvance && (
            <p className="mt-3 text-[12.5px] text-dim">
              {key === "work" && "Pick a trade and say what is happening, to carry on."}
              {key === "property" && "Pick a parish and say who can let a worker in, to carry on."}
              {key === "urgency" && "Pick how soon you need it, to carry on."}
              {key === "reach" && "Your name and one way to reach you, to carry on."}
              {key === "review" && "Something above is still needed. The rows in red say which."}
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
