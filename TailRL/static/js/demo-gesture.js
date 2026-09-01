/* ===========================================================================
   "This is interactive" hint.

   A widget that responds to dragging looks exactly like a static chart until
   someone tries. The first time one scrolls into view, a pointer glyph slides
   across it and performs a real drag, so the reader sees the thing move and
   knows it will move for them.

   The gesture drives the widget through ordinary pointer events rather than
   faking an animation, so what the reader watches is the widget actually
   working. It runs once per widget per page load, never repeats, and gets out
   of the way the moment a real pointer, key, wheel or touch arrives.

   Vanilla ES5, no dependencies, no globals.
   ========================================================================= */
(function () {
  'use strict';

  if (!('IntersectionObserver' in window) || !window.PointerEvent) return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  /* Each entry names the surface to demonstrate on, and where to drag in that
     surface's own viewBox units, which keeps the path independent of how wide
     the widget happens to render. */
  var DEMOS = [
    { sel: '#ex-svg-rewards', vb: [760, 285],
      from: [250, 190], to: [520, 140], via: [385, 58] },
    { sel: '#smt-hist-a', vb: [360, 220],
      from: [150, 120], to: [250, 70], via: [200, 86] }
  ];

  var CURSOR_SVG =
    '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">' +
    '<path d="M5 2 L5 19 L9.2 15.1 L12 21.5 L15 20.1 L12.2 13.9 L18 13.6 Z"' +
    ' fill="#1f2937" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg>';

  function ptOf(svg, vb, p) {
    var r = svg.getBoundingClientRect();
    return { x: r.left + (p[0] / vb[0]) * r.width, y: r.top + (p[1] / vb[1]) * r.height };
  }
  /* The gesture's own events bubble to the window listener that watches for a
     real pointer, which would make it cancel itself on its first frame. The
     flag marks the dispatch so that listener can tell the two apart. */
  var synthetic = false;
  function send(svg, type, x, y, buttons) {
    synthetic = true;
    svg.dispatchEvent(new PointerEvent(type, {
      clientX: x, clientY: y, bubbles: true, cancelable: true,
      pointerId: 9901, pointerType: 'mouse', isPrimary: true, buttons: buttons || 0
    }));
    synthetic = false;
  }
  // quadratic Bezier, so the path arcs rather than sliding in a straight line
  function bez(a, c, b, t) {
    var u = 1 - t;
    return [u * u * a[0] + 2 * u * t * c[0] + t * t * b[0],
            u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]];
  }
  function ease(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

  function run(demo) {
    var svg = document.querySelector(demo.sel);
    if (!svg) return;

    var cur = document.createElement('div');
    cur.className = 'demo-cursor';
    cur.innerHTML = CURSOR_SVG;
    document.body.appendChild(cur);

    var cancelled = false;
    function cleanup() {
      cancelled = true;
      // release the widget wherever the gesture had got to
      try { send(svg, 'pointerup', last.x, last.y, 0); } catch (e) {}
      if (cur.parentNode) cur.parentNode.removeChild(cur);
      ['pointerdown', 'wheel', 'keydown', 'touchstart'].forEach(function (t) {
        window.removeEventListener(t, onUser, true);
      });
    }
    function onUser() { if (!synthetic) cleanup(); }
    ['pointerdown', 'wheel', 'keydown', 'touchstart'].forEach(function (t) {
      window.addEventListener(t, onUser, true);
    });

    var start = ptOf(svg, demo.vb, demo.from), last = start;
    cur.style.transform = 'translate(' + start.x + 'px,' + start.y + 'px)';
    cur.classList.add('is-in');

    var DUR = 1500, t0 = 0, pressed = false;
    function frame(ts) {
      if (cancelled) return;
      if (!t0) { t0 = ts; }
      var t = Math.min(1, (ts - t0) / DUR);
      var p = bez(demo.from, demo.via, demo.to, ease(t));
      var c = ptOf(svg, demo.vb, p);
      last = c;
      cur.style.transform = 'translate(' + c.x + 'px,' + c.y + 'px)';
      if (!pressed) {
        pressed = true;
        cur.classList.add('is-down');
        send(svg, 'pointerdown', c.x, c.y, 1);
      } else {
        send(svg, 'pointermove', c.x, c.y, 1);
      }
      if (t < 1) { requestAnimationFrame(frame); return; }
      send(svg, 'pointerup', c.x, c.y, 0);
      cur.classList.remove('is-down');
      cur.classList.add('is-out');
      setTimeout(function () { if (!cancelled) cleanup(); }, 420);
    }
    // a beat after it settles in view, so the reader is looking at it
    setTimeout(function () { if (!cancelled) requestAnimationFrame(frame); }, 380);
  }

  DEMOS.forEach(function (demo) {
    var svg = document.querySelector(demo.sel);
    if (!svg) return;
    var seen = false;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (seen || !en.isIntersecting) return;
        seen = true; io.disconnect();
        run(demo);
      });
    }, { threshold: 0.6 });
    io.observe(svg);
  });
})();
