// The website chat door, the parts of it that can be tested without a
// database: what counts as a visitor token, which origins the widget may be
// served from, the reference format a visitor carries over to WhatsApp, and
// the holding reply used when the screen blocks a web answer.
//
// The widget itself is docs/chat.js. It posts {channel: "web", visitor, text}
// to yaad-inbound, which runs the same intake assistant it runs for WhatsApp
// and returns the reply as JSON instead of TwiML. The throttle that stands
// in for authentication on this door lives in index.ts because it needs the
// database; everything here is pure.

/** A visitor token is 24 to 64 lowercase hex characters, minted by the
 *  widget with crypto.getRandomValues and kept in localStorage. It is the
 *  thread key where a phone number would be, and it names nobody: it exists
 *  so the second message reads against the first. Anything else is refused
 *  rather than written into intake_threads.from_addr as a stranger's text. */
export function visitorTokenOk(v: unknown): boolean {
  return typeof v === "string" && /^[a-f0-9]{24,64}$/.test(v);
}

/** Where the widget may be served from. An Origin header is set by the
 *  browser, not the page, so a script on somebody else's site cannot post
 *  through this door from a visitor's browser. It is not authentication (a
 *  script outside a browser can write any header it likes), which is why
 *  the throttle exists as well; it is the cheap check that stops the
 *  ordinary case. The two local static servers from .claude/launch.json
 *  (site and site-alt) are here because the widget is verified in a browser
 *  on one of them before every change ships, and allowing them costs
 *  nothing the throttle does not already cover. */
export const WEB_CHAT_ORIGINS = new Set([
  "https://yaadly.co.uk",
  "https://www.yaadly.co.uk",
  // The app carries the same widget (loaded from yaadly.co.uk/chat.js in
  // web/app/layout.tsx) since 2 Sep 2026: "add this chat on the side of
  // every page". localhost:3000 is the app's dev server.
  "https://app.yaadly.co.uk",
  "http://localhost:3000",
  "http://localhost:8932",
  "http://127.0.0.1:8932",
  "http://localhost:8933",
  "http://127.0.0.1:8933",
]);

export function originAllowed(origin: string | null): boolean {
  return !!origin && WEB_CHAT_ORIGINS.has(origin.trim().toLowerCase());
}

/** The longest message the door accepts. A phone screen's worth, several
 *  times over; a real person describing a leaking roof does not need more,
 *  and the model's context budget is not for a pasted document. */
export const WEB_CHAT_MAX_CHARS = 1500;

/** The reference a web visitor carries over to WhatsApp. yaad-inbound names
 *  every job by the door it came through, so a web chat is JOB-WEB-<ms>. The
 *  WhatsApp lane looks for one of these in the first message from a number
 *  and adopts the web thread, so "you will not have to say it twice" is
 *  true rather than merely said. */
export function webReferenceIn(text: string): string | null {
  const m = String(text ?? "").match(/\bJOB-WEB-\d{10,16}\b/i);
  return m ? m[0].toUpperCase() : null;
}

/** What a web visitor gets instead of a reply that failed the banned-language
 *  screen. Its WhatsApp sibling in guardrails.ts promises "somebody will come
 *  back to you on this number", which is true there and false here: on the
 *  web the way to reach a person is the WhatsApp button, so that is what this
 *  says. Deliberately nothing about money, timing or the job, for the same
 *  reason as the original: the draft that triggered this is not trustworthy. */
export const WEB_SAFE_FALLBACK =
  "Thanks for your message, I have got it. Let me pass this one to a person at Yaadly "
  + "rather than answer it myself. Monique will answer here when she picks it up, or carry on with her on WhatsApp if you are leaving this page.";
