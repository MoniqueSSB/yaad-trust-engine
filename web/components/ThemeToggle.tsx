"use client";

import { useSyncExternalStore } from "react";
import { applyTheme, readTheme, saveTheme, subscribeTheme, type Theme } from "@/lib/theme";

/**
 * The light and dark switch: a knob that slides between a sun and a moon.
 * Same markup and same class names as the marketing site's header
 * (docs/theme.css, .theme-btn), so the two headers look and behave alike.
 * On means dark. The server has no idea what the visitor chose, so it
 * renders the sun; useSyncExternalStore reads the real choice on the client
 * and slides the knob if needed, without a state update inside an effect.
 */
export function ThemeToggle() {
  const mode = useSyncExternalStore(subscribeTheme, readTheme, () => "light" as Theme);
  function flip() {
    const next: Theme = mode === "dark" ? "light" : "dark";
    applyTheme(next);
    saveTheme(next);
  }
  return (
    <button
      type="button"
      role="switch"
      aria-checked={mode === "dark"}
      aria-label="Dark mode"
      className="theme-btn"
      onClick={flip}
    >
      <svg className="ico-sun" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
      <svg className="ico-moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>
      <span className="knob" aria-hidden="true" />
    </button>
  );
}
