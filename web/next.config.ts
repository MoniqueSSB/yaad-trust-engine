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
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
