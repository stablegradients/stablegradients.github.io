/* ===========================================================================
   TailRL advantage explorer.

   Drag the rollout rewards along the axis and watch how the same group maps to
   REINFORCE advantages and to TailRL advantages. Scales from 2 to 1024
   rollouts.

   REINFORCE (expected reward, mean baseline):  A_i = r_i - mean(r)
   TailRL:                                      A_i = w(r_i) - mean(w),
     with w(r_(i)) = sum_{k<=i} (r_(k) - r_(k-1)) / (N - k + 1)

   Vanilla ES5, no dependencies, no globals.
   ========================================================================= */
(function () {
  var root = document.getElementById('tailrl-explorer');
  if (!root) return;
  var NS = 'http://www.w3.org/2000/svg';
  var C = { tailrl: '#C0392B', reinforce: '#46628F', ink: '#1f2937', muted: '#1f2937', grid: '#e5e7eb' };

  // the rollout budgets the paper trains at; the slider steps over these only
  var STOPS = [16, 64, 256, 1024], START = 1;
  var N = STOPS[START], rewards = [], hover = -1, dragging = -1, preset = 'random';

  function gauss() {                                 // Box-Muller
    var u = 1 - Math.random(), v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /* The random preset is a Gaussian mixture with one to three modes at random
     places and random weights. The spec is held rather than redrawn, so moving
     the rollout slider draws more samples from the SAME reward distribution
     instead of inventing a new one; only Randomize itself rerolls it. */
  var randSpec = null;
  function newRandSpec() {
    var K = 1 + Math.floor(Math.random() * 3), comps = [], i, j, t, mu, ok, tot = 0, w;
    for (i = 0; i < K; i++) {
      /* Keep the modes apart. Drawn freely they often overlap into one bump,
         so a three-component mixture would still read as unimodal. */
      for (t = 0; t < 40; t++) {
        mu = 0.12 + 0.76 * Math.random();
        ok = true;
        for (j = 0; j < comps.length; j++) if (Math.abs(mu - comps[j].mu) < 0.19) { ok = false; break; }
        if (ok) break;
      }
      w = 0.6 + 0.8 * Math.random();            // no component so light it vanishes
      comps.push({ mu: mu, sd: 0.03 + 0.045 * Math.random(), w: w });
      tot += w;
    }
    for (i = 0; i < K; i++) comps[i].w /= tot;
    return comps;
  }
  function sampleSpec(spec, n) {
    var a = [], i, k, t, u, c, x;
    for (i = 0; i < n; i++) {
      u = Math.random(); c = spec[spec.length - 1]; t = 0;
      for (k = 0; k < spec.length; k++) { t += spec[k].w; if (u <= t) { c = spec[k]; break; } }
      // truncate by redrawing; clamping would pile a spike on the boundary
      for (t = 0; t < 24; t++) { x = c.mu + c.sd * gauss(); if (x >= 0 && x <= 1) break; }
      if (!(x >= 0 && x <= 1)) x = Math.min(1, Math.max(0, x));
      a.push(Math.round(x * 100) / 100);
    }
    return a;
  }

  var presets = {
    random: function (n) { return sampleSpec(randSpec || (randSpec = newRandSpec()), n); },
    rare:   function (n) { var a = []; for (var i = 0; i < n; i++) a.push(0.12 + 0.28 * ((i * 7919) % n) / n); a[n - 1] = 0.92; return a; },
    spread: function (n) { var a = []; for (var i = 0; i < n; i++) a.push((i + 0.5) / n); return a; }
  };
  var presetLabels = { random: 'Randomize', rare: 'One rare high reward', spread: 'Evenly spread' };

  function order(r) { return r.map(function (v, i) { return i; }).sort(function (a, b) { return r[a] - r[b] || a - b; }); }

  function tailrl(r) {
    var n = r.length, idx = order(r), w = new Array(n), prev = 0, acc = 0;
    idx.forEach(function (j, k) { acc += (r[j] - prev) / (n - k); prev = r[j]; w[j] = acc; });
    var wbar = w.reduce(function (s, v) { return s + v; }, 0) / n;
    return { w: w, A: w.map(function (v) { return v - wbar; }), wbar: wbar, idx: idx };
  }
  // REINFORCE with the group mean as baseline: the expected-reward update.
  // RLOO is the same map up to the factor N/(N-1), so its shape is identical.
  function reinforce(r) {
    var n = r.length, m = r.reduce(function (s, v) { return s + v; }, 0) / n;
    return r.map(function (v) { return v - m; });
  }

  function el(name, attrs, parent) {
    var e = document.createElementNS(NS, name);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function text(parent, x, y, s, cls, anchor) {
    var t = el('text', { x: x, y: y, 'class': cls || 'svg-label', 'text-anchor': anchor || 'middle' }, parent);
    t.textContent = s; return t;
  }
  /* Labels that mix prose and symbols. Segments between | are set in
     KaTeX_Math italic, the rest in KaTeX_Main upright, so the widget uses the
     same faces as the page's rendered equations. */
  function mtext(parent, x, y, spec, cls, anchor) {
    var t = el('text', { x: x, y: y, 'class': cls || 'svg-label', 'text-anchor': anchor || 'middle' }, parent);
    spec.split('|').forEach(function (seg, i) {
      if (seg === '') return;
      var ts = el('tspan', { 'class': (i % 2) ? 'sv-math' : 'sv-text' }, t);
      ts.textContent = seg;
    });
    return t;
  }
  // At N = 1024 the interesting magnitudes sit near 1/1024, so widen the
  // precision there rather than printing a row of zeros.
  function dec(v) { var a = Math.abs(v); return (a > 0 && a < 0.01) ? 4 : 3; }

  // How the group is drawn at each size. Beyond 64 rollouts individual
  // glyphs stop being resolvable, so the panels switch to a sorted profile.
  function sizing() {
    var n = rewards.length;
    if (n <= 16)  return { r: 7,   op: 1,   bars: true  };
    if (n <= 64)  return { r: 5,   op: 0.8, bars: true  };
    if (n <= 256) return { r: 3.5, op: 0.6, bars: false };
    return              { r: 2.5, op: 0.5, bars: false };
  }

  var svgR = document.getElementById('ex-svg-rewards');
  var svgA = document.getElementById('ex-svg-adv');

  // ---- Panel A: the draggable reward strip ----
  var PA = { x0: 60, x1: 730, yRoll: 100, kdeTop: 34, kdeBase: 92 };

  /* Gaussian KDE of the group's rewards, drawn above the axis so the reader
     can see the distribution the advantages come from. Binned and convolved
     rather than evaluated pair by pair: at N = 1024 the direct form is a
     million exponentials a frame, this is a few hundred. */
  var KB = 128;                                    // density bins over [0,1]
  function bandwidth(r) {
    var n = r.length, i, m = 0, v = 0, sd, srt, q1, q3, a, h;
    for (i = 0; i < n; i++) m += r[i];
    m /= n;
    for (i = 0; i < n; i++) v += (r[i] - m) * (r[i] - m);
    sd = Math.sqrt(v / Math.max(1, n));
    srt = r.slice().sort(function (p, q) { return p - q; });
    q1 = srt[Math.floor(0.25 * (n - 1))]; q3 = srt[Math.floor(0.75 * (n - 1))];
    a = Math.min(sd || 1, (q3 - q1) / 1.34 || 1);
    h = 0.9 * a * Math.pow(n, -0.2);
    // Silverman over-smooths a clustered reward set, so cap the width
    return Math.max(0.015, Math.min(0.08, h || 0.03));
  }
  function density(r) {
    var counts = new Array(KB), i, j, b, h = bandwidth(r), bw = 1 / (KB - 1);
    for (i = 0; i < KB; i++) counts[i] = 0;
    for (i = 0; i < r.length; i++) {
      b = Math.round(Math.min(1, Math.max(0, r[i])) * (KB - 1));
      counts[b] += 1;
    }
    var w = new Array(KB), u;                      // kernel indexed by bin offset
    for (i = 0; i < KB; i++) { u = (i * bw) / h; w[i] = Math.exp(-0.5 * u * u); }
    var out = new Array(KB), sum, mx = 0;
    for (i = 0; i < KB; i++) {
      sum = 0;
      for (j = 0; j < KB; j++) if (counts[j]) sum += counts[j] * w[Math.abs(i - j)];
      out[i] = sum;
      if (sum > mx) mx = sum;
    }
    if (mx > 0) for (i = 0; i < KB; i++) out[i] /= mx;   // unit peak, for drawing
    return out;
  }
  function xOf(t) { return PA.x0 + t * (PA.x1 - PA.x0); }
  function tOf(x) { return Math.min(1, Math.max(0, (x - PA.x0) / (PA.x1 - PA.x0))); }
  function localX(svg, e) {
    var pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    return pt.matrixTransform(svg.getScreenCTM().inverse());
  }
  function nearest(t) {
    var best = -1, bd = Infinity, i, d;
    for (i = 0; i < rewards.length; i++) {
      d = Math.abs(rewards[i] - t);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  function drawRewards() {
    while (svgR.firstChild) svgR.removeChild(svgR.firstChild);
    var res = tailrl(rewards), idx = res.idx, n = rewards.length, sz = sizing();
    mtext(svgR, (PA.x0 + PA.x1) / 2, 20, 'The rollout group: ' + n + ' rewards on [0, 1]', 'svg-title');

    /* density band above the axis */
    var dens = density(rewards), di, dx, dy, area = '', line = '';
    for (di = 0; di < KB; di++) {
      dx = xOf(di / (KB - 1));
      dy = PA.kdeBase - dens[di] * (PA.kdeBase - PA.kdeTop);
      area += (di === 0 ? 'M' + dx + ' ' + PA.kdeBase + 'L' : 'L') + dx + ' ' + dy;
      line += (di === 0 ? 'M' : 'L') + dx + ' ' + dy;
    }
    area += 'L' + xOf(1) + ' ' + PA.kdeBase + 'Z';
    el('path', { d: area, fill: C.tailrl, opacity: 0.14 }, svgR);
    el('path', { d: line, fill: 'none', stroke: C.tailrl, 'stroke-width': 1.6, opacity: 0.75 }, svgR);
    var dmid = (PA.kdeTop + PA.kdeBase) / 2;
    var dl = mtext(svgR, 20, dmid, 'density', 'svg-tick');
    dl.setAttribute('transform', 'rotate(-90, 20, ' + dmid + ')');

    // reward axis
    el('line', { x1: PA.x0, x2: PA.x1, y1: PA.yRoll, y2: PA.yRoll, stroke: C.ink, 'stroke-width': 1.2 }, svgR);
    [0, 0.2, 0.4, 0.6, 0.8, 1].forEach(function (v) {
      el('line', { x1: xOf(v), x2: xOf(v), y1: PA.yRoll - 4, y2: PA.yRoll + 4, stroke: C.ink, 'stroke-width': 1 }, svgR);
      text(svgR, xOf(v), PA.yRoll + 20, v.toFixed(1), 'svg-tick');
    });
    mtext(svgR, (PA.x0 + PA.x1) / 2, PA.yRoll + 38, 'reward |r|  (drag the rollouts)', 'svg-label');

    var focus = hover >= 0 ? hover : idx[n - 1];

    // drawn last, so the focused rollout always sits on top
    function focusDecor(parent, r) {
      el('circle', { cx: xOf(r), cy: PA.yRoll, r: sz.r * 1.4, fill: C.tailrl, stroke: C.tailrl, 'stroke-width': 2 }, parent);
      var t = mtext(parent, xOf(r), PA.yRoll - sz.r * 1.4 - 8, '|r| = ' + r.toFixed(2), 'svg-tick');
      t.setAttribute('fill', C.tailrl);
    }

    if (sz.bars) {
      rewards.forEach(function (r, i) {
        if (i === focus) return;
        var g = el('g', { 'class': 'rollout', 'data-i': i }, svgR);
        el('circle', { cx: xOf(r), cy: PA.yRoll, r: sz.r, fill: '#fff', stroke: C.tailrl, 'stroke-width': 2, opacity: sz.op }, g);
        g.addEventListener('pointerdown', function (e) { startDrag(i, e); });
        g.addEventListener('pointerenter', function () { if (dragging < 0) { hover = i; scheduleRender(); } });
      });
      var gf = el('g', { 'class': 'rollout', 'data-i': focus }, svgR);
      gf.addEventListener('pointerdown', function (e) { startDrag(focus, e); });
      focusDecor(gf, rewards[focus]);
    } else {
      // beyond 64 the circles are batched into one path and hit-tested by
      // nearest reward instead of per-glyph
      var cd = '', i2, cx;
      for (i2 = 0; i2 < n; i2++) {
        if (i2 === focus) continue;
        cx = xOf(rewards[i2]);
        cd += 'M' + (cx - sz.r) + ' ' + PA.yRoll +
              'a' + sz.r + ' ' + sz.r + ' 0 1 0 ' + (2 * sz.r) + ' 0' +
              'a' + sz.r + ' ' + sz.r + ' 0 1 0 ' + (-2 * sz.r) + ' 0';
      }
      if (cd) el('path', { d: cd, fill: '#fff', stroke: C.tailrl, 'stroke-width': 1.2, opacity: sz.op }, svgR);
      focusDecor(svgR, rewards[focus]);
    }
  }

  function startDrag(i, e) {
    dragging = i; hover = i;
    if (svgR.setPointerCapture) { try { svgR.setPointerCapture(e.pointerId); } catch (err) {} }
    render(); e.preventDefault();
  }

  // ---- pointer handling, one render per animation frame ----
  var pend = null, rafId = 0;
  function flush() { rafId = 0; if (pend) { rewards[pend.i] = pend.v; pend = null; } render(); }
  function scheduleRender() { if (!rafId) rafId = requestAnimationFrame(flush); }

  svgR.addEventListener('pointerdown', function (e) {
    if (rewards.length <= 64 || dragging >= 0) return;
    var p = localX(svgR, e);
    if (Math.abs(p.y - PA.yRoll) > 24) return;
    var j = nearest(tOf(p.x));
    if (j >= 0) startDrag(j, e);
  });

  svgR.addEventListener('pointermove', function (e) {
    var p = localX(svgR, e);
    if (dragging < 0) {
      if (rewards.length > 64) {
        var j = nearest(tOf(p.x));
        if (j !== hover) { hover = j; scheduleRender(); }
      }
      return;
    }
    pend = { i: dragging, v: Math.round(tOf(p.x) * 100) / 100 };
    scheduleRender();
  });

  function stopDrag() {
    if (dragging < 0) return;
    dragging = -1;
    if (pend) { rewards[pend.i] = pend.v; pend = null; }
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    render();
  }
  svgR.addEventListener('pointerup', stopDrag);
  svgR.addEventListener('pointercancel', stopDrag);
  svgR.addEventListener('pointerleave', function () { if (dragging < 0 && hover !== -1) { hover = -1; scheduleRender(); } });

  // ---- Panel B: REINFORCE advantages beside TailRL advantages ----
  function drawAdv() {
    while (svgA.firstChild) svgA.removeChild(svgA.firstChild);
    var res = tailrl(rewards), idx = res.idx, n = rewards.length, sz = sizing();
    var focus = hover >= 0 ? hover : idx[n - 1];
    var rank = new Array(n);
    idx.forEach(function (i, k) { rank[i] = k; });
    var methods = [
      { name: 'REINFORCE', sub: 'A = r − r̄', A: reinforce(rewards), color: C.reinforce },
      { name: 'TailRL',    sub: 'A = ω − ω̄', A: res.A,              color: C.tailrl }
    ];
    var panelW = 310, gap = 70, x0 = 55, yTop = 48, yBot = 208;
    methods.forEach(function (m, mi) {
      var px = x0 + mi * (panelW + gap);
      // each panel is normalised by its own largest magnitude, so the two show
      // the shape of the update; the printed bounds carry the differing scale
      var maxAbs = m.A.reduce(function (s, v) { return Math.max(s, Math.abs(v)); }, 0) || 1;
      var yMid = (yTop + yBot) / 2, scale = (yBot - yTop) / 2 / maxAbs * 0.92;
      text(svgA, px + panelW / 2, 20, m.name + ' advantage', 'svg-title').setAttribute('fill', m.color);
      mtext(svgA, px + panelW / 2, 36, m.sub, 'svg-tick');
      el('line', { x1: px, x2: px + panelW, y1: yMid, y2: yMid, stroke: C.muted, 'stroke-width': 1 }, svgA);
      text(svgA, px - 6, yTop + 4, '+' + maxAbs.toFixed(dec(maxAbs)), 'svg-tick', 'end');
      text(svgA, px - 6, yBot + 4, '−' + maxAbs.toFixed(dec(maxAbs)), 'svg-tick', 'end');

      if (sz.bars) {
        var bw = panelW / n;
        idx.forEach(function (i, k) {
          var v = m.A[i], h = Math.abs(v) * scale;
          var rect = el('rect', { x: px + k * bw + bw * 0.15, y: v >= 0 ? yMid - h : yMid, width: bw * 0.7, height: Math.max(h, 0.5), fill: m.color, opacity: i === focus ? 1 : 0.45, 'data-i': i }, svgA);
          rect.style.cursor = 'pointer';
          rect.addEventListener('pointerenter', function () { if (dragging < 0) { hover = i; scheduleRender(); } });
        });
      } else {
        // sorted profile: the same information as the bars, drawn as an area
        var stepW = panelW / n, dLine = '', dArea = 'M' + px + ' ' + yMid, xa, xb, yv;
        idx.forEach(function (i, k) {
          yv = yMid - m.A[i] * scale;
          xa = px + k * stepW; xb = xa + stepW;
          dLine += (k === 0 ? 'M' : 'L') + xa + ' ' + yv + 'L' + xb + ' ' + yv;
          dArea += 'L' + xa + ' ' + yv + 'L' + xb + ' ' + yv;
        });
        dArea += 'L' + (px + panelW) + ' ' + yMid + 'Z';
        el('path', { d: dArea, fill: m.color, opacity: 0.35 }, svgA);
        el('path', { d: dLine, fill: 'none', stroke: m.color, 'stroke-width': 1.5 }, svgA);
        var xf = px + (rank[focus] + 0.5) * stepW;
        el('line', { x1: xf, x2: xf, y1: yMid, y2: yMid - m.A[focus] * scale, stroke: m.color, 'stroke-width': 2 }, svgA);
        var hit = el('rect', { x: px, y: yTop, width: panelW, height: yBot - yTop, fill: 'transparent' }, svgA);
        hit.style.cursor = 'pointer';
        hit.addEventListener('pointermove', function (e) {
          if (dragging >= 0) return;
          var q = localX(svgA, e);
          var kk = Math.min(n - 1, Math.max(0, Math.floor((q.x - px) / panelW * n)));
          if (idx[kk] !== hover) { hover = idx[kk]; scheduleRender(); }
        });
      }
      text(svgA, px + panelW / 2, yBot + 22, 'rollouts sorted by reward →', 'svg-tick');
    });
  }
  // registered once: re-registering inside drawAdv() leaked a listener per render
  svgA.addEventListener('pointerleave', function () { if (dragging < 0 && hover !== -1) { hover = -1; scheduleRender(); } });

  function render() { drawRewards(); drawAdv(); }

  // ---- Controls ----
  var nSlider = document.getElementById('ex-n-slider'), nValue = document.getElementById('ex-n-value');
  var pBox = document.getElementById('ex-preset-buttons');
  nSlider.addEventListener('input', function () {
    N = STOPS[parseInt(nSlider.value, 10)] || STOPS[START];
    rewards = presets[preset](N);
    hover = -1; dragging = -1; pend = null;
    nValue.textContent = String(N);
    render();
  });
  Object.keys(presets).forEach(function (key) {
    var b = document.createElement('button'); b.textContent = presetLabels[key]; b.type = 'button';
    if (key === preset) b.classList.add('active');
    b.addEventListener('click', function () {
      if (key === 'random') randSpec = newRandSpec();     // a click rerolls it
      preset = key; rewards = presets[key](N); hover = -1;
      pBox.querySelectorAll('button').forEach(function (x) { x.classList.toggle('active', x === b); });
      render();
    });
    pBox.appendChild(b);
  });

  var resetBtn = document.getElementById('ex-reset');
  if (resetBtn) resetBtn.addEventListener('click', function () {
    N = STOPS[START]; preset = 'random'; randSpec = newRandSpec(); hover = -1; dragging = -1; pend = null;
    nSlider.value = String(START);
    nValue.textContent = String(N);
    rewards = presets[preset](N);
    pBox.querySelectorAll('button').forEach(function (x, i) { x.classList.toggle('active', i === 0); });
    render();
    resetBtn.blur();
  });

  rewards = presets[preset](N);
  nValue.textContent = String(N);
  render();
})();
