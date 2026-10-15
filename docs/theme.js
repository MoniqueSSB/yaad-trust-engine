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

   The saved choice lives under "yaadly-theme", in localStorage and in a
   cookie on .yaadly.co.uk so the app sees it too. It is a display
   preference, not personal data, and nothing reads it on a server. */
(function () {
  var KEY = 'yaadly-theme';
  var root = document.documentElement;

  /* The choice is kept in two places. localStorage is per origin, so a
     choice made here would not reach app.yaadly.co.uk; a cookie on the
     parent domain .yaadly.co.uk is readable by both, so the site and the app
     stay in step. One word, never read by a server. On localhost the domain
     attribute is left off, or the browser refuses the cookie. */
  function saved() {
    try {
      var m = document.cookie.match(/(?:^|; )yaadly-theme=(dark|light)/);
      if (m) return m[1];
      return localStorage.getItem(KEY);
    } catch (e) { return null; }
  }
  function save(mode) {
    try { localStorage.setItem(KEY, mode); } catch (e) { /* private mode */ }
    try {
      var host = location.hostname;
      var domain = (host === 'yaadly.co.uk' || /\.yaadly\.co\.uk$/.test(host)) ? '; domain=.yaadly.co.uk; Secure' : '';
      document.cookie = KEY + '=' + mode + '; path=/; max-age=31536000; SameSite=Lax' + domain;
    } catch (e) { /* cookies off */ }
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
      save(next);
    });
  });
})();
