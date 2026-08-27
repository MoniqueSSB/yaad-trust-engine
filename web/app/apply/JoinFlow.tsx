"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Join as a pro.
 *
 * This was a walkthrough. Nine screens explained the check beautifully and
 * captured none of it: step 2 said "show us the work" over four rows that were
 * not inputs, step 3 asked for a passport with nowhere to attach one, step 5's
 * reference boxes were never read, and no screen ever submitted anything. A
 * tradesperson could read all nine and reach the end having applied to nothing.
 *
 * Every screen now writes. The route is the one the backend already expected:
 *
 *   apply    once, when they leave step 1, and it returns the application id
 *            and an upload token. That pair is the credential for everything
 *            after it, because an applicant has no account yet.
 *   start    per file. The SERVER picks the storage path, never the browser.
 *   PUT      the file goes straight to the private bucket on a one-path URL.
 *   finish   the server downloads what arrived, hashes the real bytes and
 *            writes the row. A document only counts once the server has seen it.
 *   submit   at the end, which flips the application to `received` and pings
 *            the desk.
 *
 * The vetting record on the right used to tick as you clicked through, which
 * meant it was measuring reading, not doing. It now ticks off what has actually
 * been uploaded, typed and confirmed, so it disagrees with you when you skip.
 *
 * The application id and upload token are kept in localStorage. A tradesperson
 * filling this in on a phone, on Jamaican mobile data, will lose the tab. They
 * should not lose the passport they already sent.
 */

const FN = "yaad-vetting-upload";
const STORE = "yaadly.application.v1";
const GUIDELINES_VERSION = "v1";

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
    note: "Written with a timestamp and the exact consent sentence. No edit, no delete." },
  { n: "8 · Trial job", body: "trial",
    h: "One job with an independent reviewer, at our cost",
    p: "Your first job carries an independent reviewer on site, paid for by Yaadly, not by you and not by the client. They record what they see against the same evidence standard you will be held to afterwards.",
    note: "It is the only way to know the standard holds on a real site rather than in an application form." },
  { n: "9 · Send it", body: "live",
    h: "Send it, and the desk picks it up",
    p: "Nothing you have filled in has reached a person yet. Sending it hands the whole file to the Yaadly desk in one piece: your trades, your parishes, every document, your three referees and your signature.",
    note: "Free to join, free to quote, win or lose. The one charge is 12% of your labour price on a completed job." },
];

/* ── the vetting record ───────────────────────────────────────────────────
   Each row states what it needs. The row ticks when that thing is true, not
   when the step it lives under has been scrolled past. */
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

/** Which step to jump to when a checklist row is clicked. */
const ROW_STEP: Record<string, number> = {
  form: 0, port: 1, id: 2, id2: 2, id3: 2, police: 3, refs: 4, agent: 5,
  sign: 6, trial: 7, live: 8,
};

/* ── documents ─────────────────────────────────────────────────────────── */

type DocType =
  | "cv" | "portfolio" | "certificate"
  | "photo_id" | "selfie_with_id" | "face_video" | "trn" | "proof_of_address"
  | "police_check";

type DocState = { state: "idle" | "busy" | "done" | "error"; file?: string; bytes?: number; error?: string };

const IMAGES = "image/jpeg,image/png,image/heic,image/webp";
const PAPERS = `${IMAGES},application/pdf`;
const CVFILE = `${PAPERS},application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document`;
const VIDEOS = "video/mp4,video/webm,video/quicktime";

/** Browsers hand back an empty file.type often enough to matter, especially
 *  for HEIC off an iPhone. The bucket rejects an empty mime, so resolve it
 *  from the extension rather than failing the upload on the browser's mood. */
const MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", heic: "image/heic",
  heif: "image/heic", webp: "image/webp", pdf: "application/pdf",
  mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

function mimeOf(f: File): string {
  if (f.type) return f.type;
  const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXT[ext] ?? "";
}

const kb = (n?: number) =>
  !n ? "" : n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

/* ── the edge function ─────────────────────────────────────────────────── */

type Claim = { applicationId: string; uploadToken: string; reference: string };

async function call(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const sb = createClient();
  const { data, error } = await sb.functions.invoke(FN, { body });
  if (error) {
    // A non-2xx arrives as an error with the real body hidden on .context.
    // The server writes messages meant to be read, so dig them out.
    let msg = "Something went wrong. Nothing was stored.";
    try {
      const ctx = (error as { context?: Response }).context;
      const j = ctx ? await ctx.json() : null;
      if (j?.error) msg = String(j.error);
    } catch { /* keep the generic message */ }
    throw new Error(msg);
  }
  const d = (data ?? {}) as Record<string, unknown>;
  if (d.error) throw new Error(String(d.error));
  return d;
}

export function JoinFlow() {
  const [step, setStep] = useState(0);

  // Step 1
  const [trades, setTrades] = useState<string[]>([]);
  const [parishes, setParishes] = useState<string[]>([]);
  const [tradeOther, setTradeOther] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [years, setYears] = useState("");

  // Step 2
  const [work, setWork] = useState("");
  const [links, setLinks] = useState<string[]>([]);
  const [linkDraft, setLinkDraft] = useState("");

  // Step 4
  const [policeStatus, setPoliceStatus] = useState("");

  // Step 5
  const [refs, setRefs] = useState([
    { name: "", phone: "", told: false },
    { name: "", phone: "", told: false },
    { name: "", phone: "", told: false },
  ]);

  // Step 7
  const [signed, setSigned] = useState(false);
  const [signedName, setSignedName] = useState("");

  // Documents, and the application they hang off
  const [docs, setDocs] = useState<Record<string, DocState>>({});
  const [claim, setClaim] = useState<Claim | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sentRef, setSentRef] = useState("");
  const claimRef = useRef<Claim | null>(null);

  /* Restore a half-finished application. Losing the tab on mobile data must
     not mean re-sending a passport. */
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORE);
      if (!raw) return;
      const v = JSON.parse(raw);
      if (v?.claim?.applicationId && v?.claim?.uploadToken) {
        claimRef.current = v.claim;
        setClaim(v.claim);
        setDocs(v.docs ?? {});
        if (v.form) {
          setTrades(v.form.trades ?? []); setParishes(v.form.parishes ?? []);
          setTradeOther(v.form.tradeOther ?? ""); setName(v.form.name ?? "");
          setPhone(v.form.phone ?? ""); setEmail(v.form.email ?? "");
          setYears(v.form.years ?? ""); setWork(v.form.work ?? "");
          setLinks(v.form.links ?? []);
        }
      }
    } catch { /* a corrupt cache is not worth an error screen */ }
  }, []);

  const remember = useCallback(
    (next: Partial<{ claim: Claim; docs: Record<string, DocState> }>) => {
      try {
        const cur = JSON.parse(localStorage.getItem(STORE) ?? "{}");
        localStorage.setItem(STORE, JSON.stringify({
          ...cur, ...next,
          form: { trades, parishes, tradeOther, name, phone, email, years, work, links },
        }));
      } catch { /* private browsing, carry on */ }
    },
    [trades, parishes, tradeOther, name, phone, email, years, work, links],
  );

  const toggle = (list: string[], set: (v: string[]) => void, v: string) =>
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  /* ── the application, opened once ───────────────────────────────────── */

  const step1Ready =
    name.trim().length > 1 && phone.trim().length > 5 &&
    /.+@.+\..+/.test(email.trim()) && trades.length > 0 && parishes.length > 0;

  async function ensureApplication(): Promise<Claim> {
    if (claimRef.current) return claimRef.current;
    const d = await call({
      action: "apply",
      name: name.trim(),
      trade: trades.join(", "),
      tradeOther: tradeOther.trim(),
      parish: parishes[0] ?? "",
      parishes: parishes.join(", "),
      phone: phone.trim(),
      email: email.trim(),
      years: years.trim(),
      work: work.trim(),
    });
    const c: Claim = {
      applicationId: String(d.applicationId),
      uploadToken: String(d.uploadToken),
      reference: String(d.reference ?? ""),
    };
    claimRef.current = c;
    setClaim(c);
    remember({ claim: c });
    return c;
  }

  /* ── one document ──────────────────────────────────────────────────── */

  async function upload(docType: DocType, file: File) {
    setError("");
    const mime = mimeOf(file);
    if (!mime) {
      setDocs((d) => ({ ...d, [docType]: { state: "error", error: "We could not tell what kind of file that is." } }));
      return;
    }
    setDocs((d) => ({ ...d, [docType]: { state: "busy", file: file.name, bytes: file.size } }));
    try {
      const c = await ensureApplication();
      const started = await call({
        action: "start", applicationId: c.applicationId, uploadToken: c.uploadToken,
        docType, mime, bytes: file.size,
      });

      const sb = createClient();
      const { error: upErr } = await sb.storage
        .from("vetting")
        .uploadToSignedUrl(String(started.path), String(started.token), file, { contentType: mime });
      if (upErr) throw new Error(upErr.message);

      // The row is only written after the server has downloaded and hashed
      // what actually arrived, so this is what makes the document count.
      await call({
        action: "finish", applicationId: c.applicationId, uploadToken: c.uploadToken,
        docType, path: String(started.path),
      });

      setDocs((d) => {
        const next = { ...d, [docType]: { state: "done" as const, file: file.name, bytes: file.size } };
        remember({ docs: next });
        return next;
      });
      if (docType === "police_check") setPoliceStatus("uploaded");
    } catch (e) {
      setDocs((d) => ({
        ...d,
        [docType]: { state: "error", file: file.name, error: e instanceof Error ? e.message : "That did not send." },
      }));
    }
  }

  /* ── send ──────────────────────────────────────────────────────────── */

  const refLine = (r: { name: string; phone: string }) =>
    r.name.trim() || r.phone.trim() ? `${r.name.trim()} ${r.phone.trim()}`.trim() : "";

  async function send() {
    setError(""); setBusy(true);
    try {
      const c = await ensureApplication();
      await call({
        action: "submit",
        applicationId: c.applicationId, uploadToken: c.uploadToken,
        name: name.trim(), phone: phone.trim(), email: email.trim(),
        trade: trades.join(", "), tradeOther: tradeOther.trim(),
        parish: parishes[0] ?? "", parishes: parishes.join(", "),
        years: years.trim(), work: work.trim(), links: links.join("\n"),
        ref1: refLine(refs[0]), ref2: refLine(refs[1]), ref3: refLine(refs[2]),
        refsTold: refs.every((r) => r.told),
        policeStatus: policeStatus || "not_yet",
        signedName: signed ? signedName.trim() : "",
        signedVersion: GUIDELINES_VERSION,
      });
      setSentRef(c.reference);
      try { localStorage.removeItem(STORE); } catch { /* fine */ }
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not send. Try again.");
    } finally {
      setBusy(false);
    }
  }

  /* ── what is actually done ─────────────────────────────────────────── */

  const has = (t: DocType) => docs[t]?.state === "done";
  const refsDone = refs.every((r) => r.name.trim() && r.phone.trim() && r.told);

  const done: Record<string, boolean> = {
    form: step1Ready,
    port: has("cv") || has("portfolio") || has("certificate") || links.length > 0,
    id: has("photo_id") && has("selfie_with_id") && has("face_video"),
    id2: has("trn"),
    id3: has("proof_of_address"),
    police: has("police_check"),
    refs: refsDone,
    agent: Boolean(sentRef),
    sign: signed && signedName.trim().length > 1,
    trial: false,
    live: false,
  };

  const outstanding = CHECKS.filter((c) => c.req && !done[c.k]).map((c) => c.b);
  const d = STEPS[step];

  /* ── the sent screen ───────────────────────────────────────────────── */

  if (sentRef) {
    return (
      <>
        <p className="text-[10.5px] font-bold uppercase tracking-[.2em] text-mango">Application sent</p>
        <h1 className="mt-2 font-display text-[clamp(28px,5vw,52px)] uppercase leading-[.95]">
          It is with a person now.
          <br />
          <span className="bg-gradient-to-r from-mango to-coral bg-clip-text text-transparent">
            Your reference is {sentRef}.
          </span>
        </h1>
        <div className="mt-6 max-w-[62ch] rounded-2xl border border-softline bg-soft p-6 text-[14.5px] leading-relaxed text-mute">
          <b className="text-ink">What happens next, in order.</b>
          <p className="mt-3">
            Your documents are read first, by machine, for the things a person
            skims past: whether the name matches across every document, whether
            the dates are inside the window, whether a certificate number is
            real. That produces flags, never a decision.
          </p>
          <p className="mt-3">
            Then a person at the Yaadly desk opens the file, reads those flags,
            and telephones your three referees. That is the part nothing
            automates, and it is the reason a client believes the badge on your
            profile.
          </p>
          <p className="mt-3">
            You will hear back on the phone number and email you gave us. Quote{" "}
            <span className="font-mono text-ink">{sentRef}</span> if you contact
            us first.
          </p>
        </div>
        <p className="mt-4 max-w-[62ch] text-[12.5px] leading-relaxed text-dim">
          Your identity documents are held in a private store no browser can
          read, and they are destroyed on a clock once vetting is decided. What
          survives is the decision, not your passport.
        </p>
      </>
    );
  }

  /* ── the flow ──────────────────────────────────────────────────────── */

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

      {claim && (
        <p className="mt-2 text-[12px] text-dim">
          Saved as <span className="font-mono text-mute">{claim.reference}</span>.
          You can close this and come back on the same phone.
        </p>
      )}

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
                  <input className="jf mt-2.5" placeholder="Not on the list? Type what you do"
                    value={tradeOther} onChange={(e) => setTradeOther(e.target.value)} />
                  <p className="mt-2 text-[12.5px] leading-relaxed text-dim">
                    We would rather know what you actually do than squeeze you into
                    the nearest box.
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

                <div className="fgroup">
                  <label className="fl">How we reach you</label>
                  <div className="grid gap-2.5 sm:grid-cols-2">
                    <input className="jf" placeholder="Your full name" autoComplete="name"
                      value={name} onChange={(e) => setName(e.target.value)} />
                    <input className="jf" placeholder="Phone number" inputMode="tel" autoComplete="tel"
                      value={phone} onChange={(e) => setPhone(e.target.value)} />
                    <input className="jf" placeholder="Email address" inputMode="email" autoComplete="email"
                      value={email} onChange={(e) => setEmail(e.target.value)} />
                    <input className="jf" placeholder="Years at the trade" inputMode="numeric"
                      value={years} onChange={(e) => setYears(e.target.value)} />
                  </div>
                  <p className="mt-2 text-[12.5px] leading-relaxed text-dim">
                    The phone number is the one we call about a job. Give us the one
                    you actually answer.
                  </p>
                </div>
              </>
            )}

            {d.body === "port" && (
              <div className="grid gap-3">
                <Upload label="A CV or a written history" hint="PDF, Word, or a photo of it"
                  accept={CVFILE} doc="cv" docs={docs} onFile={upload} />
                <Upload label="A portfolio, or photos of finished jobs" hint="One file, or a PDF of several"
                  accept={PAPERS} doc="portfolio" docs={docs} onFile={upload} />
                <Upload label="Trade certificates, if you hold any" hint="Verified with the body that issued them, not read off the picture"
                  accept={PAPERS} doc="certificate" docs={docs} onFile={upload} />

                <div className="rounded-xl border border-line bg-bg px-4 py-3">
                  <b className="text-[13.5px]">A link to your site, Instagram or Facebook</b>
                  <span className="mt-1 block text-[12px] text-dim">
                    Add as many as you have. Anywhere your work is already visible.
                  </span>
                  <div className="mt-3 flex gap-2">
                    <input className="jf" placeholder="instagram.com/yourwork" value={linkDraft}
                      onChange={(e) => setLinkDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key !== "Enter") return;
                        e.preventDefault();
                        const v = linkDraft.trim();
                        if (v && !links.includes(v)) { setLinks([...links, v]); setLinkDraft(""); }
                      }} />
                    <button type="button" className="upbtn"
                      onClick={() => {
                        const v = linkDraft.trim();
                        if (v && !links.includes(v)) { setLinks([...links, v]); setLinkDraft(""); }
                      }}>
                      Add link
                    </button>
                  </div>
                  {links.length > 0 && (
                    <div className="lnk">
                      {links.map((l) => (
                        <span className="tag" key={l}>
                          <span>{l}</span>
                          <button type="button" aria-label={`Remove ${l}`}
                            onClick={() => setLinks(links.filter((x) => x !== l))}>×</button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <label className="fl">In your own words, what do you do</label>
                  <textarea className="jf min-h-[110px] resize-y" value={work}
                    onChange={(e) => setWork(e.target.value)}
                    placeholder="The kind of jobs you take, the biggest one you have done, anything a client should know." />
                </div>
              </div>
            )}

            {d.body === "id" && (
              <div className="grid gap-3">
                <Upload label="Government photo ID" hint="Passport, driver's licence or national ID"
                  accept={PAPERS} doc="photo_id" docs={docs} onFile={upload} />
                <Upload label="A live photo" hint="Taken in the moment, not from your camera roll"
                  accept={IMAGES} capture="user" cta="Take photo"
                  doc="selfie_with_id" docs={docs} onFile={upload} />
                <Upload label="A short video, face left to right" hint="The turn is the check. Ten seconds is plenty"
                  accept={VIDEOS} capture="user" cta="Record"
                  doc="face_video" docs={docs} onFile={upload} />
                <Upload label="Your TRN" hint="Matched to the name on the ID"
                  accept={PAPERS} doc="trn" docs={docs} onFile={upload} />
                <Upload label="Proof of address" hint="Dated within the last three months"
                  accept={PAPERS} doc="proof_of_address" docs={docs} onFile={upload} />

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

                <div className="mt-4 grid gap-3">
                  <Upload label="Your JCF police record check" hint="A photo or a scan of the certificate"
                    accept={PAPERS} doc="police_check" docs={docs} onFile={upload} />
                  <label className="flex items-start gap-2.5 text-[13px] leading-relaxed text-mute">
                    <input type="checkbox" className="mt-0.5 size-4 accent-teal"
                      checked={policeStatus === "not_yet" && !has("police_check")}
                      disabled={has("police_check")}
                      onChange={() => setPoliceStatus(policeStatus === "not_yet" ? "" : "not_yet")} />
                    I do not have one yet. Publish my profile without it and I
                    understand I cannot be matched to a job over £500 or any job
                    inside an occupied home until I send it.
                  </label>
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
                {refs.map((r, i) => (
                  <div key={i} className="rounded-xl border border-line bg-bg p-4">
                    <b className="text-[13.5px]">Reference {i + 1}</b>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      <input className="jf" placeholder="Name" value={r.name}
                        onChange={(e) => setRefs(refs.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
                      <input className="jf" placeholder="Phone number" inputMode="tel" value={r.phone}
                        onChange={(e) => setRefs(refs.map((x, j) => j === i ? { ...x, phone: e.target.value } : x))} />
                    </div>
                    <label className="mt-3 flex items-start gap-2.5 text-[12.5px] leading-relaxed text-mute">
                      <input type="checkbox" checked={r.told} className="mt-0.5 size-4 accent-teal"
                        onChange={() => setRefs(refs.map((x, j) => j === i ? { ...x, told: !x.told } : x))} />
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
                <div className="rounded-xl border border-line bg-bg px-4 py-3">
                  <b className="text-[13.5px]">On your file so far</b>
                  <span className="mt-1 block text-[12px] text-dim">
                    {Object.entries(docs).filter(([, v]) => v.state === "done").length === 0
                      ? "Nothing yet. Go back to steps 2, 3 and 4 and attach what you have."
                      : Object.entries(docs).filter(([, v]) => v.state === "done")
                          .map(([k]) => k.replace(/_/g, " ")).join(", ")}
                  </span>
                </div>
                <div className="rounded-xl border border-softline bg-soft px-4 py-3 text-[12.5px] leading-relaxed text-mute">
                  <b className="text-ink">The machine never decides.</b> It flags, and
                  a person at the Yaadly desk makes the call, then telephones your
                  referees. What the check buys you is speed, not a shortcut.
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
                <a href="/portal/guidelines" target="_blank" rel="noreferrer"
                  className="text-[12.5px] font-bold text-tealb underline underline-offset-4">
                  Read the Worker Guidelines →
                </a>
                <label className="flex items-start gap-2.5 text-[13px] leading-relaxed text-mute">
                  <input type="checkbox" checked={signed} className="mt-0.5 size-4 accent-teal"
                    onChange={() => setSigned(!signed)} />
                  I have read the Worker Guidelines and I agree to work to them on
                  every Yaadly job.
                </label>
                <input className="jf" placeholder="Type your full name to sign" value={signedName}
                  onChange={(e) => setSignedName(e.target.value)} />
                <p className="text-[12px] leading-relaxed text-dim">
                  Recorded with a timestamp and the exact consent sentence, when you
                  send the application. No edit, no delete.
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
              <div className="grid gap-3">
                <div className="rounded-xl border border-line bg-bg px-4 py-4 text-[13.5px] leading-relaxed text-mute">
                  <b className="text-ink">Who reads this next.</b>
                  <p className="mt-2">
                    Your documents go to a machine first, which flags mismatched
                    names, expired dates and certificate numbers that do not check
                    out. Then a person at the Yaadly desk opens the file, reads the
                    flags, and telephones your three referees. The machine never
                    decides. The person always does.
                  </p>
                </div>

                {outstanding.length > 0 && (
                  <div className="rounded-xl border border-line2 bg-bg px-4 py-3 text-[12.5px] leading-relaxed text-mute">
                    <b className="text-ink">Still outstanding:</b> {outstanding.join(", ")}.
                    You can send it anyway. It will sit at the desk until these land,
                    and your profile cannot publish without them.
                  </div>
                )}

                {error && (
                  <div className="rounded-xl border border-coral/50 bg-coral/5 px-4 py-3 text-[13px] text-coral">
                    {error}
                  </div>
                )}

                <button onClick={send} disabled={busy || !step1Ready}
                  className="rounded-full bg-linear-to-r from-teal to-mango px-5 py-3 text-[14px] font-bold text-[#04211D] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50">
                  {busy ? "Sending…" : "Send my application"}
                </button>
                {!step1Ready && (
                  <p className="text-[12.5px] text-dim">
                    Step 1 is not complete. We need your name, a phone number, an
                    email, at least one trade and at least one parish.
                  </p>
                )}
              </div>
            )}
          </div>

          <p className="mt-3 text-[12.5px] leading-relaxed text-dim">{d.note}</p>

          {step === 0 && !step1Ready && (
            <p className="mt-2 text-[12.5px] text-dim">
              Fill in your trades, your parishes, your name, phone and email to
              carry on.
            </p>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-2.5">
            {step > 0 && (
              <button onClick={() => setStep(step - 1)}
                className="rounded-full border border-line2 px-5 py-2.5 text-[13px] font-bold transition hover:border-teal hover:text-tealb">
                Back
              </button>
            )}
            {step < STEPS.length - 1 && (
              <button
                disabled={busy || (step === 0 && !step1Ready)}
                onClick={async () => {
                  setError("");
                  if (step === 0) {
                    setBusy(true);
                    try { await ensureApplication(); }
                    catch (e) { setError(e instanceof Error ? e.message : "Could not start your application."); setBusy(false); return; }
                    setBusy(false);
                  }
                  setStep(step + 1);
                }}
                className="rounded-full bg-linear-to-r from-teal to-mango px-5 py-2.5 text-[13px] font-bold text-[#04211D] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50">
                {busy && step === 0 ? "Starting…" : "Continue"}
              </button>
            )}
          </div>

          {error && step !== STEPS.length - 1 && (
            <p className="mt-3 text-[13px] text-coral">{error}</p>
          )}
        </div>

        <div className="vrec">
          <p className="mb-2 text-[10.5px] font-bold uppercase tracking-[.2em] text-mango">
            Your vetting record
          </p>
          {CHECKS.map((c) => {
            const ok = done[c.k];
            const now = !ok && ROW_STEP[c.k] === step;
            return (
              <button className="vitem" key={c.k} onClick={() => setStep(ROW_STEP[c.k] ?? 0)}>
                <span className={"vdot" + (ok ? " done" : now ? " now" : "")}>
                  {ok ? "✓" : now ? "•" : ""}
                </span>
                <div className="flex-1 text-left">
                  <b>
                    {c.b}{" "}
                    {c.req && <span className="src req">Required</span>}
                  </b>
                  <span>{c.s}</span>
                </div>
                <span className="st">{ok ? "Done" : now ? "Now" : "Waiting"}</span>
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}

/**
 * One document row.
 *
 * A label wrapping a hidden file input, so the whole pill is a real click
 * target on a phone and the browser's own picker does the work. `capture`
 * is what makes an iPhone open the camera instead of the photo library,
 * which is the entire point of the live photo and the face turn.
 */
function Upload({
  label, hint, accept, doc, docs, onFile, capture, cta = "Choose file",
}: {
  label: string;
  hint: string;
  accept: string;
  doc: DocType;
  docs: Record<string, DocState>;
  onFile: (d: DocType, f: File) => void;
  capture?: "user" | "environment";
  cta?: string;
}) {
  const st = docs[doc]?.state ?? "idle";
  const cur = docs[doc];
  return (
    <div className={"upl" + (st === "done" ? " done" : st === "error" ? " bad" : "")}>
      <div className="uplb">
        <b>{st === "done" ? `✓ ${label}` : label}</b>
        <span>
          {st === "busy" ? "Sending…"
            : st === "done" ? `${cur?.file} · ${kb(cur?.bytes)} · stored`
            : st === "error" ? cur?.error
            : hint}
        </span>
      </div>
      <label className="upbtn">
        {st === "busy" ? "Sending…" : st === "done" ? "Replace" : cta}
        <input
          type="file"
          accept={accept}
          capture={capture}
          disabled={st === "busy"}
          onChange={(e) => {
            const f = e.target.files?.[0];
            // Clear the input so choosing the same file twice still fires.
            e.target.value = "";
            if (f) onFile(doc, f);
          }}
        />
      </label>
    </div>
  );
}
