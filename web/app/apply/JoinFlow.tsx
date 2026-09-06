"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { TRADES, PARISHES, LAUNCH_PARISHES } from "@/lib/taxonomy";

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

/* Bump this whenever the wording of the AI review choice below changes. A
   consent is only worth the sentence that earned it, and an old consent must
   never be read as agreement to a newer or broader one.

   v1 asked permission to send identity documents to NVIDIA's model, and that
   is what happened until 30 Aug 2026.

   v2 narrowed it: the ID, the selfie and the face video are withheld in
   yaad-vetting-review whatever the applicant chose, so the question covered
   the supporting paperwork only. Its sentence named "your police record,
   proof of address, TRN, certificates and CV".

   v3, 3 Sep 2026, on the founder's instruction to put the question back after
   it was dropped from this page entirely. TWO REASONS FOR A NEW VERSION
   rather than reusing v2, neither of them cosmetic. The police record step no
   longer exists anywhere in this flow, so v2's sentence named a document
   nobody is asked for. And a profile photograph is now collected, which is a
   face: it is withheld like the selfie and named as withheld in the wording.
   v3 is strictly narrower than v2, so every v2 consent already covers
   everything done under v3, and the version still moves because the sentence
   moved. That rule is CLAUDE.md §6 and it is not a formality: the whole point
   of a version is that somebody can later ask what a given yes actually said.

   v4, 4 Sep 2026. ADDS NOTHING AND ASKS FOR NOTHING NEW. The only change is a
   link, in the trailing note, to yaadly.co.uk/how-we-use-ai, a public page
   published the same day that explains what the assistants do and what they
   can never do. Not one word of either option changed, so v4 is identical in
   substance to v3 and every v3 consent already covers everything done under
   v4.

   The version moves anyway, and that is the point of the rule rather than an
   exception to it. CLAUDE.md §6 says the wording and the version move
   together. If a link can be slipped in without a bump because it is "only a
   link", then so can a clause, and the next person deciding what counts as
   only a link is doing it without a rule. The cost of bumping for a hyperlink
   is one line here. The cost of the precedent is the whole mechanism.

   The list in the copy is the real one. It is what survives IDENTITY_DOCS in
   supabase/functions/yaad-vetting-review/index.ts, which is checked before the
   download so a withheld file is never even fetched out of the bucket. If that
   list changes, this sentence and this version change with it. */
const AI_CONSENT_VERSION = "ai-review-v4";

/* The wording that earns the showcase consent, versioned for the same reason
   AI_CONSENT_VERSION is: a consent is worth exactly what the sentence on
   screen said, so the copy in ShowcaseConsent below and this string move in
   the same commit. Change one without the other and every answer already on
   file quietly starts meaning something nobody agreed to. */
const SHOWCASE_CONSENT_VERSION = "showcase-v1";

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

/* TRADES and PARISHES are shared with the client funnel. See web/lib/taxonomy.ts. */

type Phase = 1 | 2;
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
       sub: "After a person has said yes. We chase these on WhatsApp, so you do not have to sit here for them. You hear back within 24 hours of your documents arriving." },
} as const;

/* Phase 3 in words, shown once on the last screen rather than as steps to
   walk. The decline wording is the founder's own, chosen 30 Aug, and it is
   never phrased as a strike, a warning or discipline: with a discrete
   contract per job there is no continuing relationship to discipline inside,
   so you decline to offer the next one. */
const ON_THE_BOARD = {
  probation:
    "Your account goes live in Probation. You can see the whole board and quote on standard jobs from the day you are approved.",
  topTier:
    "Jobs over £500, work inside an occupied home, and anything where you hold keys stay hidden until your telephoned references are done. That is most of the money on the board, so it is worth finishing.",
  standard:
    "We only keep working with people who meet the evidence standard. Fall short once and we stop sending work.",
};
type BodyKind = "form" | "port" | "id" | "refs" | "sign" | "live";

/* ── who should apply ─────────────────────────────────────────────────────
   This panel is the first thing on the page, above even the WhatsApp door.
   Before it existed the only way to find out whether you qualified was to
   fill in eighteen trade chips and see what happened.

   Every line is something that actually happens further down this flow or at
   the desk. The parishes are the fourteen in the shared taxonomy, the TRN is
   asked for on the identity screen, and the referees really are telephoned
   before the jobs over £500. Nothing here is aspirational. */
const WHO: { yes: string; why: string }[] = [
  { yes: "You do the work in Jamaica, in at least one of the fourteen parishes",
    why: "A job posted in a parish you have not ticked never reaches you." },
  { yes: "You work for yourself, or you can invoice for the work",
    why: "You are asked for a TRN later. It is how you are paid as your own business rather than as somebody's staff." },
  { yes: "You take at least one of the eighteen trades, or you can name your own",
    why: "Your trades come from the same list a client picks from. That is the only reason a client's roofing job and your roofing profile find each other." },
  { yes: "You are willing to be identity checked, and to have three referees telephoned",
    why: "The call happens before you can take work over £500. Nobody reaches a client's gate unverified." },
];

/* What it takes, split at the point a person says yes. Said before anybody
   types, so nobody starts on a phone and stalls hunting for a document that
   was never needed today. */
const NEED_NOW = [
  "Your name",
  "A phone number or an email address, either one",
  "The trades you take",
  "The parishes you will travel to",
];
const NEED_LATER = [
  "Government photo ID",
  "Your TRN, the nine digit number",
  "Proof of address dated within the last three months",
  "Three people who will vouch for you",
];

/* Upload limits, in one place and stated on every row that takes a file.
   50MB is the bucket's own cap in yaad-vetting-upload, and before this the
   only way an applicant on Jamaican mobile data learned about it was by
   failing at the end of a long upload. */
const MAX_MB = 50;


/* ── the two sittings ──────────────────────────────────────────────────────
   Phase 1 is the whole first visit and it is three screens: what you do,
   what you have done, send. That is about two minutes, and it is deliberate.
   The desk wants a live applicant while they are still warm, and a
   tradesperson on Jamaican mobile data will not climb nine screens to give
   somebody their passport before anybody has said they want them.

   Everything that asks for real trust comes AFTER a person has said yes,
   which is when it is reasonable to ask. It is chased on WhatsApp where
   possible, and reachable here from the confirmation screen for anybody who
   would rather do it in a browser. Nothing was deleted, it was moved to the
   point where it is earned. */
const PHASE1_STEPS: Step[] = [
{ phase: 1, n: "Your trades", body: "form",
    h: "Your trades, and every parish you cover",
    p: "Take as many trades as you actually do, and name one yourself if it is not on our list. Pick every parish you will travel to, a job in a parish you have not ticked never reaches you.",
    note: "Your trades and job types come from the same list a client picks from. That is the only reason a client's roofing job and your roofing profile can find each other at all." },
{ phase: 1, n: "Your work", body: "port",
    h: "Show us the work, however you have it",
    p: "A CV, a portfolio, a link to your site or socials, photos of finished jobs. <b>Any one of these is enough to start</b>, but the more you show the faster vetting moves. If you hold a certificate, upload it, we verify it with the body that issued it, not just look at the picture.",
    note: "We accept CVs. Plenty of good tradespeople have one and nobody has ever asked them for it." },
{ phase: 1, n: "Check and send", body: "live",
    h: "This is how a client will see you",
    p: "Check it reads the way you would say it yourself. <b>Nothing here is fixed</b>, you can change any of it later, and the badge and the score fill in as you complete jobs.",
    note: "Free to join, free to quote, win or lose. Your price is agreed with you per job, before you start." },
];

const LATER_STEPS: Step[] = [
{ phase: 2, n: "Identity", body: "id",
    h: "A live photo and a live video, taken on this page",
    p: "Government photo ID, then a <b>photo this page takes through your camera</b>, and a <b>short video where you turn your face slowly left to right</b>. Both are captured here, in front of us, rather than picked from your files. Then your TRN and proof of address dated within three months.",
    note: "A file proves somebody holds a document. A turn taken in front of us proves somebody was sitting there when it was sent. If your browser will not hand over a camera we say so on the row, take an upload instead, and a person checks that one by hand." },
{ phase: 2, n: "References", body: "refs",
    h: "Three people who will vouch for you",
    p: "Past clients, or trades you have worked alongside. Paste a WhatsApp message where they say what you did, or give a name and number. <b>Either is enough to get you on the board.</b> Before you can take the bigger jobs we telephone them, so tell them to expect a call.",
    note: "A forwarded message gets you moving today. The phone call happens before the jobs over £500, because a message can be written by anybody and a conversation cannot." },
{ phase: 2, n: "Sign the guidelines", body: "sign",
    h: "The Worker Guidelines, signed once",
    p: "How quoting works, what evidence you owe on every job, how you get paid, and what loses you the platform. You sign the current version once, not once per job. If the wording is ever revised you are asked to sign the new version before your next job.",
    note: "Written with a timestamp and the exact consent sentence. No edit, no delete." },
{ phase: 2, n: "Save it", body: "live",
    h: "Save what you have added",
    p: "Your application is already with the desk. This adds what you have just done to it: your ID check, your referees and your signature.",
    note: "Free to join, free to quote, win or lose. Your price is agreed with you per job, before you start." },
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
  { k: "refs",   b: "3 referees", s: "A message they sent, or a name and number we can call", req: true },
  { k: "sign",   b: "Worker Guidelines signed", s: "The current version, once" },
  { k: "live",   b: "Profile published",       s: "You are on the board" },
];

/* ── documents ─────────────────────────────────────────────────────────── */

type DocType =
  | "cv" | "portfolio" | "certificate"
  /* A photograph of the tradesperson themselves. Founder instruction,
     3 Sep 2026. It is a face, so it is held to the same rule as the selfie
     and the introduction video: it is on IDENTITY_DOCS in
     yaad-vetting-review and is never sent to a model. */
  | "profile_photo"
  | "photo_id" | "selfie_with_id" | "face_video" | "intro_video" | "trn" | "proof_of_address";

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
  /* The step heading, so advancing can move focus to it. Without this a screen
     reader user pressed Continue and heard nothing at all: focus stayed on a
     button that had just been replaced, the page swapped underneath, and the
     only signal that anything happened was visual. On the longest flow in the
     product, where somebody is being asked for a passport. */
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const firstRender = useRef(true);

  useEffect(() => {
    /* Not on arrival: stealing focus on first paint moves a keyboard user off
       the top of a page they have not read yet. Only on a real step change. */
    if (firstRender.current) { firstRender.current = false; return; }
    headingRef.current?.focus();
  }, [step]);

  // Step 1
  const [trades, setTrades] = useState<string[]>([]);
  const [parishes, setParishes] = useState<string[]>([]);
  const [tradeOther, setTradeOther] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [years, setYears] = useState("");
  /* Phase 2. The TRN is a nine digit number, and the number is what gets
     checked: an image of the card is a document to store, redact and destroy
     for no extra proof. It matters for two reasons that are not identity, it
     is one of the stronger signs somebody is a contractor rather than an
     employee, and a subcontractor raises an invoice against it. */
  const [trn, setTrn] = useState("");

  /* The AI review choice. Deliberately starts EMPTY rather than defaulting to
     either answer: a pre-ticked consent is not a consent, and the server reads
     anything that is not the word "granted" as a no. What was sent is kept
     separately so the sent screen reports the answer that actually went, not
     whatever the box says afterwards. */
  const [aiConsent, setAiConsent] = useState<"" | "granted" | "declined">("");
  const [showcaseConsent, setShowcaseConsent] = useState<"" | "granted" | "declined">("");
  const [sentConsent, setSentConsent] = useState<"granted" | "declined">("declined");

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

  // Step 5
  const [refs, setRefs] = useState([
    { name: "", phone: "", told: false, quote: "" },
    { name: "", phone: "", told: false, quote: "" },
    { name: "", phone: "", told: false, quote: "" },
  ]);

  // Step 7
  const [signed, setSigned] = useState(false);
  const [signedName, setSignedName] = useState("");

  /* A local preview of the photograph they just chose, so the profile preview
     on the last screen shows the actual picture rather than initials.

     It is an object URL and it lives for this page only. The file itself goes
     to a private bucket no browser can read, so there is nothing to read back
     after a reload, and the preview honestly falls back to initials with the
     row still saying the photograph is on file. Better that than a preview
     that shows something the page cannot actually fetch. */
  const [photoPreview, setPhotoPreview] = useState("");
  const photoUrlRef = useRef("");

  // Let go of the object URL on the way out. A leaked blob holds the whole
  // photograph in memory, on a phone.
  useEffect(() => () => { if (photoUrlRef.current) URL.revokeObjectURL(photoUrlRef.current); }, []);

  // Documents, and the application they hang off
  const [docs, setDocs] = useState<Record<string, DocState>>({});
  const [claim, setClaim] = useState<Claim | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sentRef, setSentRef] = useState("");
  /* Phase 1 is sent and they have chosen to carry straight on into the
     verification steps rather than wait to be chased. */
  const [continuing, setContinuing] = useState(false);
  /* The second sitting had no ending. Pressing "Send my application" on the
     last Phase 2 screen set sentRef, which the sent screen ignores while
     `continuing` is true, so the button simply sat there having apparently
     done nothing. This is that screen's own confirmation. */
  const [savedLater, setSavedLater] = useState(false);
  const claimRef = useRef<Claim | null>(null);
  /* Autosave must not run before the restore has finished, or the first
     render writes an empty form over the one being recovered. */
  const restored = useRef(false);

  /* Restore a half-finished application. Losing the tab on mobile data must
     not mean re-sending a passport, and it must not mean losing the paragraph
     you just typed either.
     
     WHAT THIS USED TO DROP, all of it found by mapping the flow rather than by
     anybody reporting it. It restored the claim, the documents and the profile
     fields, and dropped `step`, `refs`, `signed`, `signedName`, `continuing`
     and `sentRef`. So a worker halfway through the second sitting came back to
     screen one of the first, and because sending cleared the whole store there
     was no route back into the ID check at all: the only door to it is the
     button on the sent screen, and that screen needs the reference. */
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORE);
      if (!raw) { restored.current = true; return; }
      const v = JSON.parse(raw);

      // The form comes back whether or not an application was ever opened.
      // Autosave now writes on a debounce as they type, so there is something
      // to recover from before the first Continue was ever pressed.
      if (v.form) {
        setTrades(v.form.trades ?? []); setParishes(v.form.parishes ?? []);
        setTradeOther(v.form.tradeOther ?? ""); setName(v.form.name ?? "");
        setPhone(v.form.phone ?? ""); setEmail(v.form.email ?? "");
        setYears(v.form.years ?? "");
        setTrn(v.form.trn ?? ""); setWork(v.form.work ?? "");
        setLinks(v.form.links ?? []);
        if (v.form.showcaseConsent === "granted" || v.form.showcaseConsent === "declined") {
          setShowcaseConsent(v.form.showcaseConsent);
        }
        if (v.form.aiConsent === "granted" || v.form.aiConsent === "declined") {
          setAiConsent(v.form.aiConsent);
        }
        if (Array.isArray(v.form.refs) && v.form.refs.length === 3) setRefs(v.form.refs);
        setSigned(v.form.signed === true);
        setSignedName(v.form.signedName ?? "");
      }

      if (v?.claim?.applicationId && v?.claim?.uploadToken) {
        claimRef.current = v.claim;
        setClaim(v.claim);
        setDocs(v.docs ?? {});
        // Only a recorded check is worth restoring. A modal that was open when
        // the tab died was nothing yet, and restoring "error" would show a
        // stale complaint about a connection that may be fine now.
        if (v.persona?.state === "done" && v.persona?.inquiryId) setPersona(v.persona);
        // A sent application, and which sitting they were in. Both are only
        // meaningful with a claim behind them: "continuing" with no
        // application is a screen asking for a passport with nowhere to put it.
        if (v.sentRef) setSentRef(String(v.sentRef));
        if (v.sentConsent === "granted" || v.sentConsent === "declined") {
          setSentConsent(v.sentConsent);
        }
        if (v.continuing === true && v.sentRef) setContinuing(true);
      }

      // Last, because the step is an index into whichever sitting the two
      // lines above just chose.
      const at = Number(v.step);
      if (Number.isInteger(at) && at >= 0 && at < 8) setStep(at);
    } catch { /* a corrupt cache is not worth an error screen */ }
    finally { restored.current = true; }
  }, []);

  /* Everything worth keeping, in one shape, so the debounced autosave below
     and the explicit writes on an upload cannot disagree about what a
     half-finished application consists of. */
  const snapshot = useCallback(() => ({
    step,
    continuing,
    sentRef,
    sentConsent,
    form: {
      trades, parishes, tradeOther, name, phone, email, years, work, links, trn,
      refs, signed, signedName, aiConsent, showcaseConsent,
    },
  }), [step, continuing, sentRef, sentConsent, trades, parishes, tradeOther,
       name, phone, email, years, work, links, trn, refs, signed, signedName,
       aiConsent, showcaseConsent]);

  const remember = useCallback(
    (next: Partial<{
      claim: Claim;
      docs: Record<string, DocState>;
      persona: { state: "done"; inquiryId: string; status?: string; verified?: boolean };
    }>) => {
      try {
        const cur = JSON.parse(localStorage.getItem(STORE) ?? "{}");
        localStorage.setItem(STORE, JSON.stringify({ ...cur, ...snapshot(), ...next }));
      } catch { /* private browsing, carry on */ }
    },
    [snapshot],
  );

  /* Autosave, on a debounce, as they type.
  
     Before this, `remember` ran on exactly three events: the application being
     opened, a document landing, and a Persona check being recorded. So the
     paragraph somebody wrote in "in your own words, what do you do" survived
     only if they happened to upload a file afterwards, and the three referees
     and the signature were never written down at all.
  
     Nothing is written for a visitor who has only read the page: an empty
     store in somebody's browser is a thing to explain and nothing to recover. */
  useEffect(() => {
    if (!restored.current) return;
    const worthKeeping =
      claim !== null || name.trim() !== "" || trades.length > 0 || parishes.length > 0 ||
      phone.trim() !== "" || email.trim() !== "" || work.trim() !== "";
    if (!worthKeeping) return;
    const t = window.setTimeout(() => {
      try {
        const cur = JSON.parse(localStorage.getItem(STORE) ?? "{}");
        localStorage.setItem(STORE, JSON.stringify({ ...cur, ...snapshot() }));
      } catch { /* private browsing, carry on */ }
    }, 600);
    return () => window.clearTimeout(t);
  }, [snapshot, claim, name, trades, parishes, phone, email, work]);

  /* Throw the lot away, on purpose, and say what went. Offered next to the
     "saved on this phone" line, because a saved application somebody cannot
     clear is the same problem as one that will not save. */
  const startAgain = useCallback(() => {
    try { localStorage.removeItem(STORE); } catch { /* fine */ }
    window.location.reload();
  }, []);

  const toggle = (list: string[], set: (v: string[]) => void, v: string) =>
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  /* ── the application, opened once ───────────────────────────────────── */

  /* One way to reach somebody is enough to start, and it is their choice
     which one. Demanding a phone number AND an email address for a first
     contact is a gate with nothing behind it: a tradesperson who gives a
     number he answers has told us everything we need to ring him back.
     Years at the trade is not asked for here either. It is worth knowing and
     it is not worth losing an applicant over, so it stays on the form and out
     of the gate. */
  const hasPhone = phone.trim().length > 5;
  const hasEmail = /.+@.+\..+/.test(email.trim());
  const step1Ready =
    name.trim().length > 1 && (hasPhone || hasEmail) &&
    trades.length > 0 && parishes.length > 0;

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

      // After the finish call, not before it. A photograph that failed to
      // upload must never appear in the preview as though it had landed.
      if (docType === "profile_photo") {
        if (photoUrlRef.current) URL.revokeObjectURL(photoUrlRef.current);
        photoUrlRef.current = URL.createObjectURL(file);
        setPhotoPreview(photoUrlRef.current);
      }
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

  /* One line per referee for the desk, carrying whichever of the two the
     applicant actually gave. A pasted message is worth as much as a number
     for getting them on the board, and it is worth reading either way. */
  const refLine = (r: { name: string; phone: string; quote: string }) => {
    const who = `${r.name.trim()} ${r.phone.trim()}`.trim();
    const said = r.quote.trim();
    if (!who && !said) return "";
    if (!said) return who;
    return who ? `${who} — said: ${said}` : `Said: ${said}`;
  };

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
        trn: trn.replace(/\D/g, ""),
        ref1: refLine(refs[0]), ref2: refLine(refs[1]), ref3: refLine(refs[2]),
        refsTold: refs.every((r) => r.told),
        // Unanswered goes over as "declined". The server treats it that way too,
        // but sending it explicitly means the row records a decision rather than
        // a gap somebody could later read either way.
        signedName: signed ? signedName.trim() : "",
        signedVersion: GUIDELINES_VERSION,
        /* Unanswered goes over as the word "declined", not as a gap. The
           server reads a missing field the same way, but sending it explicitly
           means the row records a decision somebody made rather than a silence
           a later reader could take either way.

           THIS FIELD GOING MISSING IS WHY THE QUESTION WENT MISSING. When the
           consent UI was dropped from this page the submit stopped sending it,
           the server correctly read that as declined, and every application
           since has recorded a refusal nobody made. Do not remove one without
           removing the other. */
        aiReviewConsent: aiConsent || "declined",
        aiReviewConsentVersion: AI_CONSENT_VERSION,
        /* Same rule and the same trap as the line above: unanswered travels as
           the word "declined" so the row records a decision rather than a gap,
           and removing this field without removing the question would record a
           refusal nobody made. Nothing appears on a public profile until this
           says granted, and the check is in the view, not here. */
        showcaseConsent: showcaseConsent || "declined",
        showcaseConsentVersion: SHOWCASE_CONSENT_VERSION,
      });
      setSentConsent(aiConsent || "declined");
      setSentRef(c.reference);
      if (continuing) {
        // The second sitting is finished. There is nothing left to come back
        // to, so the store goes.
        setSavedLater(true);
        try { localStorage.removeItem(STORE); } catch { /* fine */ }
      } else {
        /* KEPT ON PURPOSE, and this is the fix for the worst hole in the flow.
           Clearing here destroyed the claim the instant the application was
           sent. The only door into the ID check is the button on the sent
           screen, and that button needs the application id and the upload
           token. So losing the tab between the two sittings made the second
           sitting unreachable: no reference, no token, nothing to attach a
           passport to, and no way to get back other than applying twice.
           `sentRef` is written explicitly because the state set a line above
           has not landed in the snapshot yet. */
        try {
          const cur = JSON.parse(localStorage.getItem(STORE) ?? "{}");
          localStorage.setItem(STORE, JSON.stringify({
            ...cur, ...snapshot(),
            sentRef: c.reference,
            sentConsent: aiConsent || "declined",
          }));
        } catch { /* private browsing, carry on */ }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not send. Try again.");
    } finally {
      setBusy(false);
    }
  }

  /* ── what is actually done ─────────────────────────────────────────── */

  const has = (t: DocType) => docs[t]?.state === "done";
  /* Founder ruling, 30 Aug: a forwarded WhatsApp message is enough for the
     Probation tier, so a referee counts when there is either a way to reach
     them or something they actually said. The phone call still happens before
     top tier, which is enforced at the publish gate rather than here. */
  const refsDone = refs.every((r) => (r.name.trim() && r.phone.trim()) || r.quote.trim());

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
    live: false,
  };

  const outstanding = CHECKS.filter((c) => c.req && !done[c.k]).map((c) => c.b);
  const STEPS = continuing ? LATER_STEPS : PHASE1_STEPS;
  const at = Math.min(Math.max(step, 0), STEPS.length - 1);
  const d = STEPS[at];

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

  /* ── the second sitting is saved ───────────────────────────────────── */

  /* This screen did not exist. Pressing "Send my application" on the last
     Phase 2 screen set sentRef, which the sent screen below ignores while
     `continuing` is true, so the button appeared to do nothing at all after
     somebody had just handed over their identity documents. */
  if (savedLater) {
    return (
      <>
        <p className="text-[10.5px] font-bold uppercase tracking-[.2em] text-mango">Saved</p>
        <h1 className="mt-2 font-display text-[clamp(28px,5vw,52px)] uppercase leading-[.95]">
          That is added to
          <br />
          <span className="bg-gradient-to-r from-mango to-coral bg-clip-text text-transparent">
            {sentRef}.
          </span>
        </h1>
        <div className="mt-6 max-w-[62ch] rounded-2xl border border-softline bg-soft p-6 text-[14.5px] leading-relaxed text-mute">
          <b className="text-ink">What you have just added</b>
          <ul className="mt-3 grid gap-2">
            {[
              ["Your identity check", done.id],
              ["Your TRN", done.id2],
              ["Your referees", done.refs],
              ["The Worker Guidelines, signed", done.sign],
            ].map(([label, ok]) => (
              <li key={String(label)} className="flex items-start gap-2">
                <span className={ok ? "text-tealb" : "text-dim"} aria-hidden="true">{ok ? "✓" : "•"}</span>
                <span className={ok ? "text-mute" : "text-dim"}>
                  {label}{ok ? "" : ", not yet"}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-4">
            A person at the desk works through it and comes back to you on
            whichever way you gave us to reach you. Anything still marked not
            yet, we chase on WhatsApp.
          </p>
        </div>
        <p className="mt-4 max-w-[62ch] text-[12.5px] leading-relaxed text-dim">
          Sending your documents is the last thing we need from you, and the
          decision is a person&rsquo;s to make after reading them. Your profile
          stays held back from clients until somebody at Yaadly publishes it.
        </p>
      </>
    );
  }

  /* ── the sent screen ───────────────────────────────────────────────── */

  if (sentRef && !continuing) {
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
            on your profile.{" "}
            {sentConsent === "granted"
              ? "Your paperwork goes to the model you agreed to first, and your identity documents go nowhere near it."
              : "Nothing about your documents is sent outside Yaadly."}{" "}
            Allow <b className="text-ink">within 24 hours</b>.
          </p>
          <p className="mt-3">
            You will hear back on whichever way you gave us to reach you. Quote
            your reference if you contact us first.
          </p>
          <CopyRef reference={sentRef} />
        </div>

        {/* WHAT THIS IS NOT. The page said "it is with a person now" and left
            it there, which a tradesperson can reasonably read as being in.
            Applying is not acceptance, and the honest version of that has to
            be on the one screen everybody who applies reaches. */}
        <div className="mt-4 max-w-[62ch] rounded-2xl border border-line2 bg-bg p-5 text-[13.5px] leading-relaxed text-mute">
          <b className="text-ink">Where you stand, plainly.</b>
          <p className="mt-2">
            Your profile exists from the moment you sent this, and it is{" "}
            <b className="text-ink">held back from clients</b> until the
            verification steps clear and somebody at Yaadly publishes it. So a
            person reading your application is the first step rather than the
            decision, and it is not a promise of work on its own. Every worker
            on the board came through the same gate, and that is exactly why a
            client trusts the badge when you get there.
          </p>
        </div>

        {/* Checks, drawn from `done`, which only ever ticks when the thing is
            actually true. It is the standing rule for this file: no row here
            may describe a check the code has not performed. */}
        <div className="mt-4 max-w-[62ch] rounded-2xl border border-line bg-panel p-5">
          <b className="text-[15px] text-ink">Where your application stands</b>
          <ul className="mt-3 grid gap-2 text-[13px] leading-relaxed">
            <li className="flex items-start gap-2">
              <span className="text-tealb" aria-hidden="true">✓</span>
              <span className="text-mute">
                <b className="text-ink">Received and stored.</b> Every file you
                sent was checked and fingerprinted by our server after it
                arrived, not just accepted on your browser&rsquo;s word.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className={done.id ? "text-tealb" : "text-dim"} aria-hidden="true">{done.id ? "✓" : "•"}</span>
              <span className={done.id ? "text-mute" : "text-dim"}>
                <b className={done.id ? "text-ink" : ""}>Identity check.</b>{" "}
                {done.id
                  ? (persona.state === "done"
                      ? (persona.verified
                          ? "Persona has confirmed it to our server. A person at the desk still decides your application."
                          : `Persona has it as "${persona.status || "unchecked"}". A person at the desk resolves it.`)
                      : "Your documents are on file and a person checks them by hand.")
                  : "Not started. This is the next thing we ask for."}
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-dim" aria-hidden="true">•</span>
              <span className="text-dim">
                <b>Referees.</b>{" "}
                {done.refs
                  ? "Given, and not telephoned yet. The calls happen before the jobs over £500."
                  : "Not given yet. We telephone them before the jobs over £500."}
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-dim" aria-hidden="true">•</span>
              <span className="text-dim">
                <b>A person reading it.</b> Not yet. That is what the 24 hours is.
              </span>
            </li>
            {/* What they chose, read back. `sentConsent` and not `aiConsent`,
                so this reports the answer that actually went to the server
                rather than the state of a radio button afterwards. */}
            <li className="flex items-start gap-2">
              <span className="text-tealb" aria-hidden="true">✓</span>
              <span className="text-mute">
                <b className="text-ink">Who may read your paperwork.</b>{" "}
                {sentConsent === "granted"
                  ? "You agreed that software may read your proof of address, TRN, certificates, CV and portfolio first and write notes for the person deciding. Your ID, selfie, face video and photograph of yourself were not sent to it."
                  : "You asked that no AI model reads your documents, so none of them left Yaadly. A person reads every page by hand."}
              </span>
            </li>
          </ul>
        </div>
        {/* The way into the second sitting, for anybody who would rather do
            it now and in a browser than wait to be chased on WhatsApp. It is
            an offer, not a queue: the application is already in, and nothing
            here is required to have been done for the desk to read it. */}
        <div className="mt-6 rounded-2xl border border-line bg-panel p-5">
          <b className="text-[15px] text-ink">Want to get ahead of it?</b>
          <p className="mt-2 max-w-[62ch] text-[13.5px] leading-relaxed text-mute">
            Your ID check, your referees and the Worker Guidelines are the next
            things we ask for, and we normally chase them on WhatsApp once a
            person has read your application. You can do them now instead. It
            makes no difference to the decision, only to how fast it lands.
          </p>
          <button
            onClick={() => { setContinuing(true); setStep(0); }}
            className="mt-4 rounded-full bg-linear-to-r from-teal to-mango px-5 py-2.5 text-[13px] font-bold text-onbrand transition hover:brightness-110">
            Carry on to the ID check
          </button>
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
        <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-dim">
          <span>
            <b className="font-normal text-mute">Saved on this phone.</b> Close
            it and come back, your reference is{" "}
            <span className="font-mono text-mute">{claim.reference}</span>.
          </span>
          {/* A saved application somebody cannot clear is the same problem as
              one that will not save. This says what goes, then goes. */}
          <button type="button" onClick={startAgain}
            className="underline underline-offset-4 hover:text-coral">
            Start again, and clear what is saved here
          </button>
        </p>
      )}

      {/* ── WHO SHOULD APPLY, and what it takes ─────────────────────────────
          Neither of these existed. The page opened on "For tradespeople" and
          went straight into eighteen trade chips, so the only way to find out
          whether you qualified, or what you would be asked for, was to fill
          the thing in and see.

          Only on the first screen of the first sitting. Somebody who has come
          back to add their ID has already answered this. */}
      {at === 0 && !continuing && (
        <>
          <div className="mt-6 rounded-2xl border border-line bg-panel p-5">
            <b className="text-[15.5px] text-ink">Who this is for</b>
            <p className="mt-1.5 max-w-[62ch] text-[13px] leading-relaxed text-dim">
              Four things. If all four are true, this is worth your two minutes.
            </p>
            <ul className="mt-3 grid gap-3">
              {WHO.map((w) => (
                <li key={w.yes} className="flex items-start gap-2.5">
                  <span className="mt-0.5 text-tealb" aria-hidden="true">✓</span>
                  <span className="text-[13.5px] leading-relaxed">
                    <b className="text-ink">{w.yes}.</b>{" "}
                    <span className="text-mute">{w.why}</span>
                  </span>
                </li>
              ))}
            </ul>
            {/* Said plainly, because nothing on this page said it. A page
                headed "getting on the board" can be read as a sign-up. */}
            <p className="mt-4 rounded-xl border border-line2 bg-bg px-4 py-3 text-[13px] leading-relaxed text-mute">
              <b className="text-ink">What applying gets you is a real person
              reading it,</b> within 24 hours, and a straight answer either way.
              It is the start of the check rather than the end of it: the
              verification steps come next, and the board opens to you once
              they clear. Worth knowing before you spend the two minutes.
            </p>
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-softline bg-soft p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <b className="text-[14.5px] text-ink">What you need now</b>
                <span className="src ok">Two minutes</span>
              </div>
              <ul className="mt-2.5 grid gap-1.5 text-[13px] leading-relaxed text-mute">
                {NEED_NOW.map((x) => (
                  <li key={x} className="flex items-start gap-2">
                    <span className="text-tealb" aria-hidden="true">•</span><span>{x}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2.5 text-[12px] leading-relaxed text-dim">
                That is the whole first sitting. Everything else on these three
                screens is optional and can wait.
              </p>
            </div>
            <div className="rounded-2xl border border-line bg-bg p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <b className="text-[14.5px] text-ink">What you need later</b>
                <span className="src opt">Not today</span>
              </div>
              <ul className="mt-2.5 grid gap-1.5 text-[13px] leading-relaxed text-mute">
                {NEED_LATER.map((x) => (
                  <li key={x} className="flex items-start gap-2">
                    <span className="text-dim" aria-hidden="true">•</span><span>{x}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2.5 text-[12px] leading-relaxed text-dim">
                Asked for after a person has read your application and said
                yes. Do not go hunting for any of it now.
              </p>
            </div>
          </div>
        </>
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
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="var(--onbrand)"
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
            {/* Scoped to this sitting, never across both. See Progress below
                for why that boundary matters. */}
            <Progress n={at} total={STEPS.length} name={d.n} />
            {/* tabIndex -1 so it can be focused programmatically without
                becoming a tab stop. The outline is left visible: somebody who
                has just been moved here should be able to see where they are. */}
            <h2
              ref={headingRef}
              tabIndex={-1}
              className="font-display text-[clamp(22px,3.4vw,32px)] uppercase leading-none focus:outline-none"
            >
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
                  {/* Named group, announced state, and an explicit button type.
                      These were bare buttons in a plain div: a screen reader
                      heard eighteen unrelated buttons with no way to tell which
                      were ticked, on the page where a tradesperson decides
                      whether this is worth the effort. Multi-select here, so
                      aria-pressed is exactly right. */}
                  <label className="fl" id="lbl-jf-trades">
                    Your trades, tick every one you take{" "}
                    <span className={"src " + (trades.length > 0 ? "ok" : "req")}>
                      {trades.length > 0 ? `${trades.length} selected` : "Required, pick at least one"}
                    </span>
                  </label>
                  <div className="chips" role="group" aria-labelledby="lbl-jf-trades">
                    {TRADES.map((t) => (
                      <button key={t} type="button" aria-pressed={trades.includes(t)}
                        className={trades.includes(t) ? "on" : ""}
                        onClick={() => toggle(trades, setTrades, t)}>
                        <span aria-hidden="true">{trades.includes(t) ? "✓ " : "+ "}</span>{t}
                      </button>
                    ))}
                  </div>
                  <input className="jf mt-2.5" placeholder="Not on the list? Type what you do (optional)"
                    aria-label="A trade that is not on the list, optional"
                    value={tradeOther} onChange={(e) => setTradeOther(e.target.value)} />
                  <p className="mt-2 text-[12.5px] leading-relaxed text-dim">
                    We would rather know what you actually do than squeeze you into
                    the nearest box.
                  </p>
                </div>

                <div className="fgroup">
                  <label className="fl" id="lbl-jf-parishes">
                    Parishes you will travel to{" "}
                    <span className={"src " + (parishes.length > 0 ? "ok" : "req")}>
                      {parishes.length > 0 ? `${parishes.length} selected` : "Required, pick at least one"}
                    </span>
                  </label>
                  {/* The launch area, in one tap. The three parishes and the
                      reasoning now live in lib/taxonomy as LAUNCH_PARISHES, so
                      this button and the client funnel cannot disagree about
                      where the business operates. It adds to what is already
                      ticked rather than replacing it. */}
                  <div className="jquick">
                    <button type="button"
                      onClick={() => setParishes(Array.from(new Set([...parishes, ...LAUNCH_PARISHES])))}>
                      + Kingston and Portmore
                    </button>
                    <button type="button" onClick={() => setParishes([...PARISHES])}>
                      + All fourteen
                    </button>
                    {parishes.length > 0 && (
                      <button type="button" onClick={() => setParishes([])}>
                        Clear all
                      </button>
                    )}
                  </div>
                  <div className="chips" role="group" aria-labelledby="lbl-jf-parishes">
                    {PARISHES.map((p) => (
                      <button key={p} type="button" aria-pressed={parishes.includes(p)}
                        className={parishes.includes(p) ? "on" : ""}
                        onClick={() => toggle(parishes, setParishes, p)}>
                        <span aria-hidden="true">{parishes.includes(p) ? "✓ " : "+ "}</span>{p}
                      </button>
                    ))}
                  </div>
                  <p className="mt-2 text-[12.5px] leading-relaxed text-dim">
                    A job posted in a parish you have not ticked never reaches you.
                    Tick wide, decline what you do not want.
                  </p>
                </div>

                <div className="fgroup">
                  <label className="fl">
                    How we reach you{" "}
                    <span className={"src " + (name.trim().length > 1 && (hasPhone || hasEmail) ? "ok" : "req")}>
                      {name.trim().length > 1 && (hasPhone || hasEmail)
                        ? "Done"
                        : "Required, your name and one way to reach you"}
                    </span>
                  </label>
                  <div className="grid gap-2.5 sm:grid-cols-2">
                    <input className="jf" placeholder="Your full name (required)" autoComplete="name"
                      enterKeyHint="next" aria-label="Your full name, required"
                      value={name} onChange={(e) => setName(e.target.value)} />
                    <input className="jf" placeholder="Years at the trade (optional)" inputMode="numeric"
                      enterKeyHint="next" aria-label="Years at the trade, optional"
                      value={years} onChange={(e) => setYears(e.target.value)} />
                    <input className="jf" placeholder="Phone number (or give an email)" inputMode="tel" autoComplete="tel"
                      enterKeyHint="next" aria-label="Your phone number, or give an email address instead"
                      value={phone} onChange={(e) => setPhone(e.target.value)} />
                    <input className="jf" placeholder="Email address (or give a phone)" inputMode="email" autoComplete="email"
                      enterKeyHint="done" aria-label="Your email address, or give a phone number instead"
                      value={email} onChange={(e) => setEmail(e.target.value)} />
                  </div>
                  <p className="mt-2 text-[12.5px] leading-relaxed text-dim">
                    <b className="text-mute">A phone number or an email address, whichever
                    you would rather.</b> Both is useful and neither is required twice.
                    If you give a number, give the one you actually answer, because it
                    is the one we ring about a job.
                  </p>
                </div>
              </>
            )}

            {d.body === "port" && (
              <div className="grid gap-3">
                {/* Nothing here blocks the Continue button, and saying so is
                    better than letting somebody sit on a phone hunting for a
                    certificate before they are allowed to move. It genuinely
                    helps them, which is a reason to ask, not a reason to gate. */}
                <div className="rounded-xl border border-line2 bg-bg px-4 py-3 text-[12.5px] leading-relaxed">
                  <b className="text-ink">All of this is optional</b>{" "}
                  <span className="src ok">Nothing here is required</span>
                  <p className="mt-2 text-mute">
                    You can send your application without any of it. Showing one
                    piece of work is the single fastest way to be taken
                    seriously, so it is worth a minute if you have a photo on
                    your phone, and you can add the rest later.
                  </p>
                </div>
                {/* A photograph of the person. Founder instruction, 3 Sep 2026.
                
                    WHAT THIS COPY MAY AND MAY NOT SAY. The file goes into the
                    same private vetting bucket as everything else here, which
                    means two things that rule out the obvious wording. Nothing
                    on this page can publish it: `worker_profiles` has no photo
                    column, so no code path puts it on a public profile. And
                    every file in that bucket is deleted ninety days after
                    upload by yaad-vetting-purge, so it could not serve as a
                    lasting profile picture even if something did read it.
                
                    So it says what is true: it reaches the person deciding.
                    Calling it "your profile photo" would be the ornamental
                    claim this file exists to refuse. */}
                <div className="rounded-xl border border-line bg-bg px-4 py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <b className="text-[13.5px]">A photograph of you</b>
                    <span className="src opt">Optional</span>
                  </div>
                  <p className="mt-1 mb-3 text-[12.5px] leading-relaxed text-mute">
                    A clear picture of your face, or you on a job in your work
                    clothes. Either is fine and your phone camera is fine.{" "}
                    <b className="text-ink">It goes to the person reading your
                    application</b>, so they can put a face to the name instead
                    of a form. For photographs of your finished work, use the
                    portfolio row below, which takes several in one file.
                  </p>
                  <Upload label="Your photograph" hint="A clear picture of your face, or you on a job"
                    accept={IMAGES} doc="profile_photo" docs={docs} onFile={upload} optional />
                  <p className="mt-2 text-[12px] leading-relaxed text-dim">
                    Held the same way as your ID: a private store no browser can
                    reach, <b className="text-mute">never sent to an AI
                    model</b>, and destroyed ninety days after you send it.{" "}
                    <b className="text-mute">Nothing here goes on your public
                    profile unless you say so</b>, and there is a question
                    about exactly that near the end.
                  </p>
                </div>

                <Upload label="A CV or a written history" hint="A photo of it is fine"
                  accept={CVFILE} doc="cv" docs={docs} onFile={upload} optional />
                <Upload label="A portfolio, or photos of finished jobs" hint="One file, or a PDF of several"
                  accept={PAPERS} doc="portfolio" docs={docs} onFile={upload} optional />
                <Upload label="Trade certificates, if you hold any" hint="Verified with the body that issued them, not read off the picture"
                  accept={PAPERS} doc="certificate" docs={docs} onFile={upload} optional />

                <div className="rounded-xl border border-line bg-bg px-4 py-3">
                  <b className="text-[13.5px]">
                    A link to your site, Instagram or Facebook{" "}
                    <span className="src opt">Optional</span>
                  </b>
                  <span className="mt-1 block text-[12px] text-dim">
                    Add as many as you have. Anywhere your work is already visible.
                  </span>
                  <div className="mt-3 flex gap-2">
                    <input className="jf" placeholder="instagram.com/yourwork"
                      aria-label="A link to your work, then press Add link" value={linkDraft}
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

                {/* Here because this is the screen that collects the CV, the
                    portfolio and the certificates, and because it is the last
                    screen before the first send. See AiConsent for why the
                    position is load bearing rather than tidy. */}
                <AiConsent value={aiConsent} onChange={setAiConsent} />

                <div>
                  <label className="fl" htmlFor="jf-work">
                    In your own words, what do you do{" "}
                    <span className="src opt">Optional</span>
                  </label>
                  <textarea id="jf-work" className="jf min-h-[110px] resize-y" value={work}
                    onChange={(e) => setWork(e.target.value)}
                    placeholder="The kind of jobs you take, the biggest one you have done, anything a client should know." />
                </div>
              </div>
            )}

            {d.body === "id" && (
              <div className="grid gap-3">
                {/* Thirty seconds, and the only thing on this page a client
                    ever sees. Everything else here is a check somebody at the
                    desk reads once; this is the tradesperson in their own
                    voice, which is worth more to a woman in London deciding
                    who to let onto her mother's roof than another PDF.

                    Optional on purpose. Somebody on a thin connection or a
                    borrowed phone should not be stopped by it, and a worker
                    who would rather not be filmed is not a worse worker.

                    Held to the same rule as the ID captures: it is a face and
                    a voice, so it is on IDENTITY_DOCS in yaad-vetting-review
                    and is never sent to a model. */}
                <div className="rounded-xl border border-line bg-bg px-4 py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <b className="text-[13.5px]">Say hello, thirty seconds</b>
                    <span className="src ok">Optional</span>
                  </div>
                  <p className="mt-1 mb-3 text-[12px] leading-relaxed text-dim">
                    Your name, your trade, how long you have been doing it, and
                    one job you were proud of. No script and no need to dress
                    up. <b className="text-mute">This is the one thing on this
                    page a client actually sees.</b>
                  </p>
                  <LiveCapture kind="video" label="A short introduction" seconds={30}
                    doc="intro_video" docs={docs} onFile={upload} />
                </div>

                {/* Directly under the video, and the last question before the
                    send, because this is the one screen where the photograph,
                    the introduction and the work photos are all in mind at
                    once. See ShowcaseConsent for why it is a second question
                    rather than a line added to the first. */}
                <ShowcaseConsent value={showcaseConsent} onChange={setShowcaseConsent} />

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

                    {/* THE WAY OUT FOR SOMEBODY PERSONA WILL NOT TAKE.
                        The fallback above only fires when Persona fails to
                        LOAD: a timeout, an ad blocker, a thin connection.
                        Somebody whose Jamaican voter card or driver's licence
                        the template does not accept sees Persona work
                        perfectly and refuse them, and until now that was a
                        dead end with no way forward.

                        Most Jamaican tradespeople do not hold a passport. A
                        check that only a passport satisfies excludes the
                        supply side this business is built on, so the escape
                        is deliberate and it is theirs to take, not something
                        they have to ask for. */}
                    <button
                      type="button"
                      onClick={() => setPersonaFallback(
                        "You told us the ID check would not take your document.",
                      )}
                      className="mt-3 w-full text-left text-[12.5px] leading-relaxed text-dim underline"
                    >
                      It would not take my ID. Let me send it another way.
                    </button>
                  </div>
                ) : (
                  <>
                    {personaFallback && (
                      <p className="rounded-xl border border-softline bg-soft px-4 py-2.5 text-[12px] leading-relaxed text-mute">
                        <b className="text-ink">The Persona check is not running on this visit.</b>{" "}
                        {personaFallback} Send your ID below instead and a person
                        at the desk checks it by hand.{" "}
                        <b className="text-ink">A voter card or a driver&rsquo;s
                        licence is fine.</b> This does not count against you and
                        it does not slow your application down.
                      </p>
                    )}
                    {/* Needed to be published, not needed to send. Nothing on
                        this screen blocks a button, and saying which is which
                        beats leaving somebody to guess from silence. */}
                    <p className="text-[12.5px] leading-relaxed text-dim">
                      <b className="text-mute">All five are needed before your
                      profile can go public.</b> None of them blocks this page:
                      you can save what you have and send the rest later, and we
                      will chase whatever is missing on WhatsApp.
                    </p>
                    <Upload label="Government photo ID" hint="Voter card, driver's licence, national ID or passport"
                      accept={PAPERS} doc="photo_id" docs={docs} onFile={upload} />
                    <LiveCapture kind="photo" label="A live photo, with your ID beside your face"
                      doc="selfie_with_id" docs={docs} onFile={upload} />
                    <LiveCapture kind="video" label="A short video, face left to right" seconds={10}
                      doc="face_video" docs={docs} onFile={upload} />
                    <Upload label="Your TRN card" hint="Matched to the name on the ID"
                      accept={PAPERS} doc="trn" docs={docs} onFile={upload} />
                    <Upload label="Proof of address" hint="Dated within the last three months"
                      accept={PAPERS} doc="proof_of_address" docs={docs} onFile={upload} />
                  </>
                )}

                {/* The TRN, asked for in Phase 2 rather than Phase 1, because
                    it belongs with verification and not with a two minute
                    profile. Persona took over step 3 on 30 Aug and the TRN row
                    went with it, so nothing was collecting one at all.

                    The number, not a photograph of the card: the number is
                    what gets checked, and an image is another document to
                    store, redact and destroy for no extra proof. */}
                <div className="rounded-xl border border-line bg-bg px-4 py-3">
                  <label className="fl" htmlFor="trn">
                    Your TRN{" "}
                    <span className={"src " + (trn.replace(/\D/g, "").length === 9 ? "ok" : "")}>
                      {trn.replace(/\D/g, "").length === 9 ? "Nine digits" : "Nine digits, from your TRN card"}
                    </span>
                  </label>
                  <input id="trn" className="jf" inputMode="numeric" placeholder="123456789"
                    value={trn} onChange={(e) => setTrn(e.target.value)} />
                  <p className="mt-2 text-[12px] leading-relaxed text-dim">
                    A person at the desk checks it against the name on your ID.
                    We hold the number, not a picture of the card. It is how you
                    are paid as your own business rather than as somebody&rsquo;s
                    staff, and it is what your invoices are raised against.
                  </p>
                </div>

                {/* Phase 1 takes a phone number OR an email. Everything after
                    this point is keyed on an email: the portal account, the
                    Worker Guidelines signature, and the job alerts themselves.
                    So it is asked for here, once, with the reason attached,
                    rather than a worker being published into a dead profile
                    that can never be sent a job. */}
                {!email.trim() && (
                  <div className="rounded-xl border border-mango/40 bg-mango/5 px-4 py-3">
                    <label className="fl" htmlFor="lateEmail">
                      An email address <span className="src req">Needed to get work</span>
                    </label>
                    <input id="lateEmail" className="jf" inputMode="email" autoComplete="email"
                      placeholder="you@email.com" value={email}
                      onChange={(e) => setEmail(e.target.value)} />
                    <p className="mt-2 text-[12px] leading-relaxed text-dim">
                      You joined with a phone number, which was enough to apply.
                      Jobs are sent by email, and your account and the Worker
                      Guidelines are tied to one, so we cannot put you on the
                      board without it.
                    </p>
                  </div>
                )}

                {/* The same question, the same single answer. It is repeated
                    here rather than moved because this screen adds two more
                    documents it covers, and somebody who said no in two
                    minutes flat should be able to change that when they are
                    actually handing the paperwork over. */}
                <AiConsent value={aiConsent} onChange={setAiConsent} />

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
                <div className="rounded-xl border border-line2 bg-bg px-4 py-3 text-[12.5px] leading-relaxed">
                  <b className="text-ink">Three referees, and each one needs
                  either a number or something they said</b>{" "}
                  <span className={refsDone ? "src ok" : "src req"}>
                    {refsDone ? "All three answered" : "Needed to be published"}
                  </span>
                  <p className="mt-2 text-mute">
                    You can leave this screen part done and send what you have.
                    It does not stop you here, and it does stop your profile
                    going public, so it is worth finishing.
                  </p>
                </div>
                {refs.map((r, i) => {
                  const rDone = (r.name.trim() && r.phone.trim()) || r.quote.trim();
                  return (
                  <div key={i} className="rounded-xl border border-line bg-bg p-4">
                    <b className="text-[13.5px]">
                      Reference {i + 1}{" "}
                      <span className={rDone ? "src ok" : "src opt"}>
                        {rDone ? "Answered" : "Not answered yet"}
                      </span>
                    </b>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      <input className="jf" placeholder="Their name" value={r.name}
                        enterKeyHint="next" aria-label={`Reference ${i + 1}, their name`}
                        onChange={(e) => setRefs(refs.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
                      <input className="jf" placeholder="Their phone number" inputMode="tel" value={r.phone}
                        enterKeyHint="next" aria-label={`Reference ${i + 1}, their phone number`}
                        onChange={(e) => setRefs(refs.map((x, j) => j === i ? { ...x, phone: e.target.value } : x))} />
                    </div>
                    {/* The founder's ruling, 30 Aug: a forwarded WhatsApp
                        message is enough for the Probation tier, and the desk
                        telephones before top tier unlocks. So this is a second
                        way to answer the question, not a second question. */}
                    <textarea
                      className="jf mt-2"
                      rows={2}
                      placeholder="Or paste what they said about your work, or a link to it"
                      aria-label={`Reference ${i + 1}, what they said about your work, or a link to it`}
                      value={r.quote}
                      onChange={(e) => setRefs(refs.map((x, j) => j === i ? { ...x, quote: e.target.value } : x))}
                    />
                    <label className="mt-3 flex items-start gap-2.5 text-[12.5px] leading-relaxed text-mute">
                      <input type="checkbox" checked={r.told} className="mt-0.5 size-5 accent-teal"
                        onChange={() => setRefs(refs.map((x, j) => j === i ? { ...x, told: !x.told } : x))} />
                      I have told this person that Yaadly will call them before I take a job over £500.
                    </label>
                  </div>
                  );
                })}
                <p className="text-[12.5px] leading-relaxed text-dim">
                  <b className="text-mute">A message or a number, whichever you
                  have.</b> A forwarded WhatsApp message is enough to get you on
                  the board. We telephone your referees before you can take work
                  over £500, so tell them a call is coming.
                </p>
              </div>
            )}

            {d.body === "sign" && (
              <div className="grid gap-3">
                <div className={"sigbox" + (signed && signedName.trim().length > 1 ? " done" : "")}>
                  <b>
                    {signed && signedName.trim().length > 1
                      ? "✓ Worker Guidelines signed"
                      : "Worker Guidelines, current version"}{" "}
                    <span className={signed && signedName.trim().length > 1 ? "src ok" : "src req"}>
                      {signed && signedName.trim().length > 1 ? "Signed" : "Not signed yet"}
                    </span>
                  </b>
                  <span>
                    How quoting works, the evidence you owe on every job, how you are
                    paid, and what loses you the platform. Read it first, then tick
                    the box and type your name.
                  </span>
                </div>
                <a href="/portal/guidelines" target="_blank" rel="noreferrer"
                  className="text-[12.5px] font-bold text-tealb underline underline-offset-4">
                  Read the Worker Guidelines →
                </a>
                <label className="flex items-start gap-2.5 text-[13px] leading-relaxed text-mute">
                  <input type="checkbox" checked={signed} className="mt-0.5 size-5 accent-teal"
                    onChange={() => setSigned(!signed)} />
                  I have read the Worker Guidelines and I agree to work to them on
                  every Yaadly job.
                </label>
                <label className="fl" htmlFor="jf-sign">Type your full name to sign</label>
                <input id="jf-sign" className="jf -mt-2" placeholder="Your full name" value={signedName}
                  enterKeyHint="done"
                  onChange={(e) => setSignedName(e.target.value)} />
                <p className="text-[12px] leading-relaxed text-dim">
                  Recorded with a timestamp and the exact consent sentence, when you
                  send the application. No edit, no delete.
                </p>
              </div>
            )}

            {d.body === "sign" && (
              <div className="mb-3 grid gap-2.5">
                {[
                  ["On the board", ON_THE_BOARD.probation],
                  ["What stays locked", ON_THE_BOARD.topTier],
                  ["The standard, afterwards", ON_THE_BOARD.standard],
                ].map(([head, body]) => (
                  <div key={head} className="rounded-xl border border-line bg-bg px-4 py-3 text-[13px] leading-relaxed text-mute">
                    <b className="text-ink">{head}.</b> {body}
                  </div>
                ))}
              </div>
            )}

            {d.body === "live" && (
              <div className="grid gap-3">
                {/* The profile preview. This screen used to be a sentence
                    saying nothing had been sent yet and a button, which gave
                    somebody nothing to check and no reason to be on it. What
                    belongs here is the thing they are actually about to hand
                    over, drawn from the same fields the public profile reads,
                    so what they see is what a client sees.

                    It deliberately shows the UNVETTED state, because that is
                    the true one on the day they send: no score, no verified
                    badge, "Building a record". A preview that flatters is a
                    preview that lies, and this page has spent three screens
                    telling them the check is the point. */}
                {!sentRef && (
                  <>
                    <p className="text-[12.5px] leading-relaxed text-dim">
                      This is your profile as a client will see it. Nothing here
                      is fixed, you can change any of it later.
                    </p>

                    <div className="flex flex-wrap items-start gap-4 rounded-2xl border border-line bg-panel p-5">
                      {/* The photograph if this page still has it in memory,
                          initials otherwise. After a reload there is nothing to
                          fetch, because the file sits in a bucket no browser
                          can read, so the fallback says the picture is on file
                          rather than pretending it was never sent. */}
                      {photoPreview ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img src={photoPreview} alt="The photograph you uploaded of yourself"
                          className="size-16 flex-none rounded-2xl object-cover" />
                      ) : (
                        <span className="grid size-16 flex-none place-items-center rounded-2xl bg-linear-to-br from-tealb to-teal font-display text-[26px] text-onbrand">
                          {(name.trim() || "W").split(/\s+/).map((x) => x[0]).join("").slice(0, 2).toUpperCase()}
                        </span>
                      )}
                      <span className="min-w-[220px] flex-1">
                        <h3 className="font-display text-[clamp(20px,3.4vw,28px)] uppercase leading-none">
                          {name.trim() || "Your name"}
                        </h3>
                        <p className="mt-1.5 text-[13.5px] text-mute">
                          {[
                            trades.length ? trades.join(", ") : "General trades",
                            tradeOther.trim(),
                            parishes.length ? parishes.join(", ") : "",
                            years.trim() ? `Trading ${years.trim()} years` : "",
                          ].filter(Boolean).join(" · ")}
                        </p>
                      </span>
                      <span className="text-right">
                        <span className="rounded-full border border-softline bg-soft px-3 py-1.5 text-[11.5px] font-bold text-tealb">
                          Building a record
                        </span>
                        <p className="mt-1.5 text-[11.5px] text-dim">
                          The Yaad Score starts at the first signed-off job
                        </p>
                        {!photoPreview && docs.profile_photo?.state === "done" && (
                          <p className="mt-1.5 text-[11.5px] text-tealb">
                            Your photograph is on file. It cannot be shown here
                            after a reload, because the store it sits in is not
                            readable by a browser.
                          </p>
                        )}
                      </span>
                    </div>

                    <div className="rounded-xl border border-line bg-bg px-4 py-3 text-[12.5px] leading-relaxed text-mute">
                      <b className="text-ink">Work you have shown us:</b>{" "}
                      {(() => {
                        const shown = Object.entries(docs)
                          .filter(([, v]) => v.state === "done")
                          .map(([k]) => k.replace(/_/g, " "));
                        const all = [...shown, ...links.map((l) => l.replace(/^https?:\/\//, ""))];
                        return all.length
                          ? all.join(", ")
                          : "nothing yet. You can still send this, and add work later.";
                      })()}
                    </div>

                    {/* The payoff, said where it means most: at the point
                        somebody is deciding whether this is worth their time.
                        It sat on the last of nine steps before, which nobody
                        reached. */}
                    <div className="rounded-xl border border-softline bg-soft px-4 py-4 text-[13.5px] leading-relaxed text-mute">
                      <b className="text-ink">What this costs you: nothing.</b>
                      <p className="mt-2">
                        Free to join and <b className="text-ink">free to quote,
                        win or lose</b>. You are never charged for a lead. Your
                        price is agreed with you per job, in writing, before you
                        start, and your materials are paid at cost on top of it.{" "}
                        <b className="text-ink">You are paid per stage, not one
                        lump at the end: a stage signed off is a stage paid,
                        within 3 working days of Yaadly signing the stage
                        off.</b>{" "}
                        Bank transfer, Lynk wallet or remittance pick-up,
                        whichever you choose.
                      </p>
                      <p className="mt-2.5 text-[12.5px] text-dim">
                        <b className="text-mute">Yaadly pays you, the client
                        does not.</b> You are Yaadly&rsquo;s subcontractor: the
                        client buys the job from Yaadly, and Yaadly engages and
                        pays you. Your money does not wait on the client
                        approving anything. You are told this before you turn up
                        rather than after, and it is set out in the Worker
                        Guidelines you sign.
                      </p>
                    </div>

                    <div className="rounded-xl border border-line bg-bg px-4 py-4 text-[13.5px] leading-relaxed text-mute">
                      <b className="text-ink">What happens after you send.</b>
                      <p className="mt-2">
                        <b className="text-ink">Your profile is created the
                        moment you send this.</b> A person at the Yaadly desk
                        reads it, not a queue, and you hear back within 24
                        hours. The ID check and your referees come next, and we
                        chase those on WhatsApp so you do not have to sit here
                        for them. <b className="text-ink">Your profile goes
                        public once those checks clear</b>, not before, which is
                        the same rule every worker on the board was held to.
                      </p>
                    </div>
                  </>
                )}

                {/* Only in the second sitting. In Phase 1 the referees have not
                    been asked for yet, so calling them "still outstanding" at
                    the end of a two minute form is both untrue and the exact
                    discouragement this flow was shortened to remove. */}
                {continuing && outstanding.length > 0 && (
                  <div className="rounded-xl border border-line2 bg-bg px-4 py-3 text-[12.5px] leading-relaxed text-mute">
                    <b className="text-ink">Still outstanding:</b> {outstanding.join(", ")}.
                    You can send it anyway. It will sit at the desk until these land,
                    and your profile cannot publish without them.
                  </div>
                )}

                {/* A failed send left the server's sentence and nothing else.
                    Everything typed is still here and still saved on the phone,
                    and somebody who does not know that closes the tab. */}
                {error && (
                  <div className="rounded-xl border border-coral/50 bg-coral/5 px-4 py-3 text-[13px] leading-relaxed text-coral">
                    <b>{error}</b>
                    <p className="mt-2 text-mute">
                      Nothing was lost. Everything you have typed is still on
                      this page and saved on this phone, so you can press the
                      button again, or close this and come back to it later.
                    </p>
                  </div>
                )}

                <button onClick={send} disabled={busy || !step1Ready}
                  className="rounded-full bg-linear-to-r from-teal to-mango px-5 py-3 text-[14px] font-bold text-onbrand transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50">
                  {busy
                    ? (continuing ? "Saving…" : "Sending…")
                    : continuing ? "Save what I have added" : "Send my application"}
                </button>
                {!step1Ready && (
                  <p className="text-[12.5px] text-dim">
                    Not quite ready. We need your name, one way to reach you, at
                    least one trade and at least one parish.
                  </p>
                )}
              </div>
            )}
          </div>

          <p className="mt-3 text-[12.5px] leading-relaxed text-dim">{shown.note}</p>

          {/* Said once, plainly, and always on screen rather than only when
              something is missing. Somebody filling a form on a phone should
              never have to guess which of these is going to stop them. */}
          {d.body === "form" && (
            <div className="mt-4 rounded-xl border border-line2 bg-bg px-4 py-3 text-[12.5px] leading-relaxed">
              <b className="text-ink">What is needed to carry on</b>
              <ul className="mt-2 grid gap-1.5">
                {[
                  ["At least one trade", trades.length > 0],
                  ["At least one parish", parishes.length > 0],
                  ["Your name", name.trim().length > 1],
                  ["A phone number or an email address, either one", hasPhone || hasEmail],
                ].map(([label, ok]) => (
                  <li key={String(label)} className="flex items-start gap-2">
                    <span className={ok ? "text-tealb" : "text-dim"}>{ok ? "✓" : "•"}</span>
                    <span className={ok ? "text-mute" : "text-ink"}>{label}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2.5 text-dim">
                Everything else on this page is optional, including years at the
                trade and anything you upload. You can add it later.
              </p>
            </div>
          )}

          {/* On a phone this bar sticks to the bottom of the viewport. Continue
              sat below thirty-two chips at the end of a long scroll, which is
              the one control on the screen a thumb has to be able to find.
              `at`, not `step`, so a restored step past the end of this sitting
              steps from where the screen actually is.

              It stops being sticky on the send screens, where the primary
              action is Send, inside the panel and directly under the error
              line it needs to be read with. Pinning a bar that holds nothing
              but Back would spend seventy pixels of a phone on the one control
              nobody is reaching for. */}
          <div className={"jnav" + (d.body === "live" ? " jnav-flow" : "")}>
            {at > 0 && (
              <button onClick={() => setStep(at - 1)}
                className="rounded-full border border-line2 px-5 py-2.5 text-[13px] font-bold transition hover:border-teal hover:text-tealb">
                Back
              </button>
            )}
            {d.body !== "live" && (
              <button
                disabled={busy || (d.body === "form" && !step1Ready)}
                onClick={async () => {
                  setError("");
                  if (d.body === "form") {
                    setBusy(true);
                    try { await ensureApplication(); }
                    catch (e) { setError(e instanceof Error ? e.message : "Could not start your application."); setBusy(false); return; }
                    setBusy(false);
                  }
                  setStep(at + 1);
                }}
                className="rounded-full bg-linear-to-r from-teal to-mango px-5 py-2.5 text-[13px] font-bold text-onbrand transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50">
                {busy && d.body === "form" ? "Starting…" : "Continue"}
              </button>
            )}
            {/* Why Continue is grey, next to Continue. It used to be a line of
                small print further up the page, above the chips, so on a phone
                the button and the reason it will not move were never on screen
                together. */}
            {d.body === "form" && !step1Ready && !busy && (
              <span className="jwhy">
                Still needed:{" "}
                {[
                  !(trades.length > 0) && "a trade",
                  !(parishes.length > 0) && "a parish",
                  !(name.trim().length > 1) && "your name",
                  !(hasPhone || hasEmail) && "a phone number or an email",
                ].filter(Boolean).join(", ")}.
              </span>
            )}
          </div>

          {error && d.body !== "live" && (
            <p className="mt-3 text-[13px] text-coral">{error}</p>
          )}
        </div>

      </div>
    </>
  );
}

/**
 * Who may read the paperwork.
 *
 * WHY IT IS BACK, AND WHY HERE.
 *
 * This question existed, then the page it lived on was cut and it went with
 * it. What did not go was the server's reading of a missing answer: absent
 * counts as declined, correctly, so every application since has recorded a
 * refusal no applicant ever gave and yaad-vetting-review has never run for
 * anybody. Founder instruction, 3 Sep 2026: put it back.
 *
 * It renders on TWO screens, and that is not decoration. `submit` is what
 * triggers the review, and Phase 1 submits, so a question living only in
 * Phase 2 would be answered after the only moment it could matter and the
 * page would be back where it started. So it sits with the CV, portfolio and
 * certificates in Phase 1, before the first send, and again beside the TRN
 * and proof of address in Phase 2, where somebody handing over more paperwork
 * can change their mind about it. One piece of state, one answer, sent on
 * whichever submit happens.
 *
 * EVERY CLAIM IN THE COPY BELOW IS CHECKED IN CODE, and the standing rule for
 * this file is that nothing may describe a check that is not performed:
 *
 *   what is withheld   IDENTITY_DOCS in supabase/functions/yaad-vetting-review,
 *                      tested BEFORE the download, so a withheld file is never
 *                      fetched out of the bucket at all. Today that is the
 *                      photo ID, the selfie, the face turn, the introduction
 *                      video and the profile photograph.
 *   what is sent       whatever is left, which is the proof of address, the
 *                      TRN, trade certificates, the CV and the portfolio.
 *   who receives it    NVIDIA's hosted vision model. Named, because "an AI
 *                      model" tells somebody nothing about which country
 *                      their proof of address ends up in.
 *   what it decides    nothing. It writes flags for a person. The governing
 *                      rule is that a named human confirms every consequential
 *                      step, and this is the screen where that promise is
 *                      either kept in writing or quietly broken.
 *
 * Neither option is pre-selected. A consent that arrived ticked is not a
 * consent, and a passport is not the document to be casual with.
 */
/**
 * "May we put this on your public profile?"
 *
 * A SECOND consent, and it exists because the first one said the opposite.
 * The photograph row on the papers screen has always ended with "This page
 * does not publish it anywhere", and that sentence was true and was read by
 * everybody who has applied so far. Publishing their face on the strength of
 * it would be answering a question nobody was asked.
 *
 * So: its own question, its own version (SHOWCASE_CONSENT_VERSION), neither
 * option pre-selected, and unanswered read as no. A profile shows nothing
 * until public_worker_showcase sees the word granted, and that test lives in
 * the database view rather than in any page, so no future screen can forget
 * it.
 *
 * WHAT IT COVERS, exactly, and nothing else: the photograph of themselves,
 * the thirty second introduction, and the portfolio or photos of finished
 * work. Not the ID, not the selfie, not the face turn, not the proof of
 * address, the TRN, the CV or the certificates. Those are vetting papers and
 * they stay where they are.
 *
 * WHAT IS PUBLISHED IS A COPY. The consented file is copied into a separate
 * public store; the original stays in the private vetting bucket and is still
 * destroyed on the ninety day clock the applicant was promised. That is why
 * the copy below can say the vetting papers are still deleted on time without
 * that being two claims fighting each other.
 *
 * Placed on the ID screen, under the introduction video, because that is the
 * last screen before sending and it is the only screen where all three of the
 * things being asked about are on the page at once.
 */
function ShowcaseConsent({
  value, onChange,
}: {
  value: "" | "granted" | "declined";
  onChange: (v: "granted" | "declined") => void;
}) {
  return (
    <div className="rounded-xl border border-line bg-bg px-4 py-4">
      <label className="fl" id="lbl-showcase-consent">
        Your public profile{" "}
        <span className={value ? "src ok" : "src opt"}>
          {value ? "Answered" : "Your choice, either way"}
        </span>
      </label>

      <p className="mt-1 text-[12.5px] leading-relaxed text-mute">
        Every worker on Yaadly has a page a client can read before they choose
        anybody. Yours has your trade, your parish, what was checked and, once
        you have done jobs through us, the evidence from them.{" "}
        <b className="text-ink">What it cannot show yet is you.</b>
      </p>

      <p className="mt-2.5 text-[12.5px] leading-relaxed text-mute">
        We can put three things you have already given us on that page: your
        photograph, your thirty second introduction, and your portfolio or
        photos of finished work. A person at Yaadly looks at each one first and
        decides whether it goes up.{" "}
        <b className="text-ink">Nothing else ever does.</b> Your ID, your
        selfie, your face turn, your proof of address, your TRN, your CV and
        your certificates are vetting papers, they stay private, and they are
        still destroyed ninety days after you send them.
      </p>

      <div className="mt-3 grid gap-2.5" role="radiogroup" aria-labelledby="lbl-showcase-consent">
        {([
          ["granted",
            "Yes, put my photograph, my introduction and my work on my profile",
            "A copy of each goes on a page anyone can open, once somebody at Yaadly has looked at it. Tell us any time to take it down and it comes down."],
          ["declined",
            "No, keep all of it private",
            "Your profile still shows your trade, your parish and everything that was checked. It counts against you in no way at all."],
        ] as const).map(([v, title, sub]) => (
          <label key={v}
            className={"flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3 transition "
              + (value === v ? "border-teal bg-soft" : "border-line bg-panel hover:border-line2")}>
            <input type="radio" name="showcaseconsent" className="mt-0.5 size-5 shrink-0 accent-teal"
              checked={value === v} onChange={() => onChange(v)} />
            <span>
              <b className="block text-[13.5px] leading-snug">{title}</b>
              <span className="mt-1 block text-[12px] leading-relaxed text-dim">{sub}</span>
            </span>
          </label>
        ))}
      </div>

      <p className="mt-2.5 text-[12px] leading-relaxed text-dim">
        Neither is ticked for you. Send your application without choosing and{" "}
        <b className="text-mute">we read that as no</b>, and your profile shows
        none of it.
      </p>
    </div>
  );
}

function AiConsent({
  value, onChange,
}: {
  value: "" | "granted" | "declined";
  onChange: (v: "granted" | "declined") => void;
}) {
  return (
    <div className="rounded-xl border border-line bg-bg px-4 py-4">
      <label className="fl" id="lbl-ai-consent">
        Who may read your paperwork{" "}
        <span className={value ? "src ok" : "src opt"}>
          {value ? "Answered" : "Your choice, either way"}
        </span>
      </label>

      <p className="mt-1 text-[12.5px] leading-relaxed text-mute">
        A person at Yaadly reads your documents and decides. Before they do, we
        can have software read the paperwork first, to check the name is the
        same on every one, that the dates are current, and that nothing looks
        altered. It writes notes for that person.{" "}
        <b className="text-ink">It never decides anything.</b>
      </p>

      <p className="mt-2.5 text-[12.5px] leading-relaxed text-mute">
        <b className="text-ink">Your photo ID, your selfie, your face video and
        your photograph of yourself are never sent to any AI model, whichever
        you choose here.</b> Not once. Those go to our identity checker and to a
        person at Yaadly, and nowhere else.
      </p>

      <p className="mt-2.5 text-[12.5px] leading-relaxed text-mute">
        This choice is about the rest of it: your proof of address, your TRN,
        your trade certificates, your CV and your portfolio. To read those we
        send them to a model run by <b className="text-ink">NVIDIA</b>, outside
        Yaadly, and they are not used to train anything. Say no and only a
        person at Yaadly ever opens them.{" "}
        <b className="text-ink">Saying no counts against you in no way at
        all.</b> It is a little slower. That is the whole difference.
      </p>

      <div className="mt-3 grid gap-2.5" role="radiogroup" aria-labelledby="lbl-ai-consent">
        {([
          ["granted",
            "Software may read the paperwork first, then a person decides",
            "Your proof of address, TRN, certificates, CV and portfolio go to NVIDIA's model to be read. Your ID, selfie, face video and photograph of yourself do not."],
          ["declined",
            "A person only. Do not send any of my documents to an AI model",
            "Nothing at all leaves Yaadly. A person reads every page from cold, and you still hear back within 24 hours."],
        ] as const).map(([v, title, sub]) => (
          <label key={v}
            className={"flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3 transition "
              + (value === v ? "border-teal bg-soft" : "border-line bg-panel hover:border-line2")}>
            <input type="radio" name="aiconsent" className="mt-0.5 size-5 shrink-0 accent-teal"
              checked={value === v} onChange={() => onChange(v)} />
            <span>
              <b className="block text-[13.5px] leading-snug">{title}</b>
              <span className="mt-1 block text-[12px] leading-relaxed text-dim">{sub}</span>
            </span>
          </label>
        ))}
      </div>

      <p className="mt-2.5 text-[12px] leading-relaxed text-dim">
        Neither is ticked for you. If you send your application without
        choosing, <b className="text-mute">we read that as no</b> and a person
        reads everything by hand.{" "}
        <a href="https://yaadly.co.uk/how-we-use-ai" target="_blank" rel="noreferrer"
           className="underline underline-offset-2 hover:text-mute">
          How we use AI at Yaadly
        </a>, if you want the whole picture first.
      </p>
    </div>
  );
}

/**
 * The reference, and a way to take it with you.
 *
 * It was printed in a monospace span. On a phone that means selecting six
 * characters by hand, from the one screen somebody is most likely to close.
 * Clipboard access can be refused, so the fallback is to select the text and
 * say so rather than to claim a copy that did not happen.
 */
function CopyRef({ reference }: { reference: string }) {
  const [said, setSaid] = useState("");
  const box = useRef<HTMLSpanElement | null>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(reference);
      setSaid("Copied");
    } catch {
      // No clipboard permission, or an insecure context. Select it instead,
      // which is a real thing the person can then act on.
      const el = box.current;
      if (el && typeof window.getSelection === "function") {
        const r = document.createRange();
        r.selectNodeContents(el);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(r);
        setSaid("Selected, copy it yourself");
      } else {
        setSaid("Write it down");
      }
    }
    window.setTimeout(() => setSaid(""), 2500);
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2.5">
      <span ref={box} className="rounded-lg border border-line2 bg-bg px-3 py-2 font-mono text-[14px] text-ink">
        {reference}
      </span>
      <button type="button" className="upbtn" onClick={() => void copy()}>
        {said || "Copy the reference"}
      </button>
      <span aria-live="polite" className="sr-only">{said}</span>
    </div>
  );
}

/**
 * Progress, scoped to the sitting you are standing in.
 *
 * A nine-item rail used to sit above this flow and was removed on the
 * founder's instruction, 30 Aug 2026, for a good reason: a list of nine things
 * still to do is the first thing anybody saw and it is a reason to close the
 * tab.
 *
 * What is here instead is not that rail coming back. Phase 1 is three screens
 * and about two minutes, and "screen 2 of 3" is reassuring in exactly the way
 * "step 4 of 9" was not. The count comes from the sitting's own length, so it
 * cannot drift from the screens that exist, and it must never be made to span
 * both sittings: that would rebuild the thing that was deleted.
 */
function Progress({ n, total, name }: { n: number; total: number; name: string }) {
  return (
    <div className="jprog">
      <span className="dots" role="presentation">
        {Array.from({ length: total }, (_, i) => (
          <i key={i} className={i < n ? "done" : i === n ? "now" : ""} />
        ))}
      </span>
      {/* aria-hidden, because the sr-only sentence below says the same thing
          in a shape a screen reader can use. Without this both are read out. */}
      <span className="pnum" aria-hidden="true">
        {n + 1} of {total} · {name}
      </span>
      {/* The dots are decoration. This is the sentence a screen reader gets,
          and it is the only one, so it carries the screen name too. */}
      <span className="sr-only" aria-current="step">
        Screen {n + 1} of {total}: {name}
      </span>
    </div>
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
/** What this row will take, in words, read off the accept string it is
 *  already given so the two can never disagree. Before this, the formats and
 *  the 50MB cap lived only in the edge function and the bucket policy, and an
 *  applicant on Jamaican mobile data found out about them by uploading for a
 *  minute and then failing. */
function formatsOf(accept: string): string {
  const has = (x: string) => accept.includes(x);
  const parts: string[] = [];
  if (has("image/")) parts.push("photo");
  if (has("application/pdf")) parts.push("PDF");
  if (has("wordprocessingml") || has("msword")) parts.push("Word");
  if (has("video/")) parts.push("video");
  if (!parts.length) return `Up to ${MAX_MB}MB`;
  const last = parts.pop() as string;
  const list = parts.length ? `${parts.join(", ")} or ${last}` : last;
  return `${list} · up to ${MAX_MB}MB`;
}

/** What to try when a file will not go. An upload that fails with only the
 *  server's sentence on the row leaves somebody with nothing to do about it,
 *  and the two real causes on a phone are a photograph far bigger than the
 *  paper needed and a connection that dropped halfway. */
const RECOVER = `Photograph the paper rather than scanning it, or take the picture again a little further back. Anything over ${MAX_MB}MB is refused. Nothing was stored, so trying again costs you nothing.`;

function Upload({
  label, hint, accept, doc, docs, onFile, capture, cta = "Choose file", optional,
}: {
  label: string;
  hint: string;
  accept: string;
  doc: DocType;
  docs: Record<string, DocState>;
  onFile: (d: DocType, f: File) => void;
  capture?: "user" | "environment";
  cta?: string;
  /** Stated on the row rather than left to be inferred from silence. */
  optional?: boolean;
}) {
  const st = docs[doc]?.state ?? "idle";
  const cur = docs[doc];
  return (
    <div className={"upl" + (st === "done" ? " done" : st === "error" ? " bad" : "")}>
      <div className="uplb">
        <b>
          {st === "done" ? `✓ ${label}` : label}
          {optional && st !== "done" && <> <span className="src opt">Optional</span></>}
        </b>
        {/* aria-live, because the outcome of choosing a file is announced
            nowhere else: the button label goes back to reading "Replace" and a
            screen reader is told nothing at all about whether it worked. */}
        <span aria-live="polite">
          {st === "busy" ? "Sending…"
            : st === "done" ? `${cur?.file} · ${kb(cur?.bytes)} · stored`
            : st === "error" ? cur?.error
            : hint}
        </span>
        {st === "idle" && <span>{formatsOf(accept)}</span>}
        {st === "error" && <span className="rec">{RECOVER}</span>}
      </div>
      <label className="upbtn">
        {st === "busy" ? "Sending…"
          : st === "done" ? "Replace"
          : st === "error" ? "Try again"
          : cta}
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
