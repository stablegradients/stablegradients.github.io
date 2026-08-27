/* ===========================================================================
   Page-wide behavior: sticky section nav, BibTeX copy, reduced-motion image
   swap, code-iframe sizing, and keyboard safety for not-yet-live links.

   Vanilla ES5, no dependencies, no globals. Everything here is progressive
   enhancement: with JavaScript off the page still reads, the figures still
   show, and the disclosures still open.
   ========================================================================= */
(function () {
  'use strict';

  /* ---- reduced motion: swap animated GIFs for their static frame --------- */
  var mq = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
  if (mq && mq.matches) {
    [].slice.call(document.querySelectorAll('img[data-static]')).forEach(function (img) {
      img.src = img.getAttribute('data-static');
    });
  }

  /* ---- code.html reports its rendered height so the iframe can fit it ---- */
  window.addEventListener('message', function (e) {
    if (!e.data || typeof e.data.tailrlCodeHeight !== 'number') return;
    var frame = document.getElementById('tailrl-code-frame');
    if (frame) frame.style.height = e.data.tailrlCodeHeight + 'px';
  });

  /* ---- sticky nav: highlight the section currently in view --------------- */
  var links = [].slice.call(document.querySelectorAll('.pagenav .links a'));
  var targets = links.map(function (a) { return document.querySelector(a.getAttribute('href')); });
  if (links.length && 'IntersectionObserver' in window) {
    var seen = {};
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { seen[en.target.id] = en.isIntersecting ? en.intersectionRatio : 0; });
      var bestId = null, best = 0;
      targets.forEach(function (t) {
        if (t && (seen[t.id] || 0) > best) { best = seen[t.id]; bestId = t.id; }
      });
      links.forEach(function (a) {
        a.classList.toggle('current', bestId !== null && a.getAttribute('href') === '#' + bestId);
      });
    }, { rootMargin: '-64px 0px -55% 0px', threshold: [0, 0.15, 0.5, 1] });
    targets.forEach(function (t) { if (t) io.observe(t); });
  }

  var jump = document.getElementById('pagenav-jump');
  if (jump) {
    jump.addEventListener('change', function () {
      if (!jump.value) return;
      var el = document.querySelector(jump.value);
      if (el) el.scrollIntoView({ behavior: mq && mq.matches ? 'auto' : 'smooth', block: 'start' });
      jump.value = '';
    });
  }

  /* ---- copy BibTeX ------------------------------------------------------- */
  var copyBtn = document.getElementById('copy-bibtex');
  var status = document.getElementById('copy-status');
  if (copyBtn) {
    copyBtn.addEventListener('click', function () {
      var src = document.getElementById(copyBtn.getAttribute('data-target'));
      if (!src) return;
      var text = src.textContent;
      function done(ok) {
        if (status) {
          status.textContent = ok ? 'Copied to clipboard' : 'Press Ctrl/Cmd+C to copy';
          setTimeout(function () { status.textContent = ''; }, 3000);
        }
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { done(true); }, function () { selectFallback(src); done(false); });
      } else { selectFallback(src); done(false); }
    });
  }
  function selectFallback(node) {
    try {
      var r = document.createRange(); r.selectNodeContents(node);
      var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
    } catch (e) {}
  }

  /* ---- links that are not live yet ---------------------------------------
     CSS already removes pointer events; this also keeps them out of the tab
     order and stops Enter/Space from doing nothing confusing.               */
  [].slice.call(document.querySelectorAll('[aria-disabled="true"]')).forEach(function (el) {
    el.setAttribute('tabindex', '-1');
    el.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') e.preventDefault();
    });
  });
})();
