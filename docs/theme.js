/* ── Light and dark mode, one file, every page ───────────────────────────
   Written 15 Oct 2026. Loaded in <head> on purpose, before the page paints,
   so a visitor who chose light mode never sees a dark flash first. It is
   tiny and does two things:

   1. On load, read the saved choice ("light" or "dark") and put it on <html>
      as data-theme. theme.css does the rest. No saved choice means LIGHT,
      Monique's decision on 15 Oct 2026. Dark is the original design and is
      still there in full for anyone who presses the button. The visitor's
      operating system setting is deliberately not consulted.

   2. Once the page is ready, wire the switch in the header: a sliding knob
      between a sun and a moon. One press slides it, flips the mode, and
      saves it.

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
    /* The control is a switch: on means dark. Its label stays "Dark mode"
       and aria-checked says which side it is on, so a screen reader hears
       "Dark mode, switch, off" on the light site. */
    var btns = document.querySelectorAll('.theme-btn');
    for (var i = 0; i < btns.length; i++) {
      btns[i].setAttribute('aria-checked', mode === 'dark' ? 'true' : 'false');
    }
  }
  function current() {
    return root.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  }

  apply(saved() === 'dark' ? 'dark' : 'light');

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
