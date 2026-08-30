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
 * There is no vetting record beside the form any more (founder instruction,
 * 30 Aug 2026). What it needed is still tracked, and what is still missing is
 * said once on the send screen rather than counted at you throughout.
 *
 * The application id and upload token are kept in localStorage. A tradesperson
 * filling this in on a phone, on Jamaican mobile data, will lose the tab. They
 * should not lose the passport they already sent.
 *
 * Step 3's two identity rows are NOT file inputs. They open the camera on this
 * page, because the step claims a live photo and a live turn and a file input
 * cannot deliver either on a desktop browser. See LiveCapture at the bottom of
 * this file, including what it does not prove.
 *
 * THE STANDING RULE FOR THIS FILE. Nothing here may describe a check the code
 * does not perform. Two labels broke it and both were found by the founder
 * rather than by us: a button reading "Record" that opened a folder, and a
 * vetting-record row reading "Documents machine-read" that ticked because the
 * application had been sent, not because anything had been read. A page whose
 * entire subject is evidence cannot afford a single ornamental claim.
 *
 * THE ID CHECK IS PERSONA'S NOW (30 Aug 2026, founder decision). LiveCapture
 * below was honest about its ceiling from the day it shipped: a browser
 * camera is not proof of life, and anything stronger is a liveness vendor.
 * Persona is that vendor. When it is configured, step 3 opens Persona's flow
 * for the government ID and selfie, the images go to Persona rather than into
 * our bucket, and what we store is the inquiry id and the status OUR SERVER
 * confirmed against Persona's API. The browser's claim of "complete" is never
 * what ticks the row: the server's answer is.
 *
 * Step 3 is ENTIRELY Persona's when it runs (founder decision, 30 Aug 2026):
 * the steps inside that window are the steps configured on the Persona
 * template, and this page adds no document rows of its own next to it. So
 * what step 3 asks for is edited in the Persona dashboard, not here.
 *
 * LiveCapture and the upload rows are not deleted. They are the fallback,
 * for three real cases: Persona env vars unset (safe to deploy before the
 * account is wired), Persona's script refusing to load on a thin connection,
 * and Persona erroring mid-flow. The fallback says it is the fallback, on
 * the row, in words, and it asks for the full document set (ID, live photo,
 * face turn, TRN, proof of address) because in that case nobody else is
 * collecting them.
 */

const FN = "yaad-vetting-upload";
const STORE = "yaadly.application.v1";
const GUIDELINES_VERSION = "v1";

// Persona, the identity vendor. Both values are public by design (they name a
// template and an environment, they authorise nothing) and both are inlined at
// build time. Unset means the legacy in-page capture runs instead, so this is
// safe to deploy before the Persona account is wired up.
/* The Yaadly WhatsApp Business sender, and the opener that puts the webhook
   into its worker lane rather than treating the message as a job. */
const WA_JOIN =
  "https://wa.me/447878877567?text=" +
  encodeURIComponent("Hello Yaadly, I am a tradesperson and I want to join.");

const PERSONA_TEMPLATE_ID = process.env.NEXT_PUBLIC_PERSONA_TEMPLATE_ID ?? "";
const PERSONA_ENVIRONMENT_ID = process.env.NEXT_PUBLIC_PERSONA_ENVIRONMENT_ID ?? "";
const PERSONA_CONFIGURED = PERSONA_TEMPLATE_ID.length > 0 && PERSONA_ENVIRONMENT_ID.length > 0;

// Bump this whenever the wording of the AI review choice changes. A consent is
// only worth anything tied to the sentence that earned it, and an old consent
// must not be read as agreement to a newer, broader one.
//
// v2, 30 Aug 2026. v1 asked permission to send identity documents to NVIDIA's
// model, and until today that is what happened. It does not any more: the ID,
// the selfie and the face video are withheld in yaad-vetting-review whatever
// the applicant chose. The choice now covers the supporting paperwork only.
// v2 is strictly narrower than v1, so every existing v1 consent still covers
// what is done under v2. Bumping anyway, because the sentence changed and a
// consent is tied to its sentence.

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

type Phase = 1 | 2 | 3;
type Step = { n: string; h: string; p: string; body: BodyKind; note: string; phase: Phase };

/* The three phases, founder's own design (30 Aug 2026). The order matters
   more than the labels: Phase 1 is the whole first sitting and it is short
   on purpose, so the desk sees a live applicant while they are still warm.
   Phase 2 is what a person asks for after saying yes. Phase 3 is a state
   the account is in, not a form anybody fills in.

   The step rail that used to sit above this was removed on the founder's
   instruction: a list of nine things still to do is a reason to close the
   tab, and it was the first thing anybody saw. */
const PHASES: Record<Phase, { name: string; sub: string }> = {
  1: { name: "Phase 1 · Your profile",
       sub: "About two minutes. This is the whole first sitting, and it goes to a person as soon as you send it." },
  2: { name: "Phase 2 · Trust and verification",
       sub: "After a person has said yes. We chase these on WhatsApp, so you do not have to sit here for them." },
  3: { name: "Phase 3 · On the board",
       sub: "What your account can and cannot do once it is live." },
};
type BodyKind = "form" | "port" | "id" | "refs" | "sign" | "trial" | "live";

const STEPS: Step[] = [
{ phase: 1, n: "1 · Apply", body: "form",
    h: "Your trades, and every parish you cover",
    p: "Take as many trades as you actually do, and name one yourself if it is not on our list. Pick every parish you will travel to, a job in a parish you have not ticked never reaches you.",
    note: "Your trades and job types come from the same list a client picks from. That is the only reason a client's roofing job and your roofing profile can find each other at all." },
{ phase: 1, n: "2 · Your work", body: "port",
    h: "Show us the work, however you have it",
    p: "A CV, a portfolio, a link to your site or socials, photos of finished jobs. <b>Any one of these is enough to start</b>, but the more you show the faster vetting moves. If you hold a certificate, upload it, we verify it with the body that issued it, not just look at the picture.",
    note: "We accept CVs. Plenty of good tradespeople have one and nobody has ever asked them for it." },
{ phase: 2, n: "3 · Identity", body: "id",
    h: "A live photo and a live video, taken on this page",
    p: "Government photo ID, then a <b>photo this page takes through your camera</b>, and a <b>short video where you turn your face slowly left to right</b>. Both are captured here, in front of us, rather than picked from your files. Then your TRN and proof of address dated within three months.",
    note: "A file proves somebody holds a document. A turn taken in front of us proves somebody was sitting there when it was sent. If your browser will not hand over a camera we say so on the row, take an upload instead, and a person checks that one by hand." },
{ phase: 2, n: "5 · References", body: "refs",
    h: "Three people who know we are calling",
    p: "Past clients, or trades you have worked alongside. We phone them, an emailed reference is a form somebody filled in. <b>You must confirm each one has been told we will call.</b> If we ring and they have no idea who we are, that is not a reference, and it does not count.",
    note: "This rule exists because a name on a form is not a referee. Somebody who was never asked cannot vouch for you, and putting them down is a mark against the application, not a neutral." },
{ phase: 3, n: "7 · Sign", body: "sign",
    h: "The Worker Guidelines, signed once",
    p: "How quoting works, what evidence you owe on every job, how you get paid, and what loses you the platform. You sign the current version once, not once per job. If the wording is ever revised you are asked to sign the new version before your next job.",
    note: "Written with a timestamp and the exact consent sentence. No edit, no delete." },
{ phase: 3, n: "8 · Trial job", body: "trial",
    h: "One job with an independent reviewer, at our cost",
    p: "Your first job carries an independent reviewer on site, paid for by Yaadly, not by you and not by the client. They record what they see against the same evidence standard you will be held to afterwards.",
    note: "It is the only way to know the standard holds on a real site rather than in an application form." },
{ phase: 3, n: "9 · Send it", body: "live",
    h: "Send it, and the desk picks it up",
    p: "Nothing you have filled in has reached a person yet. Sending it hands the whole file to the Yaadly desk in one piece: your trades, your parishes, every document, your three referees and your signature.",
    note: "Free to join, free to quote, win or lose. The one charge is 12% of your labour price on a completed job." },
];

/* ── what the desk still needs ────────────────────────────────────────────
   This was the vetting record, a ticking checklist beside the form. It was
   removed on the founder's instruction: a running tally of what you have not
   done yet is a discouraging thing to sit next to while you are doing it.

   The list itself stays, because the rows marked req still drive the honest
   "still outstanding" line on the send screen. It is now stated once, at the
   end, instead of watched throughout. Each entry ticks when the thing is
   actually true, never when a step has merely been scrolled past. */
type Check = { k: string; b: string; s: string; req?: boolean };
const CHECKS: Check[] = [
  { k: "form",   b: "Trades and parishes set", s: "From the same list clients pick from" },
  { k: "port",   b: "CV, portfolio or links",  s: "Any one of them is enough to start" },
  { k: "id",     b: "Government photo ID",     s: "Live photo and a left-to-right video turn" },
  { k: "id2",    b: "TRN verified",            s: "Matched to the name on the ID" },
  { k: "id3",    b: "Proof of address",        s: "Dated within three months" },
  { k: "refs",   b: "3 references, confirmed and called", s: "Each one told in advance that we would call", req: true },
  { k: "sign",   b: "Worker Guidelines signed", s: "The current version, once" },
  { k: "trial",  b: "Trial job reviewed",      s: "Independent reviewer on site, at our cost" },
  { k: "live",   b: "Profile published",       s: "You are on the board" },
];

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

  // Step 3. Deliberately starts empty rather than defaulting to "yes": consent
  // that was pre-ticked is not consent, and a passport is not the document to
  // be casual about it with.

  // The Persona ID check. "done" means OUR SERVER recorded the inquiry, and
  // `verified` is the server's word after asking Persona's API, never the
  // browser's. `fallback` is the reason the in-page capture is running
  // instead, and empty means it is not.
  const [persona, setPersona] = useState<{
    state: "idle" | "opening" | "open" | "saving" | "done" | "error";
    inquiryId?: string; status?: string; verified?: boolean; error?: string;
  }>({ state: "idle" });
  const [personaFallback, setPersonaFallback] = useState("");

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
        // Only a recorded check is worth restoring. A modal that was open when
        // the tab died was nothing yet, and restoring "error" would show a
        // stale complaint about a connection that may be fine now.
        if (v.persona?.state === "done" && v.persona?.inquiryId) setPersona(v.persona);
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
    (next: Partial<{
      claim: Claim;
      docs: Record<string, DocState>;
      persona: { state: "done"; inquiryId: string; status?: string; verified?: boolean };
    }>) => {
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

  /* ── the Persona ID check ──────────────────────────────────────────── */

  // Configured, and not fallen back. The fallback is one-way for the life of
  // the page: a vendor that failed once on this connection does not get to
  // flap between "checked by Persona" and "upload a file" while somebody is
  // half way through.
  const personaActive = PERSONA_CONFIGURED && !personaFallback;

  async function recordPersona(inquiryId: string, flowStatus: string) {
    setPersona({ state: "saving", inquiryId, status: flowStatus });
    try {
      const c = await ensureApplication();
      const d = await call({
        action: "persona",
        applicationId: c.applicationId, uploadToken: c.uploadToken,
        inquiryId,
      });
      // The row shows the SERVER's answer. The flow's own "complete" is what
      // the browser said, and the browser is not the one we believe.
      const next = {
        state: "done" as const, inquiryId,
        status: String(d.status ?? flowStatus),
        verified: d.verified === true,
      };
      setPersona(next);
      remember({ persona: next });
    } catch (e) {
      setPersona({
        state: "error", inquiryId, status: flowStatus,
        error: e instanceof Error
          ? e.message
          : "The check finished but did not record. Nothing is lost. Record it again.",
      });
    }
  }

  /* The check rides on the application: the application id is Persona's
     reference-id, and without one there is nothing to tie the check to. So
     before step 1 is done the button's job is to take you to step 1, in
     words, not to fail into a small red line at the bottom of the panel.
     That exact failure shipped and was found by the founder: "I click on
     the link in step 3 and it takes me nowhere." */
  const personaNeedsStep1 = !claim && !step1Ready;

  async function startPersona() {
    setError("");
    setPersona({ state: "opening" });
    let c: Claim;
    try { c = await ensureApplication(); }
    catch (e) {
      // On the row, in red, where the person who clicked is looking. The
      // page-bottom error line is below the fold on a phone.
      setPersona({
        state: "error",
        error: e instanceof Error ? e.message : "Could not start your application.",
      });
      return;
    }
    // If Persona has said nothing after twenty seconds, stop waiting and say
    // so. Without this, a blocked script (an ad blocker is the usual culprit)
    // leaves the button reading "Opening…" forever, which is indistinguishable
    // from a button that does nothing.
    window.setTimeout(() => {
      setPersona((p) => {
        if (p.state !== "opening") return p;
        // A side effect inside an updater is normally wrong; here it is the
        // only place that knows the state is still "opening", and setting the
        // same fallback string twice under StrictMode is harmless.
        setPersonaFallback("Persona did not answer after twenty seconds. An ad blocker or the connection may be stopping it.");
        return { state: "idle" };
      });
    }, 20000);
    try {
      const { Client } = await import("persona");
      const client = new Client({
        templateId: PERSONA_TEMPLATE_ID,
        // Persona's dashboard shows environments by name, not id, so the env
        // var accepts either: a real "env_..." id, or the words "sandbox" /
        // "production", which ride the client's environment option instead.
        ...(PERSONA_ENVIRONMENT_ID.startsWith("env_")
          ? { environmentId: PERSONA_ENVIRONMENT_ID }
          : { environment: PERSONA_ENVIRONMENT_ID as "sandbox" | "production" }),
        // The application id rides along as Persona's reference-id, and the
        // server refuses to record any inquiry whose reference does not match
        // the application claiming it. That is what stops a passing inquiry
        // being pasted onto somebody else's application.
        referenceId: c.applicationId,
        onReady: () => {
          setPersona((p) => (p.state === "opening" ? { state: "open" } : p));
          client.open();
        },
        onComplete: ({ inquiryId, status }) => { void recordPersona(inquiryId, status); },
        onCancel: () => setPersona((p) => (p.state === "done" ? p : { state: "idle" })),
        onError: (err) => {
          // Persona refusing to run is the moment the fallback earns its keep.
          // The row says why, in the vendor's own words, and the in-page
          // capture takes over for the rest of this visit.
          setPersonaFallback(`Persona could not run here${err?.code ? ` (${err.code})` : ""}.`);
          setPersona({ state: "idle" });
        },
      });
    } catch {
      setPersonaFallback("The Persona check would not load on this connection.");
      setPersona({ state: "idle" });
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
        // Unanswered goes over as "declined". The server treats it that way too,
        // but sending it explicitly means the row records a decision rather than
        // a gap somebody could later read either way.
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
    // Through Persona, the applicant's part is done when the server has the
    // inquiry recorded. Whether it PASSED is printed on the row rather than
    // hidden in the tick, and the desk decides the application either way.
    id: personaActive
      ? persona.state === "done"
      : has("photo_id") && has("selfie_with_id") && has("face_video"),
    id2: has("trn"),
    id3: has("proof_of_address"),
    refs: refsDone,
    sign: signed && signedName.trim().length > 1,
    trial: false,
    live: false,
  };

  const outstanding = CHECKS.filter((c) => c.req && !done[c.k]).map((c) => c.b);
  const d = STEPS[step];

  /* Step 3's heading is chosen at render time because the check it describes
     is chosen at render time. The static STEPS copy describes the in-page
     capture; when Persona is the path, saying "taken on this page" would be
     describing a check that is not running. */
  const shown = d.body === "id" && personaActive
    ? {
        ...d,
        h: "Your identity, checked by Persona",
        p: "One check, in a <b>secure window run by Persona</b>, the identity verification service. It walks you through its own steps: your government photo ID, then a selfie taken in front of the camera where you turn your head. Everything you hand over in that window goes to Persona, not into our document store.",
        note: "Persona tells our server what it found, and a person at Yaadly still decides your application. If the check will not run on your connection, the page takes uploads and an in-page capture instead and says so on the row.",
      }
    : d;

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
            <b className="text-ink">A person at the Yaadly desk reads every page
            from cold</b>, then telephones your referees. That is the part
            nothing automates, and it is the reason a client believes the badge
            on your profile. Nothing about your documents is sent outside
            Yaadly. Allow <b className="text-ink">within 48 hours</b>.
          </p>
          <p className="mt-3">
            You will hear back on the phone number and email you gave us. Quote{" "}
            <span className="font-mono text-ink">{sentRef}</span> if you contact
            us first.
          </p>
        </div>
        <p className="mt-4 max-w-[62ch] text-[12.5px] leading-relaxed text-dim">
          {persona.state === "done" ? (
            <>Your ID and selfie are held by Persona, the identity service that
            ran your check, under Yaadly&rsquo;s account there. Every document
            you uploaded here sits in a private store no browser can reach, and
            is destroyed ninety days after you sent it, whatever we decide.
            What survives is the decision, not your passport.</>
          ) : (
            <>Your identity documents sit in a private store no browser can
            reach, and they are destroyed ninety days after you sent them,
            whatever we decide. What survives is the decision, not your
            passport.</>
          )}
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

      {claim && (
        <p className="mt-2 text-[12px] text-dim">
          Saved as <span className="font-mono text-mute">{claim.reference}</span>.
          You can close this and come back on the same phone.
        </p>
      )}

      {/* The WhatsApp door. Most of the supply side is on a phone, on
          WhatsApp, and a form on a website is a worse door than the chat they
          are already in. The prefill is not decoration: the webhook classifies
          the opening message, and this wording is covered by the test that
          keeps worker sign-ups apart from clients asking FOR a tradesperson.

          The number is deliberately not printed. It is a WhatsApp Business
          sender, so anybody who reads it as a phone number and rings it
          reaches nobody. */}
      {!claim && (
        <a
          href={WA_JOIN}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-5 flex flex-wrap items-center gap-4 rounded-2xl border border-softline bg-soft p-4 no-underline transition hover:border-teal sm:p-5"
        >
          <span className="grid h-11 w-11 flex-none place-items-center rounded-xl bg-[#25D366]">
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="#04211D"
                 strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 12a8 8 0 0 1-8 8H7l-4 3 1.2-4.2A8 8 0 1 1 21 12Z" />
            </svg>
          </span>
          <span className="min-w-[210px] flex-1">
            <b className="block text-[15.5px] text-ink">Rather do this on WhatsApp?</b>
            <span className="mt-0.5 block text-[13px] leading-relaxed text-mute">
              Answer five short questions in the chat, one at a time, and send a
              photo of a finished job. Patois or English. Your ID check comes
              back to you on WhatsApp too.
            </span>
          </span>
          <span className="whitespace-nowrap font-bold text-tealb">Open WhatsApp &rarr;</span>
        </a>
      )}

      <div className="jlane">
        <div>
          <div className="jhead">
            {/* The phase, not a running count. "Step 4 of 9" tells somebody
                on a phone how much is left and nothing about why, and the
                founder's design groups this work into three sittings rather
                than one long climb. */}
            <span className="jbadge">{PHASES[d.phase].name}</span>
            <p className="mt-2 max-w-[58ch] text-[12.5px] leading-relaxed text-dim">
              {PHASES[d.phase].sub}
            </p>
            <h2 className="font-display text-[clamp(22px,3.4vw,32px)] uppercase leading-none">
              {shown.h}
            </h2>
            <p
              className="mt-3 max-w-[62ch] text-[14.5px] leading-relaxed text-mute"
              dangerouslySetInnerHTML={{ __html: shown.p }}
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
                {personaActive ? (
                  <div className={"upl" + (persona.state === "done" ? " done" : persona.state === "error" ? " bad" : "")}>
                    <div className="uplb">
                      <b>
                        {persona.state === "done"
                          ? `✓ ${persona.verified ? "ID verified by Persona" : "ID check recorded"}`
                          : "Government ID and a live selfie, with Persona"}
                      </b>
                      <span>
                        {persona.state === "opening" ? "Opening the Persona window…"
                          : persona.state === "open" ? "The Persona window is open. Finish the check there."
                          : persona.state === "saving" ? "Recording the check with our server…"
                          : persona.state === "done"
                            ? (persona.verified
                                ? "Our server confirmed it with Persona. Your ID stays with Persona, not in our files."
                                : `Persona has it as "${persona.status || "unchecked"}". A person at the desk resolves it.`)
                          : persona.state === "error" ? persona.error
                          : personaNeedsStep1
                            ? "The check is tied to your application, so step 1 comes first: your name, phone, email, trades and parishes."
                          : "Opens a secure window run by Persona, the identity service. Your ID and selfie go to Persona, not into our files."}
                      </span>
                    </div>
                    {persona.state === "error" && persona.inquiryId ? (
                      // The check itself finished; only OUR record of it failed.
                      // Re-recording asks the server again. It does not make
                      // anybody hold their passport up twice.
                      <button type="button" className="upbtn"
                        onClick={() => { const { inquiryId, status } = persona; void recordPersona(inquiryId!, status ?? ""); }}>
                        Record it again
                      </button>
                    ) : personaNeedsStep1 && (persona.state === "idle" || persona.state === "error") ? (
                      // Nothing can start yet, so the button goes to the thing
                      // that can: it must never fail into silence.
                      <button type="button" className="upbtn" onClick={() => setStep(0)}>
                        Finish step 1 first
                      </button>
                    ) : (
                      <button type="button" className="upbtn"
                        disabled={persona.state === "opening" || persona.state === "open" || persona.state === "saving"}
                        onClick={() => void startPersona()}>
                        {persona.state === "done" ? "Run it again"
                          : persona.state === "idle" ? "Start the ID check"
                          : persona.state === "error" ? "Try again"
                          : "Opening…"}
                      </button>
                    )}
                  </div>
                ) : (
                  <>
                    {personaFallback && (
                      <p className="rounded-xl border border-softline bg-soft px-4 py-2.5 text-[12px] leading-relaxed text-mute">
                        <b className="text-ink">The Persona check is not running on this visit.</b>{" "}
                        {personaFallback} The in-page capture below stands in, and a
                        person at the desk checks it by hand.
                      </p>
                    )}
                    <Upload label="Government photo ID" hint="Passport, driver's licence or national ID"
                      accept={PAPERS} doc="photo_id" docs={docs} onFile={upload} />
                    <LiveCapture kind="photo" label="A live photo, with your ID beside your face"
                      doc="selfie_with_id" docs={docs} onFile={upload} />
                    <LiveCapture kind="video" label="A short video, face left to right" seconds={10}
                      doc="face_video" docs={docs} onFile={upload} />
                    <Upload label="Your TRN" hint="Matched to the name on the ID"
                      accept={PAPERS} doc="trn" docs={docs} onFile={upload} />
                    <Upload label="Proof of address" hint="Dated within the last three months"
                      accept={PAPERS} doc="proof_of_address" docs={docs} onFile={upload} />
                  </>
                )}

                <div className="rounded-xl border border-softline bg-soft px-4 py-3 text-[12.5px] leading-relaxed text-mute">
                  {personaActive ? (
                    <>
                      <b className="text-ink">Where your ID goes.</b> Everything
                      inside the Persona window is held by Persona under
                      Yaadly&rsquo;s account there. What our own records keep is
                      the result of the check, not the images. Files you upload on
                      the other steps go into a private store no browser can
                      reach, and are destroyed ninety days after you send them.
                    </>
                  ) : (
                    <>
                      <b className="text-ink">Where these files go.</b> They upload
                      straight into a private store that no browser can reach. They
                      are destroyed ninety days after you send them, whatever we
                      decide, and what we keep forever is the decision, not your
                      passport.
                    </>
                  )}
                </div>

              </div>
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
                    <b className="text-ink">A person at the Yaadly desk</b> opens
                    the file and telephones your referees. Nothing about your
                    documents is sent outside Yaadly.{" "}
                    <b className="text-ink">You hear back within 48 hours.</b>
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

          <p className="mt-3 text-[12.5px] leading-relaxed text-dim">{shown.note}</p>

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

      </div>
    </>
  );
}

/**
 * A photo or a video taken here, on this page, through the camera.
 *
 * WHY THIS EXISTS AT ALL.
 *
 * Step 3 said "a live photo and a live video, not an upload" over two file
 * inputs carrying `capture="user"`. That attribute is a hint, nothing more.
 * An iPhone honours it and opens the camera. Every desktop browser ignores it
 * completely and opens the file picker, so the button that read "Record"
 * opened a folder, and the hint that read "taken in the moment, not from your
 * camera roll" took you directly to the camera roll. The strongest promise on
 * the page was the one nothing enforced.
 *
 * It also mattered more than the wording. The turn is what separates this
 * application from a form: an uploaded file proves somebody holds a document,
 * a turn recorded in front of us proves somebody was sitting there. Rewording
 * the step would have been honest and would have thrown that away.
 *
 * So the camera is opened directly, with getUserMedia and MediaRecorder, and
 * there is no file input on these two rows at all while it works. Not being
 * able to reach the camera roll is the feature.
 *
 * WHAT THIS DOES NOT PROVE, so that nobody writes copy claiming it does.
 *
 * A browser camera is not proof of life. Virtual camera software can feed a
 * recording into getUserMedia and this code cannot tell. What it does buy is
 * real and worth having: the picture was made on this page during this
 * application rather than found somewhere, and a still photograph of a
 * photograph cannot perform a turn on demand. That is the ceiling. Anything
 * stronger is a liveness vendor, and until one is bought the wording on the
 * step must stay inside this paragraph.
 *
 * WHEN THE CAMERA IS REFUSED.
 *
 * Permission denied, no camera, an old browser, another app holding the
 * device. It falls back to an upload, and the moment it does the row says so
 * in those words. A silent fallback would rebuild the exact lie this replaces:
 * a control that says live and behaves like a folder.
 */

/* mp4 first, because Safari records mp4 and plays webm badly. The bare type is
   what gets sent: the recorder hands back "video/webm;codecs=vp8" and the
   bucket's allow-list is an exact match on "video/webm". */
const VIDEO_TRY = ["video/mp4", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
const EXT_OF: Record<string, string> = { "video/mp4": "mp4", "video/webm": "webm" };
const bare = (m: string) => m.split(";")[0].trim().toLowerCase();

function pickVideoType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  for (const t of VIDEO_TRY) if (MediaRecorder.isTypeSupported(t)) return t;
  return "";
}

/** Say which thing went wrong, in the words of the thing that went wrong. */
function camReason(e: unknown): string {
  const n = (e as { name?: string })?.name ?? "";
  if (n === "NotAllowedError" || n === "PermissionDeniedError")
    return "The camera was blocked, either by you or by a browser setting.";
  if (n === "NotFoundError" || n === "DevicesNotFoundError")
    return "This device has no camera the browser can see.";
  if (n === "NotReadableError" || n === "TrackStartError")
    return "Another app is already holding the camera.";
  if (n === "SecurityError")
    return "The browser will only open a camera on a secure connection.";
  if (n === "OverconstrainedError")
    return "The camera on this device would not run at the size asked for.";
  return "The browser would not open the camera.";
}

const stamp = () => new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

type CamPhase = "idle" | "opening" | "live" | "counting" | "blocked";

function LiveCapture({
  kind, label, doc, docs, onFile, seconds = 10,
}: {
  kind: "photo" | "video";
  label: string;
  doc: DocType;
  docs: Record<string, DocState>;
  onFile: (d: DocType, f: File) => void;
  seconds?: number;
}) {
  const [phase, setPhase] = useState<CamPhase>("idle");
  const [why, setWhy] = useState("");
  const [left, setLeft] = useState(seconds);

  const videoEl = useRef<HTMLVideoElement | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const tick = useRef<number | null>(null);
  const cutoff = useRef<number | null>(null);

  /* Stopping the camera's tracks also stops the recorder, so onstop fires
     whether the recording was finished or abandoned. Without this flag,
     "Close the camera" halfway through a turn, or walking off the step, would
     quietly upload the half of it that had been captured. Abandoning something
     must throw it away. */
  const abandoned = useRef(false);

  const st = docs[doc]?.state ?? "idle";
  const cur = docs[doc];

  /** Let go of the camera. The light staying on after a capture is the fastest
   *  way to lose somebody's trust on a page that just asked for their passport. */
  const release = useCallback(() => {
    if (tick.current !== null) { clearInterval(tick.current); tick.current = null; }
    if (cutoff.current !== null) { clearTimeout(cutoff.current); cutoff.current = null; }
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    if (videoEl.current) videoEl.current.srcObject = null;
  }, []);

  /** Give up on whatever is running and keep none of it. */
  const abandon = useCallback(() => {
    abandoned.current = true;
    const r = rec.current;
    if (r && r.state !== "inactive") r.stop();
    release();
  }, [release]);

  // Leaving step 3, or the tab, hands the camera back and keeps nothing.
  useEffect(() => abandon, [abandon]);

  // The <video> does not exist until the phase says it does, so the stream is
  // attached after the render that creates it, not when it arrives.
  useEffect(() => {
    const v = videoEl.current;
    if (v && stream.current && v.srcObject !== stream.current) {
      v.srcObject = stream.current;
      v.play().catch(() => { /* autoplay refusals are survivable, the frame is there */ });
    }
  }, [phase]);

  async function openCamera() {
    setWhy("");
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setPhase("blocked");
      setWhy("This browser will not give a web page a camera at all.");
      return;
    }
    if (kind === "video" && !pickVideoType()) {
      setPhase("blocked");
      setWhy("This browser can show a camera but cannot record from one.");
      return;
    }
    setPhase("opening");
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      setPhase("live");
    } catch (e) {
      release();
      setPhase("blocked");
      setWhy(camReason(e));
    }
  }

  function snap() {
    const v = videoEl.current;
    if (!v) return;
    const w = v.videoWidth || 1280;
    const h = v.videoHeight || 720;
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d");
    if (!ctx) { setPhase("blocked"); setWhy("The browser would not draw the frame."); return; }
    ctx.drawImage(v, 0, 0, w, h);
    c.toBlob((b) => {
      if (!b) { setPhase("blocked"); setWhy("The browser would not turn the frame into a file."); return; }
      release();
      setPhase("idle");
      onFile(doc, new File([b], `live-photo-${stamp()}.jpg`, { type: "image/jpeg" }));
    }, "image/jpeg", 0.9);
  }

  function endRecording() {
    if (tick.current !== null) { clearInterval(tick.current); tick.current = null; }
    if (cutoff.current !== null) { clearTimeout(cutoff.current); cutoff.current = null; }
    const r = rec.current;
    if (r && r.state !== "inactive") r.stop();
  }

  function startRecording() {
    const s = stream.current;
    if (!s) return;
    const want = pickVideoType();
    let r: MediaRecorder;
    try {
      r = new MediaRecorder(s, want ? { mimeType: want } : undefined);
    } catch {
      release(); setPhase("blocked");
      setWhy("The browser refused to start a recording from its own camera.");
      return;
    }
    chunks.current = [];
    abandoned.current = false;
    r.ondataavailable = (e) => { if (e.data && e.data.size) chunks.current.push(e.data); };
    r.onstop = () => {
      if (abandoned.current) { chunks.current = []; release(); return; }
      const type = bare(r.mimeType || want || "video/webm");
      const blob = new Blob(chunks.current, { type });
      release();
      if (!blob.size) {
        setPhase("blocked");
        setWhy("The recording came back with nothing in it.");
        return;
      }
      setPhase("idle");
      onFile(doc, new File([blob], `face-turn-${stamp()}.${EXT_OF[type] ?? "webm"}`, { type }));
    };
    rec.current = r;
    r.start();
    setLeft(seconds);
    setPhase("counting");
    tick.current = window.setInterval(() => setLeft((n) => Math.max(0, n - 1)), 1000);
    cutoff.current = window.setTimeout(endRecording, seconds * 1000);
  }

  /* ── the camera is not available: say the word upload, on the row ───── */

  if (phase === "blocked") {
    return (
      <div className="grid gap-2">
        <Upload
          label={label}
          hint={kind === "photo"
            ? "Choose a recent photo of your face. A person checks this one."
            : "Choose a video of your face turning left to right. A person watches this one."}
          accept={kind === "photo" ? IMAGES : VIDEOS}
          capture="user"
          cta="Choose file"
          doc={doc} docs={docs} onFile={onFile}
        />
        <p className="rounded-xl border border-softline bg-soft px-4 py-2.5 text-[12px] leading-relaxed text-mute">
          <b className="text-ink">This row is an upload, not a live capture.</b>{" "}
          {why} We are not going to put the word live on a button that opens a
          folder, so it says what it does. A person at the desk checks this one
          by hand instead, which is slower and no worse.{" "}
          <button type="button" onClick={() => { setPhase("idle"); setWhy(""); }}
            className="font-bold text-tealb underline underline-offset-4">
            Try the camera again
          </button>
        </p>
      </div>
    );
  }

  /* ── the camera is open ────────────────────────────────────────────── */

  if (phase === "live" || phase === "counting") {
    return (
      <div className="grid gap-2 rounded-xl border border-teal/40 bg-bg p-3">
        <div className="flex items-center gap-2">
          <b className="flex-1 text-[13.5px]">{label}</b>
          <span className="text-[11.5px] font-bold text-tealb">
            {phase === "counting" ? `Recording · ${left}s left` : "Camera open"}
          </span>
        </div>
        {/* Not mirrored on purpose. A mirrored preview shows a held-up ID
            backwards, and what you see here is exactly the frame that is sent. */}
        <video ref={videoEl} muted playsInline autoPlay
          className="w-full rounded-lg bg-black"
          style={{ maxHeight: 300, objectFit: "cover" }} />
        <p className="text-[12px] leading-relaxed text-dim">
          {kind === "photo"
            ? "Hold your ID beside your face, both in frame and readable. What you see is exactly what is sent."
            : `Look straight in, then turn your face slowly left, then right. It stops itself after ${seconds} seconds.`}
        </p>
        <div className="flex flex-wrap gap-2">
          {kind === "photo" ? (
            <button type="button" className="upbtn" onClick={snap}>Take the photo</button>
          ) : phase === "counting" ? (
            <button type="button" className="upbtn" onClick={endRecording}>Stop and use it</button>
          ) : (
            <button type="button" className="upbtn" onClick={startRecording}>Start recording</button>
          )}
          <button type="button" className="upbtn"
            onClick={() => { abandon(); setPhase("idle"); }}>
            {phase === "counting" ? "Cancel and throw it away" : "Close the camera"}
          </button>
        </div>
      </div>
    );
  }

  /* ── nothing open yet, or a capture already taken ──────────────────── */

  return (
    <div className={"upl" + (st === "done" ? " done" : st === "error" ? " bad" : "")}>
      <div className="uplb">
        <b>{st === "done" ? `✓ ${label}` : label}</b>
        <span>
          {st === "busy" ? "Sending…"
            : st === "done" ? `${cur?.file} · ${kb(cur?.bytes)} · stored`
            : st === "error" ? cur?.error
            : kind === "photo"
              ? "Taken on this page through your camera, not chosen from your files"
              : `Taken on this page. ${seconds} seconds, turning your face left then right`}
        </span>
      </div>
      <button type="button" className="upbtn" disabled={st === "busy" || phase === "opening"}
        onClick={openCamera}>
        {st === "busy" ? "Sending…"
          : phase === "opening" ? "Opening…"
          : st === "done" ? "Take it again"
          : kind === "photo" ? "Open the camera" : "Open the camera"}
      </button>
    </div>
  );
}

/**
 * One document row.
 *
 * A label wrapping a hidden file input, so the whole pill is a real click
 * target on a phone and the browser's own picker does the work.
 *
 * `capture` is only a hint. iOS and most Android browsers honour it and open
 * the camera; every desktop browser ignores it and opens the file picker. So
 * it is used here for convenience and NEVER as the basis for a claim. Anything
 * that has to be taken live goes through LiveCapture above, which opens the
 * camera itself and admits it when it cannot.
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
