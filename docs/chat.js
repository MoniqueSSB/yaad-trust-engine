/* The chat in the corner of yaadly.co.uk.
 *
 * Same brain as WhatsApp. Every message here goes to yaad-inbound on the
 * "web" channel, which runs the intake assistant that answers the Yaadly
 * WhatsApp number: same prompt, same rule that it never quotes a price, same
 * banned-language screen, same handoff after three turns or the moment the
 * visitor asks for a person. The conversation lands in the desk's
 * Conversations view like any other thread.
 *
 * Reaching Monique works two ways. While the page is open the widget polls
 * for her replies (web_chat_replies, written from the desk) and shows them
 * as her. And when the assistant hands over, it also shows a WhatsApp
 * button pre-filled with the visitor's reference, for the visitor who is
 * about to close the tab; yaad-inbound recognises that reference on the
 * number's first message and carries the web conversation across, so
 * nobody says it twice.
 *
 * What this file deliberately does not do: talk to any model itself, store
 * anything but the visitor's own transcript in their own browser, or send a
 * single byte before the visitor types something. The launcher is inert
 * until clicked. No third-party script, no cookie.
 */
(function () {
  if (document.getElementById('yc-launch')) return;
  // The same file is loaded by the app (app.yaadly.co.uk, web/app/layout.tsx).
  // Not on the worker's portal: that surface stays thin on purpose (CLAUDE.md
  // §9), and a worker mid-job typing "photos coming" into a client intake
  // assistant would open a draft job in the desk. Everywhere else, yes.
  if (/^\/portal\/worker(\/|$)/.test(location.pathname)) return;

  var INBOUND_URL = 'https://leffyisvfvjwzilydlwf.supabase.co/functions/v1/yaad-inbound';
  var PUBLISHABLE_KEY = 'sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz';
  var WA_NUMBER = '447878877567';
  var STORE = 'yaadly-chat-v1';
  var MAX_KEPT = 40;

  var OPENER = 'Hi. I can answer questions about how Yaadly works, or take down a job for a property in Jamaica. What do you need?';
  var OPENER_NOTE = 'I do not quote prices. Vetted workers quote against a written scope, so nobody is marking up their own estimate.';
  var PRIVACY = 'Read by an automated assistant and by Monique. Please do not put ID documents or card details in here.';

  /* ---------- state, kept in this browser only ---------- */
  var state = { visitor: '', msgs: [], ref: '', handoff: false, lastReply: 0 };
  function load() {
    try {
      var raw = localStorage.getItem(STORE);
      if (raw) { var j = JSON.parse(raw); if (j && typeof j === 'object') state = j; }
    } catch (_) {}
    if (!/^[a-f0-9]{24,64}$/.test(state.visitor || '')) state.visitor = mint();
    if (!Array.isArray(state.msgs)) state.msgs = [];
    if (!Number.isFinite(Number(state.lastReply))) state.lastReply = 0;
  }
  function save() {
    try {
      var copy = { visitor: state.visitor, msgs: state.msgs.slice(-MAX_KEPT), ref: state.ref || '', handoff: !!state.handoff, lastReply: Number(state.lastReply) || 0 };
      localStorage.setItem(STORE, JSON.stringify(copy));
    } catch (_) {}
  }
  function mint() {
    var b = new Uint8Array(16);
    if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(b);
    else for (var i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
    var s = '';
    for (var k = 0; k < b.length; k++) s += (b[k] < 16 ? '0' : '') + b[k].toString(16);
    return s;
  }

  /* ---------- styles, self-contained so every page gets them ---------- */
  var css = ''
    /* The launcher is a tab on the right edge of every page, mid height, and
       the chat is a drawer down that side (founder, 2 Sep 2026: "add this
       chat on the side of every page"). The right edge is the chat's; the
       homepage's WhatsApp float moved to the left for it.

       z-index 2400 is above everything the site uses (the highest today is
       300, the homepage's own sticky nav, which painted straight over the
       drawer's header at 81 until this was raised) with room left above it
       for whatever a page adds next. */
    + '#yc-launch{position:fixed;right:0;top:50%;transform:translateY(-50%);z-index:2400;display:inline-flex;flex-direction:column;align-items:center;gap:10px;padding:16px 11px 18px;border-radius:14px 0 0 14px;border:1px solid rgba(196,170,255,.35);border-right:0;'
    + 'background:linear-gradient(180deg,#7B4FE0,#9B73F5 55%,#F59E0B);color:#fff;font:700 13px/1 "IBM Plex Sans",-apple-system,sans-serif;letter-spacing:.4px;cursor:pointer;box-shadow:-8px 0 28px rgba(20,10,60,.45)}'
    + '#yc-launch[hidden]{display:none}'
    + '#yc-launch span{writing-mode:vertical-rl;transform:rotate(180deg);white-space:nowrap}'
    + '#yc-launch:hover{filter:brightness(1.08);padding-right:14px}'
    + '#yc-launch svg{width:20px;height:20px;fill:none;stroke:#fff;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}'
    + '#yc-panel{position:fixed;right:0;top:0;z-index:2401;width:min(400px,100vw);height:100dvh;display:flex;flex-direction:column;'
    + 'background:#0d0d24;color:#EEEEFF;border-left:1px solid rgba(155,115,245,.28);box-shadow:-24px 0 60px rgba(0,0,0,.55);overflow:hidden;font:15px/1.5 "IBM Plex Sans",-apple-system,sans-serif;animation:yc-in .22s ease-out}'
    + '@keyframes yc-in{from{transform:translateX(24px);opacity:0}to{transform:none;opacity:1}}'
    + '#yc-panel[hidden]{display:none}'
    /* On a phone the mid-height right-edge tab sits ON the form. It is fixed,
       nothing reserves room for it, and at 375px it covered the right edge of
       every input card on /jobs/new and /apply: the two pages where a stranger
       is being asked to type. A launcher that hides the thing it is offering
       help with is worse than no launcher.

       Under 700px it becomes an ordinary bottom-right pill instead, which is
       where a phone user already looks for one, and which clears the middle of
       the screen where the fields are. The homepage's WhatsApp float is on the
       LEFT (it moved there for this chat), so the two do not collide. The
       safe-area inset keeps it off the home indicator on an iPhone. */
    + '@media(max-width:700px){'
    +   '#yc-launch{top:auto;bottom:calc(16px + env(safe-area-inset-bottom));right:14px;transform:none;'
    +     'flex-direction:row;gap:8px;padding:11px 16px;border-radius:100px;border-right:1px solid rgba(196,170,255,.35);'
    +     'font-size:13px;box-shadow:0 8px 24px rgba(20,10,60,.5)}'
    +   '#yc-launch span{writing-mode:horizontal-tb;transform:none}'
    +   '#yc-launch:hover{padding-right:16px}'
    + '}'
    + '@media(max-width:480px){#yc-launch{padding:10px 14px;font-size:12px}#yc-launch svg{width:17px;height:17px}}'
    + '@media(prefers-reduced-motion:reduce){#yc-panel{animation:none}}'
    + '.yc-head{display:flex;align-items:center;gap:10px;padding:13px 14px;border-bottom:1px solid rgba(155,115,245,.18);background:rgba(155,115,245,.07)}'
    + '.yc-mark{width:32px;height:32px;border-radius:9px;background:linear-gradient(135deg,#7B4FE0,#5A28B8);display:grid;place-items:center;color:#fff;font:600 17px Fraunces,Georgia,serif}'
    + '.yc-title{flex:1;min-width:0}.yc-title b{display:block;font-size:15px}.yc-title span{display:block;font-size:12px;color:#9a9ac4}'
    + '.yc-close{background:none;border:0;color:#9a9ac4;font-size:22px;line-height:1;cursor:pointer;padding:4px 8px;border-radius:8px}.yc-close:hover{background:rgba(155,115,245,.14);color:#fff}'
    + '.yc-log{flex:1;overflow-y:auto;padding:14px 14px 6px;display:flex;flex-direction:column;gap:9px;scroll-behavior:smooth}'
    + '.yc-m{max-width:86%;padding:10px 13px;border-radius:14px;white-space:pre-wrap;word-wrap:break-word;font-size:14.5px}'
    + '.yc-m.bot{align-self:flex-start;background:rgba(155,115,245,.13);border:1px solid rgba(155,115,245,.2);border-bottom-left-radius:5px}'
    + '.yc-m.me{align-self:flex-end;background:linear-gradient(135deg,#7B4FE0,#9B73F5);color:#fff;border-bottom-right-radius:5px}'
    + '.yc-m.human{align-self:flex-start;background:rgba(245,158,11,.10);border:1px solid rgba(245,158,11,.35);border-bottom-left-radius:5px}'
    + '.yc-m.human i{display:block;font-style:normal;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#F59E0B;margin-bottom:3px}'
    + '.yc-m.note{align-self:flex-start;background:none;border:0;color:#9a9ac4;font-size:12.5px;padding:0 4px;max-width:100%}'
    + '.yc-m.bad{align-self:flex-start;background:rgba(248,113,113,.1);border:1px solid rgba(248,113,113,.3);color:#fca5a5;font-size:13.5px}'
    + '.yc-m a{color:#C4AAFF}'
    + '.yc-typing{align-self:flex-start;color:#9a9ac4;font-size:13px;padding:2px 6px}'
    + '.yc-wa{align-self:stretch;margin:4px 0 2px;padding:12px 13px;border-radius:14px;border:1px solid rgba(37,211,102,.35);background:rgba(37,211,102,.08)}'
    + '.yc-wa p{margin:0 0 9px;font-size:13.5px;color:#cfd0ea}'
    + '.yc-wa a{display:inline-flex;align-items:center;gap:8px;background:#25D366;color:#062a12;font-weight:700;font-size:14px;padding:10px 16px;border-radius:100px;text-decoration:none}'
    + '.yc-wa a svg{width:18px;height:18px}'
    + '.yc-wa small{display:block;margin-top:8px;font-size:12px;color:#9a9ac4}'
    + '.yc-form{display:flex;gap:8px;padding:10px 12px;border-top:1px solid rgba(155,115,245,.18);background:rgba(155,115,245,.05)}'
    + '.yc-form textarea{flex:1;resize:none;min-height:42px;max-height:120px;padding:10px 12px;border-radius:12px;border:1px solid rgba(155,115,245,.28);background:#07071A;color:#EEEEFF;font-family:inherit;font-size:14.5px;line-height:1.4;outline:none}'
    + '.yc-form textarea:focus{border-color:#9B73F5}'
    + '.yc-form button{align-self:flex-end;height:42px;padding:0 16px;border-radius:12px;border:0;background:linear-gradient(135deg,#7B4FE0,#9B73F5);color:#fff;font-family:inherit;font-size:14px;font-weight:700;cursor:pointer}'
    + '.yc-form button:disabled{opacity:.55;cursor:default}'
    + '.yc-foot{padding:6px 14px 10px;font-size:11.5px;color:#7878A8;background:rgba(155,115,245,.05)}'
    + '@media(prefers-reduced-motion:reduce){.yc-log{scroll-behavior:auto}}';
  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  /* ---------- markup ---------- */
  var CHAT_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a8 8 0 0 1-8 8H8l-5 3 1.5-4.5A8 8 0 1 1 21 12z"/></svg>';
  var WA_ICON = '<svg viewBox="0 0 24 24" fill="#062a12" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.6.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.8 12 12 0 0 0 4.6 4c1.7.7 2.3.8 3.2.7a2.7 2.7 0 0 0 1.8-1.3 2.2 2.2 0 0 0 .2-1.3c-.1-.1-.3-.2-.5-.3z"/></svg>';

  var launch = document.createElement('button');
  launch.id = 'yc-launch';
  launch.type = 'button';
  launch.setAttribute('aria-haspopup', 'dialog');
  launch.innerHTML = CHAT_ICON + '<span>Ask Yaadly</span>';

  var panel = document.createElement('section');
  panel.id = 'yc-panel';
  panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Chat with Yaadly');
  panel.innerHTML = ''
    + '<div class="yc-head"><div class="yc-mark">Y</div>'
    + '<div class="yc-title"><b>Yaadly</b><span>Assistant here. Monique on WhatsApp.</span></div>'
    + '<button type="button" class="yc-close" aria-label="Close chat" title="Close">&rsaquo;</button></div>'
    + '<div class="yc-log" id="yc-log" aria-live="polite"></div>'
    + '<form class="yc-form" id="yc-form"><textarea id="yc-in" rows="1" maxlength="1500" placeholder="Type here" aria-label="Your message"></textarea>'
    + '<button type="submit" id="yc-send">Send</button></form>'
    + '<div class="yc-foot">' + PRIVACY + '</div>';

  document.body.appendChild(launch);
  document.body.appendChild(panel);

  var log = panel.querySelector('#yc-log');
  var form = panel.querySelector('#yc-form');
  var input = panel.querySelector('#yc-in');
  var sendBtn = panel.querySelector('#yc-send');
  var closeBtn = panel.querySelector('.yc-close');

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function bubble(kind, text, html) {
    var d = document.createElement('div');
    d.className = 'yc-m ' + kind;
    if (html) d.innerHTML = html; else d.textContent = text;
    log.appendChild(d);
    log.scrollTop = log.scrollHeight;
    return d;
  }
  function waLink(ref) {
    var text = ref
      ? 'Hello Yaadly, my web chat reference is ' + ref + '.'
      : 'Hello Yaadly, I was chatting on your website and would like to carry on here.';
    return 'https://wa.me/' + WA_NUMBER + '?text=' + encodeURIComponent(text);
  }
  function human(text) {
    var d = document.createElement('div');
    d.className = 'yc-m human';
    var tag = document.createElement('i'); tag.textContent = 'Monique';
    d.appendChild(tag);
    d.appendChild(document.createTextNode(text));
    log.appendChild(d);
    log.scrollTop = log.scrollHeight;
  }
  function waCard(ref) {
    var old = log.querySelector('.yc-wa');
    if (old) old.remove();
    var d = document.createElement('div');
    d.className = 'yc-wa';
    d.innerHTML = '<p>Monique will answer here when she picks this up. Leaving the page? Carry on on WhatsApp instead; everything you wrote here comes with you.</p>'
      + '<a href="' + waLink(ref) + '" target="_blank" rel="noopener">' + WA_ICON + 'Continue on WhatsApp</a>'
      + (ref ? '<small>Your reference is ' + esc(ref) + '. It is already in the message.</small>' : '');
    log.appendChild(d);
    log.scrollTop = log.scrollHeight;
  }
  function render() {
    log.innerHTML = '';
    bubble('bot', OPENER);
    bubble('note', OPENER_NOTE);
    for (var i = 0; i < state.msgs.length; i++) {
      var m = state.msgs[i];
      if (m.who === 'monique') human(m.text);
      else bubble(m.who === 'me' ? 'me' : 'bot', m.text);
    }
    if (state.handoff) waCard(state.ref);
  }

  /* ---------- Monique's replies, fetched while the panel is open ---------- */
  var pollTimer = null;
  function poll() {
    if (!open || !state.ref) return;
    fetch(INBOUND_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': PUBLISHABLE_KEY, 'Authorization': 'Bearer ' + PUBLISHABLE_KEY },
      body: JSON.stringify({ channel: 'web', visitor: state.visitor, poll: true, after: Number(state.lastReply) || 0 })
    }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      if (!j || !Array.isArray(j.replies) || !j.replies.length) return;
      var card = log.querySelector('.yc-wa');
      for (var i = 0; i < j.replies.length; i++) {
        var rp = j.replies[i];
        if (Number(rp.id) <= Number(state.lastReply)) continue;
        human(rp.text);
        state.msgs.push({ who: 'monique', text: rp.text });
        state.lastReply = Number(rp.id);
      }
      if (card) log.appendChild(card);
      log.scrollTop = log.scrollHeight;
      save();
    }).catch(function () { /* next tick */ });
  }
  function startPolling() {
    if (pollTimer) return;
    poll();
    pollTimer = setInterval(poll, 6000);
  }
  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  var open = false;
  function openPanel() {
    if (!open) { load(); render(); }
    open = true;
    panel.hidden = false;
    launch.hidden = true;
    startPolling();
    setTimeout(function () { input.focus(); }, 50);
  }
  function closePanel() {
    open = false;
    stopPolling();
    panel.hidden = true;
    launch.hidden = false;
    launch.focus();
  }
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) stopPolling(); else if (open) startPolling();
  });
  launch.addEventListener('click', openPanel);
  closeBtn.addEventListener('click', closePanel);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && open) closePanel(); });

  input.addEventListener('input', function () {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  });
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit ? form.requestSubmit() : send(); }
  });

  var busy = false;
  form.addEventListener('submit', function (e) { e.preventDefault(); send(); });

  function send() {
    var text = (input.value || '').trim();
    if (!text || busy) return;
    busy = true;
    sendBtn.disabled = true;
    input.value = '';
    input.style.height = 'auto';
    bubble('me', text);
    state.msgs.push({ who: 'me', text: text });
    save();
    var typing = document.createElement('div');
    typing.className = 'yc-typing';
    typing.textContent = 'Reading that';
    log.appendChild(typing);
    log.scrollTop = log.scrollHeight;

    var ctrl = window.AbortController ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 40000) : null;
    fetch(INBOUND_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': PUBLISHABLE_KEY, 'Authorization': 'Bearer ' + PUBLISHABLE_KEY },
      body: JSON.stringify({ channel: 'web', visitor: state.visitor, text: text }),
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, status: r.status, body: j }; });
    }).then(function (res) {
      typing.remove();
      if (!res.ok || !res.body || !res.body.reply) {
        var why = (res.body && res.body.error) ? res.body.error : 'That did not send.';
        bubble('bad', '', esc(why) + ' You can also <a href="' + waLink(state.ref) + '" target="_blank" rel="noopener">carry on on WhatsApp</a>.');
        return;
      }
      bubble('bot', res.body.reply);
      state.msgs.push({ who: 'bot', text: res.body.reply });
      if (res.body.reference) state.ref = res.body.reference;
      if (res.body.handoff) { state.handoff = true; waCard(state.ref); }
      save();
      startPolling();
    }).catch(function () {
      typing.remove();
      bubble('bad', '', 'That did not send, most likely a connection problem on your end. You can also <a href="' + waLink(state.ref) + '" target="_blank" rel="noopener">carry on on WhatsApp</a>.');
    }).then(function () {
      if (timer) clearTimeout(timer);
      busy = false;
      sendBtn.disabled = false;
      input.focus();
    });
  }
})();
