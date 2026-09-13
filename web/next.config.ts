import type { NextConfig } from "next";

// Refuses to build without the Supabase environment. Imported for the side
// effect, deliberately: next.config.ts is loaded by every build path there is,
// including `opennextjs-cloudflare build` and `deploy`, which is what makes it
// the one place a missing value cannot slip past. See the file for the outage
// that caused this.
import "./scripts/check-env.mjs";

// Security headers for app.yaadly.co.uk.
//
// This host carries the client and worker portals: signed-in sessions, job
// evidence, quotes and money figures. It had none of these headers.
//
// Content-Security-Policy, REPORT ONLY. Added 3 Sep 2026.
//
// Report-only was the whole point of doing it now. A wrong CSP breaks the app
// for real people rather than merely failing to protect them, and this one is
// certain to be wrong in at least one place on the first attempt, because the
// only honest way to find the last few sources is to watch a real browser
// complain about them. Report-Only complains and loads the resource anyway.
//
// FOUNDER DECISION, 3 Sep: two weeks in report-only, no collector, then
// enforce. No collector means the violations land in the browser console and
// nowhere else, so finding them is a person opening the site with devtools
// open rather than a dashboard filling up. That is a real limitation and it is
// the right trade at this size: a report endpoint is another service, another
// data-protection question about what it stores, and another thing to run.
//
// TO ENFORCE, on or after 17 Sep 2026: rename the key below from
// "Content-Security-Policy-Report-Only" to "Content-Security-Policy" and
// delete the frame-ancestors-only header above it, which this supersedes.
// Walk every route first: the board, /jobs/new, /apply including the Persona
// step and the camera, the portal, and a Kickoff Pack document. See RUNBOOK.
//
// WHERE EACH SOURCE COMES FROM. Derived from the code, not guessed:
//   'self'                        the app itself
//   'unsafe-inline' on script     Next injects an inline bootstrap script and
//                                 self-hosted font preloads. Removing this
//                                 needs nonces threaded through the document,
//                                 which is its own change; the CSP is worth
//                                 having without it in the meantime.
//   yaadly.co.uk                  chat.js, loaded on every page by layout.tsx
//   *.supabase.co                 the API, and signed URLs for evidence and
//                                 client photographs, which are images
//   withpersona.com               the identity check on /apply runs in an
//                                 iframe from inquiry.withpersona.com and
//                                 talks back to its own API
//   data: and blob: on img        EXIF-stripped previews and older evidence
//                                 rows that still hold a data URL
// Fonts are self-hosted by next/font at build time, so there is deliberately
// no font-src entry for Google. cal.com, wa.me and api.hubapi.com are links or
// server-side calls, never browser loads, so they are absent on purpose.
const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline' https://yaadly.co.uk",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.supabase.co https://yaadly.co.uk",
  "media-src 'self' blob: https://*.supabase.co",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co https://yaadly.co.uk https://*.withpersona.com",
  "frame-src https://*.withpersona.com",
  "worker-src 'self' blob:",
].join("; ");
const securityHeaders = [
  // A year, and subdomains, so app/concierge/www cannot be downgraded to http.
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  // The portals show a signed-in session. Nothing should be framing them.
  { key: "X-Frame-Options", value: "DENY" },
  // Kept enforcing while the full policy is report-only, because this one
  // clause has been proven in production and there is no reason to downgrade
  // it to a warning while the rest is being watched. Delete it when the full
  // policy is enforced; frame-ancestors is already in there.
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "Content-Security-Policy-Report-Only", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Job ids and portal codes can appear in a path. Do not leak them to
  // whatever a client clicks through to next.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // camera=(self), and the reason is the whole of step 3 of the join flow.
  //
  // This read camera=() until the live capture shipped. An empty allowlist is
  // not "ask the user", it is "deny, to everyone, including this site". So
  // /apply would have called getUserMedia, been refused by the platform before
  // any permission prompt could appear, and fallen back to a file upload for
  // every applicant on every device. The page would have gone on saying it
  // opens the camera while never once opening one, which is precisely the
  // fault the live capture was built to remove.
  //
  // (self) is not a grant. It says the platform will stop blocking our own
  // origin from asking; the browser still prompts, and the applicant can still
  // refuse, and LiveCapture says the word upload on the row when they do.
  //
  // microphone stays fully denied: the face turn is captured with audio:false
  // and nothing on this host has any business with a microphone. geolocation
  // likewise. Worth tightening camera to /apply alone later, but a per-path
  // Permissions-Policy needs two non-overlapping header rules, and a browser
  // seeing two of this header takes the more restrictive one, so a mistake
  // there kills the feature silently. Not worth it untested.
  //
  // "https://inquiry.withpersona.com" is in the camera allowlist because the
  // Persona ID check on /apply runs in an iframe from that origin, and a
  // cross-origin iframe needs BOTH its allow attribute (Persona's client sets
  // that) AND this header to name it. With (self) alone the platform refuses
  // Persona's camera request before any prompt can appear, the flow errors,
  // and every applicant silently lands on the fallback capture: the same
  // shape of failure the camera=() outage had, one origin further down.
  { key: "Permissions-Policy", value: 'camera=(self "https://inquiry.withpersona.com"), microphone=(), geolocation=()' },
];

const nextConfig: NextConfig = {
  // Evidence photographs arrive through a Server Action, and Next caps a
  // Server Action body at 1MB by default. A photograph off any phone made in
  // the last decade is 2 to 5MB, so every real evidence upload was refused by
  // the platform BEFORE the route's own size check could run, and the worker
  // was told "The database refused this upload." The database never saw it.
  //
  // This is the ceiling for the whole multipart body, so it sits above the
  // per-image limit in app/portal/evidence-actions.ts rather than matching it.
  // The two are meant to be read together: this one stops the request, that
  // one explains itself to the person holding the phone. The headroom is
  // affordable because the bytes go to the evidence bucket, not into a row.
  experimental: {
    serverActions: { bodySizeLimit: "25mb" },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
