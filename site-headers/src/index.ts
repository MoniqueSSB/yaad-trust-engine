// yaadly.co.uk had none of the five security headers. GitHub Pages cannot set
// them, so they are set here, on the way past.
//
// The origin response is passed through unchanged apart from the headers. This
// Worker never generates a body, never rewrites HTML and never caches: if it
// were removed tomorrow the site would carry on exactly as it does now, which
// is the property that makes it safe to put in front of a live site.

const HEADERS: Record<string, string> = {
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

// Report-Only to begin with, deliberately.
//
// This page carries a lot of inline script and a Sentry loader, and a CSP that
// is wrong does not fail quietly: it stops the job form working for a real
// client and nobody finds out until they give up and leave. Report-Only means
// the browser tells Sentry what would have been blocked while blocking nothing.
// Read the reports, confirm the allow-list is complete, then rename this one
// header to Content-Security-Policy and it starts enforcing.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://browser.sentry-cdn.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https://leffyisvfvjwzilydlwf.supabase.co https://o4511948007931904.ingest.de.sentry.io",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
].join("; ");

export default {
  async fetch(req: Request): Promise<Response> {
    // Straight to the origin. Cloudflare does not re-run this Worker for its
    // own subrequest to the same route, so this reaches GitHub Pages.
    const res = await fetch(req);
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(HEADERS)) out.headers.set(k, v);
    out.headers.set("Content-Security-Policy-Report-Only", CSP);
    return out;
  },
};
