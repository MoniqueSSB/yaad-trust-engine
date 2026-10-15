/* ── Light and dark mode, one file, every page ───────────────────────────
   Written 15 Oct 2026. Loaded in <head> on purpose, before the page paints,
   so a visitor who chose light mode never sees a dark flash first. It is
   tiny and does two things:

   1. On load, read the saved choice ("light" or "dark") and put it on <html>
      as data-theme. theme.css does the rest. No saved choice means dark,
      which is the site as it has always been. The visitor's operating system
      setting is deliberately not consulted: the design was built dark, and
      switching people to light without being asked would change the site
      under them.

   2. Once the page is ready, wire the sun/moon button in the header. One
      press flips the mode, saves it, and updates the button's spoken label.

   The saved choice lives in localStorage under "yaadly-theme". It is a
   display preference, not personal data, and never leaves the browser. */
(function () {
  var KEY = 'yaadly-theme';
  var root = document.documentElement;

  function saved() {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }
  function apply(mode) {
    if (mode === 'light') { root.setAttribute('data-theme', 'light'); }
    else { root.removeAttribute('data-theme'); }
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) { meta.setAttribute('content', mode === 'light' ? '#F7F6FC' : '#07071A'); }
    var btns = document.querySelectorAll('.theme-btn');
    for (var i = 0; i < btns.length; i++) {
      btns[i].setAttribute('aria-label', mode === 'light' ? 'Switch to dark mode' : 'Switch to light mode');
      btns[i].setAttribute('title', mode === 'light' ? 'Dark mode' : 'Light mode');
    }
  }
  function current() {
    return root.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  }

  apply(saved() === 'light' ? 'light' : 'dark');

  document.addEventListener('DOMContentLoaded', function () {
    apply(current());
    document.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('.theme-btn');
      if (!b) return;
      var next = current() === 'light' ? 'dark' : 'light';
      apply(next);
      try { localStorage.setItem(KEY, next); } catch (err) { /* private mode: the choice lasts this page only */ }
    });
  });
})();
