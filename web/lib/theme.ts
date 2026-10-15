/* Light and dark mode for the app. The same switch, the same two words
   ("light" and "dark") and the same saved key as docs/theme.js on the
   marketing site. Added 15 Oct 2026 on Monique's instruction: the whole
   site and the app are light by default, with a switch to dark.

   The choice is kept in two places. localStorage is per origin, so a choice
   made on yaadly.co.uk would not reach app.yaadly.co.uk; a cookie set on
   the parent domain .yaadly.co.uk is readable by both, so the two halves of
   the site stay in step. The cookie carries one word and nothing else; it is
   a display preference, never sent to a server by anything here, and raises
   no data protection question. On localhost the domain attribute is left
   off, because a browser refuses a cookie for a domain the page is not on. */

export type Theme = "light" | "dark";

export const THEME_KEY = "yaadly-theme";

/* Runs before first paint, inlined into <head> by app/layout.tsx. Kept as a
   string so it ships as one small script tag and never waits for React.
   It must agree with readTheme() below. */
export const THEME_BOOT_SCRIPT = `(function(){try{var m=document.cookie.match(/(?:^|; )yaadly-theme=(dark|light)/);var t=m?m[1]:null;if(!t){t=localStorage.getItem("yaadly-theme")}if(t==="dark"){document.documentElement.removeAttribute("data-theme")}else{document.documentElement.setAttribute("data-theme","light")}}catch(e){document.documentElement.setAttribute("data-theme","light")}})();`;

export function readTheme(): Theme {
  if (typeof document === "undefined") return "light";
  try {
    const m = document.cookie.match(/(?:^|; )yaadly-theme=(dark|light)/);
    const t = m ? m[1] : localStorage.getItem(THEME_KEY);
    return t === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function applyTheme(mode: Theme) {
  const root = document.documentElement;
  if (mode === "light") root.setAttribute("data-theme", "light");
  else root.removeAttribute("data-theme");
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", mode === "light" ? "#F7F6FC" : "#07071A");
}

const EVENT = "yaadly-theme";

/* For useSyncExternalStore: the switch re-renders when the choice changes,
   here or in another tab. */
export function subscribeTheme(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

export function saveTheme(mode: Theme) {
  try { localStorage.setItem(THEME_KEY, mode); } catch { /* private mode */ }
  try {
    const host = location.hostname;
    const domain = host === "yaadly.co.uk" || host.endsWith(".yaadly.co.uk") ? "; domain=.yaadly.co.uk; Secure" : "";
    document.cookie = `${THEME_KEY}=${mode}; path=/; max-age=31536000; SameSite=Lax${domain}`;
  } catch { /* cookies off */ }
  window.dispatchEvent(new Event(EVENT));
}
