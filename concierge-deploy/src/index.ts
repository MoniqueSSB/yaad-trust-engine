// The desk, served with security headers on every response.
//
// A _headers file was tried first. Cloudflare Access sits in front of this
// hostname and answers unauthenticated requests with a 302 of its own, so
// there is no way to confirm from outside whether asset headers are being
// applied: every curl from the internet sees Access, not the asset. A header
// you cannot observe is a header you cannot trust, so this sets them in code,
// where the behaviour is testable with `wrangler dev` and obvious to read.
//
// frame-ancestors and X-Frame-Options are the ones that matter here. Access
// stops a stranger loading the desk. It does not stop a page the admin is
// already visiting from framing it and borrowing that live session.
const HEADERS: Record<string, string> = {
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Cross-Origin-Opener-Policy": "same-origin",
  // The desk is one inline script and one inline style block, so 'unsafe-inline'
  // is unavoidable without rewriting it. The directives that still earn their
  // place are the ones that bound where anything may be loaded from or sent to:
  // connect-src pins the only backend it may talk to, and frame-ancestors
  // cannot be defeated by injected markup the way a missing X-Frame-Options can.
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://unpkg.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "connect-src 'self' https://leffyisvfvjwzilydlwf.supabase.co",
    "frame-src 'self' blob: data:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; "),
};

export default {
  async fetch(req: Request, env: { ASSETS: Fetcher }): Promise<Response> {
    const res = await env.ASSETS.fetch(req);
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(HEADERS)) out.headers.set(k, v);
    return out;
  },
};
