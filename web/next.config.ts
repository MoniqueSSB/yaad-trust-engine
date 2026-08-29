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
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
