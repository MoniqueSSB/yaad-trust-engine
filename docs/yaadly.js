/* Shared behaviour for the marketing pages: reveal on scroll, and the trust
   engine animation on the marketplace page.

   Everything here is decoration. The pages are readable and complete with this
   file blocked, which is why html.jsrv is set from script rather than sitting
   in the stylesheet: no script, nothing ever hidden. */

/* Reveal on scroll. Set the flag first so the initial hidden state applies
   only when we are actually able to reveal things again. */
document.documentElement.classList.add('jsrv');
(function(){
  var els = document.querySelectorAll('.rv');
  if(!els.length) return;
  if(!('IntersectionObserver' in window)){
    els.forEach(function(n){ n.classList.add('on') });
    return;
  }
  var io = new IntersectionObserver(function(entries){
    entries.forEach(function(e){
      if(e.isIntersecting){ e.target.classList.add('on'); io.unobserve(e.target); }
    });
  }, {threshold:.12, rootMargin:'0px 0px -40px 0px'});
  els.forEach(function(n){ io.observe(n) });
})();

/* The trust engine. Six evidence tiles light in order, then the lock opens and
   the money moves, once, when the client approves. It only runs when it is
   scrolled into view, and reduced-motion gets the finished state directly. */
(function(){
  var eng = document.getElementById('engine');
  if(!eng) return;

  var EV = [
    ['Arrival photos landed, geotagged 09:41.','J$66,800','J$0','Not yet paid','Working'],
    ['The damage, before he touched it.','J$66,800','J$0','Not yet paid','Working'],
    ['Materials bought, receipt filed against the job.','J$66,800','J$0','Not yet paid','Working'],
    ['Same angle, after. That is the standard.','J$66,800','J$0','Not yet paid','Working'],
    ['Walk-round clip. Nothing hidden off camera.','J$66,800','J$0','Not yet paid','Evidence complete'],
    ['<b>You signed it off.</b> Paid, and only now.','J$0','J$66,800','Paid','Paid in 3 working days']
  ];

  var $ = function(id){ return document.getElementById(id) };
  var tiles = eng.querySelectorAll('.eng-ev i');
  var cap = $('eng-cap'), lab = $('eng-lab'), lock = $('eng-lock'),
      you = $('eng-you'), wk = $('eng-w'), you2 = $('eng-you2'), w2 = $('eng-w2');
  var LOCKED = lock.innerHTML, OPEN = '<span class="lockem">🔓</span>';
  var i = -1, t = null;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function reset(){
    i = -1; eng.classList.remove('open'); lock.innerHTML = LOCKED;
    tiles.forEach(function(n){ n.classList.remove('on') });
    cap.innerHTML = '<b>Nothing has reached him yet.</b> He starts because he can see the job is funded, not because you sent him money.';
    lab.textContent = 'Not yet paid'; you.textContent = 'J$66,800'; wk.textContent = 'J$0';
    you2.textContent = 'Funding stage one'; w2.textContent = 'Can see the money is real';
  }
  function step(){
    i++;
    if(i >= EV.length){ t = setTimeout(function(){ reset(); t = setTimeout(step, 1400) }, 3600); return }
    tiles[i].classList.add('on');
    var e = EV[i];
    cap.innerHTML = e[0]; you.textContent = e[1]; wk.textContent = e[2];
    lab.textContent = e[3]; w2.textContent = e[4];
    if(i === EV.length - 1){ eng.classList.add('open'); lock.innerHTML = OPEN; you2.textContent = 'Approved by you'; }
    t = setTimeout(step, 1250);
  }

  if(reduce){
    tiles.forEach(function(n){ n.classList.add('on') });
    eng.classList.add('open'); lock.innerHTML = OPEN;
    cap.innerHTML = '<b>You signed it off.</b> Paid, and only now.';
    lab.textContent = 'Paid'; you.textContent = 'J$0'; wk.textContent = 'J$66,800';
    you2.textContent = 'Approved by you'; w2.textContent = 'Paid in 3 working days';
    return;
  }
  if('IntersectionObserver' in window){
    var seen = false;
    var io = new IntersectionObserver(function(es){
      es.forEach(function(e){
        if(e.isIntersecting && !seen){ seen = true; t = setTimeout(step, 600); io.disconnect(); }
      });
    }, {threshold:.3});
    io.observe(eng);
  } else {
    t = setTimeout(step, 900);
  }
})();
