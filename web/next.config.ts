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
// Deliberately no Content-Security-Policy yet. Next injects inline bootstrap
// script, so a CSP here needs nonces wired through the document, and a CSP
// that is wrong breaks the app for real users rather than merely failing to
// protect them. The headers below are the ones that are unambiguous and cost
// nothing to be right about. CSP is worth doing next, on its own, with
// report-only first.
const securityHeaders = [
  // A year, and subdomains, so app/concierge/www cannot be downgraded to http.
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  // The portals show a signed-in session. Nothing should be framing them.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
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
