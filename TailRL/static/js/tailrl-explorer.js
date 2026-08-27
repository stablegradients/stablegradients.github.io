/* ===========================================================================
   TailRL advantage explorer.

   Drag rollout rewards along the axis and watch the gap-over-survivors
   staircase, the resulting weights, and how TailRL / GRPO / RLOO map the same
   group to different advantages. Scales from 2 to 1024 rollouts.

   Extracted from index.html. Vanilla ES5, no dependencies, no globals.
   ========================================================================= */
// ==================== Interactive TailRL advantage explorer ====================
(function () {
  var root = document.getElementById('tailrl-explorer');
  if (!root) return;
  var NS = 'http://www.w3.org/2000/svg';
  var C = { tailrl: '#C0392B', grpo: '#46628F', rloo: '#1D9E75', ink: '#1f2937', muted: '#9ca3af', grid: '#e5e7eb' };

  var N = 8, rewards = [], hover = -1, dragging = -1, preset = 'rare';

  var presets = {
    rare:   function (n) { var a = []; for (var i = 0; i < n; i++) a.push(0.12 + 0.28 * ((i * 7919) % n) / n); a[n - 1] = 0.92; return a; },
    binary: function (n) { var a = []; var K = Math.max(1, Math.round(n / 4)); for (var i = 0; i < n; i++) a.push(i < K ? 1 : 0); return a; },
    spread: function (n) { var a = []; for (var i = 0; i < n; i++) a.push((i + 0.5) / n); return a; },
    random: function (n) { var a = []; for (var i = 0; i < n; i++) a.push(Math.round(Math.random() * 100) / 100); return a; }
  };
  var presetLabels = { rare: 'One rare high reward', binary: 'Binary rewards (MaxRL)', spread: 'Evenly spread', random: 'Randomize' };

  function order(r) { return r.map(function (v, i) { return i; }).sort(function (a, b) { return r[a] - r[b] || a - b; }); }

  function tailrl(r) {
    var n = r.length, idx = order(r), w = new Array(n), prev = 0, acc = 0;
    idx.forEach(function (j, k) { acc += (r[j] - prev) / (n - k); prev = r[j]; w[j] = acc; });
    var wbar = w.reduce(function (s, v) { return s + v; }, 0) / n;
    return { w: w, A: w.map(function (v) { return v - wbar; }), wbar: wbar, idx: idx };
  }
  function grpo(r) {
    var n = r.length, m = r.reduce(function (s, v) { return s + v; }, 0) / n;
    var sd = Math.sqrt(r.reduce(function (s, v) { return s + (v - m) * (v - m); }, 0) / n);
    return r.map(function (v) { return (v - m) / (sd + 1e-6); });
  }
  function rloo(r) {
    var n = r.length, tot = r.reduce(function (s, v) { return s + v; }, 0);
    return r.map(function (v) { return n > 1 ? v - (tot - v) / (n - 1) : 0; });
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
  // At N = 1024 the interesting weights are around 1/1024, so widen the
  // precision rather than printing a row of zeros.
  function dec(v) { var a = Math.abs(v); return (a > 0 && a < 0.01) ? 4 : 3; }
  function fmt(v) { return (v >= 0 ? '+' : '') + v.toFixed(dec(v)); }

  // How the group is drawn at each size. Beyond 64 rollouts individual
  // glyphs stop being resolvable, so the panels switch to a sorted profile.
  function sizing() {
    var n = rewards.length;
    if (n <= 16)  return { r: 7,   op: 1,   risers: true,  bars: true  };
    if (n <= 64)  return { r: 5,   op: 0.8, risers: true,  bars: true  };
    if (n <= 256) return { r: 3.5, op: 0.6, risers: false, bars: false };
    return              { r: 2.5, op: 0.5, risers: false, bars: false };
  }

  var svgW = document.getElementById('ex-svg-weights');
  var svgA = document.getElementById('ex-svg-adv');
  var readout = document.getElementById('ex-readout');

  // ---- Panel A: staircase + draggable rollouts ----
  var PA = { x0: 60, x1: 730, yTop: 40, yBase: 190, yRoll: 240 };
  function xOf(t) { return PA.x0 + t * (PA.x1 - PA.x0); }
  function tOf(x) { return Math.min(1, Math.max(0, (x - PA.x0) / (PA.x1 - PA.x0))); }
  function yOf(v) { return PA.yBase - v * (PA.yBase - PA.yTop); }
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

  function drawWeights() {
    while (svgW.firstChild) svgW.removeChild(svgW.firstChild);
    var res = tailrl(rewards), idx = res.idx, n = rewards.length, sz = sizing();
    text(svgW, PA.x0, 18, 'Weight per unit reward, 1 / #survivors(τ)', 'svg-title', 'start');
    // grid
    [0, 0.25, 0.5, 0.75, 1].forEach(function (v) {
      el('line', { x1: PA.x0, x2: PA.x1, y1: yOf(v), y2: yOf(v), stroke: C.grid, 'stroke-width': 1 }, svgW);
      text(svgW, PA.x0 - 8, yOf(v) + 4, v.toFixed(2), 'svg-tick', 'end');
    });

    var focus = hover >= 0 ? hover : idx[n - 1];
    var rFocus = rewards[focus];
    var k, rk, v, prev;

    // shaded weight of the focused rollout, as a single path
    var shade = '';
    prev = 0;
    for (k = 0; k < n; k++) {
      rk = rewards[idx[k]]; v = 1 / (n - k);
      var a = Math.min(prev, rFocus), b = Math.min(rk, rFocus);
      if (b > a) shade += 'M' + xOf(a) + ' ' + yOf(0) + 'H' + xOf(b) + 'V' + yOf(v) + 'H' + xOf(a) + 'Z';
      prev = rk;
    }
    if (shade) el('path', { d: shade, fill: C.tailrl, opacity: 0.18 }, svgW);

    // staircase and risers, one path each
    var stair = '', risers = '';
    prev = 0;
    for (k = 0; k < n; k++) {
      rk = rewards[idx[k]]; v = 1 / (n - k);
      if (rk > prev) stair += 'M' + xOf(prev) + ' ' + yOf(v) + 'H' + xOf(rk);
      if (k < n - 1 && rewards[idx[k + 1]] > rk) risers += 'M' + xOf(rk) + ' ' + yOf(v) + 'V' + yOf(1 / (n - k - 1));
      prev = rk;
    }
    if (stair) el('path', { d: stair, fill: 'none', stroke: C.tailrl, 'stroke-width': 2.5 }, svgW);
    if (risers && sz.risers) el('path', { d: risers, fill: 'none', stroke: C.tailrl, 'stroke-width': 1.5, 'stroke-dasharray': '3,3' }, svgW);

    // axes
    el('line', { x1: PA.x0, x2: PA.x1, y1: PA.yBase, y2: PA.yBase, stroke: C.muted, 'stroke-width': 1 }, svgW);
    el('line', { x1: PA.x0, x2: PA.x1, y1: PA.yRoll, y2: PA.yRoll, stroke: C.ink, 'stroke-width': 1.2 }, svgW);
    [0, 0.2, 0.4, 0.6, 0.8, 1].forEach(function (v2) {
      el('line', { x1: xOf(v2), x2: xOf(v2), y1: PA.yRoll - 4, y2: PA.yRoll + 4, stroke: C.ink, 'stroke-width': 1 }, svgW);
      text(svgW, xOf(v2), PA.yRoll + 20, v2.toFixed(1), 'svg-tick');
    });
    text(svgW, PA.x1, PA.yRoll + 36, 'reward r  (drag the rollouts)', 'svg-label', 'end');

    // rollouts: individual circles while they are still resolvable, one
    // batched path beyond that (hit-tested by nearest reward instead).
    // drawn last, so the focused rollout always sits on top
    function focusDecor(parent, r) {
      var wF = res.w[focus];
      el('line', { x1: xOf(r), x2: xOf(r), y1: PA.yRoll - sz.r * 1.4 - 1, y2: PA.yBase, stroke: C.tailrl, 'stroke-width': 1, 'stroke-dasharray': '2,3' }, parent);
      el('circle', { cx: xOf(r), cy: PA.yRoll, r: sz.r * 1.4, fill: C.tailrl, stroke: C.tailrl, 'stroke-width': 2 }, parent);
      var t = text(parent, xOf(r), PA.yRoll - sz.r * 1.4 - 7, 'ω = ' + wF.toFixed(wF < 0.01 ? 4 : 2), 'svg-tick');
      t.setAttribute('fill', C.tailrl);
    }

    if (sz.bars) {
      rewards.forEach(function (r, i) {
        if (i === focus) return;
        var g = el('g', { 'class': 'rollout', 'data-i': i }, svgW);
        el('circle', { cx: xOf(r), cy: PA.yRoll, r: sz.r, fill: '#fff', stroke: C.tailrl, 'stroke-width': 2, opacity: sz.op }, g);
        g.addEventListener('pointerdown', function (e) { startDrag(i, e); });
        g.addEventListener('pointerenter', function () { if (dragging < 0) { hover = i; scheduleRender(); } });
      });
      var gf = el('g', { 'class': 'rollout', 'data-i': focus }, svgW);
      gf.addEventListener('pointerdown', function (e) { startDrag(focus, e); });
      focusDecor(gf, rewards[focus]);
    } else {
      var cd = '', i2, cx;
      for (i2 = 0; i2 < n; i2++) {
        if (i2 === focus) continue;
        cx = xOf(rewards[i2]);
        cd += 'M' + (cx - sz.r) + ' ' + PA.yRoll +
              'a' + sz.r + ' ' + sz.r + ' 0 1 0 ' + (2 * sz.r) + ' 0' +
              'a' + sz.r + ' ' + sz.r + ' 0 1 0 ' + (-2 * sz.r) + ' 0';
      }
      if (cd) el('path', { d: cd, fill: '#fff', stroke: C.tailrl, 'stroke-width': 1.2, opacity: sz.op }, svgW);
      focusDecor(svgW, rewards[focus]);
    }
  }

  function startDrag(i, e) {
    dragging = i; hover = i;
    if (svgW.setPointerCapture) { try { svgW.setPointerCapture(e.pointerId); } catch (err) {} }
    render(); e.preventDefault();
  }

  // ---- pointer handling, one render per animation frame ----
  var pend = null, rafId = 0;
  function flush() { rafId = 0; if (pend) { rewards[pend.i] = pend.v; pend = null; } render(); }
  function scheduleRender() { if (!rafId) rafId = requestAnimationFrame(flush); }

  // Beyond 64 rollouts the circles are batched into one path, so grab the
  // nearest rollout instead of relying on per-glyph hit testing.
  svgW.addEventListener('pointerdown', function (e) {
    if (rewards.length <= 64 || dragging >= 0) return;
    var p = localX(svgW, e);
    if (Math.abs(p.y - PA.yRoll) > 24) return;
    var j = nearest(tOf(p.x));
    if (j >= 0) startDrag(j, e);
  });

  svgW.addEventListener('pointermove', function (e) {
    var p = localX(svgW, e);
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
  svgW.addEventListener('pointerup', stopDrag);
  svgW.addEventListener('pointercancel', stopDrag);
  svgW.addEventListener('pointerleave', function () { if (dragging < 0 && hover !== -1) { hover = -1; scheduleRender(); } });

  // ---- Panel B: advantages ----
  function drawAdv() {
    while (svgA.firstChild) svgA.removeChild(svgA.firstChild);
    var res = tailrl(rewards), idx = res.idx, n = rewards.length, sz = sizing();
    var focus = hover >= 0 ? hover : idx[n - 1];
    var rank = new Array(n);
    idx.forEach(function (i, k) { rank[i] = k; });
    var methods = [
      { name: 'TailRL', A: res.A, color: C.tailrl },
      { name: 'GRPO', A: grpo(rewards), color: C.grpo },
      { name: 'RLOO', A: rloo(rewards), color: C.rloo }
    ];
    var panelW = 220, gap = 30, x0 = 40, yTop = 40, yBot = 200;
    methods.forEach(function (m, mi) {
      var px = x0 + mi * (panelW + gap);
      var maxAbs = m.A.reduce(function (s, v) { return Math.max(s, Math.abs(v)); }, 0) || 1;
      var yMid = (yTop + yBot) / 2, scale = (yBot - yTop) / 2 / maxAbs * 0.92;
      text(svgA, px + panelW / 2, 22, m.name + ' advantage', 'svg-title');
      el('line', { x1: px, x2: px + panelW, y1: yMid, y2: yMid, stroke: C.muted, 'stroke-width': 1 }, svgA);
      text(svgA, px - 6, yTop + 4, '+' + maxAbs.toFixed(2), 'svg-tick', 'end');
      text(svgA, px - 6, yBot + 4, '−' + maxAbs.toFixed(2), 'svg-tick', 'end');

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

  function drawReadout() {
    var res = tailrl(rewards), n = rewards.length, g = grpo(rewards), l = rloo(rewards);
    var i = hover >= 0 ? hover : res.idx[n - 1];
    readout.innerHTML =
      'rollout ' + (i + 1) + ': r = ' + rewards[i].toFixed(2) +
      ' &nbsp;|&nbsp; ω = ' + res.w[i].toFixed(dec(res.w[i])) +
      ' &nbsp;|&nbsp; <span class="m-tailrl">A<sub>TailRL</sub> = ' + fmt(res.A[i]) + '</span>' +
      ' &nbsp; <span class="m-grpo">A<sub>GRPO</sub> = ' + fmt(g[i]) + '</span>' +
      ' &nbsp; <span class="m-rloo">A<sub>RLOO</sub> = ' + fmt(l[i]) + '</span><br>' +
      'Σ ω = ' + res.w.reduce(function (s, v) { return s + v; }, 0).toFixed(3) + ' = max r  &nbsp;|&nbsp; ω̄ = max r / N = ' + res.wbar.toFixed(dec(res.wbar)) +
      (preset === 'binary' ? ' &nbsp;|&nbsp; binary rewards: A<sub>TailRL</sub> = (r − μ̂) / (N μ̂), the MaxRL advantage up to the 1/N averaging' : '');
  }

  function render() { drawWeights(); drawAdv(); drawReadout(); }

  // ---- Controls ----
  var nSlider = document.getElementById('ex-n-slider'), nValue = document.getElementById('ex-n-value');
  var pBox = document.getElementById('ex-preset-buttons');
  nSlider.addEventListener('input', function () {
    N = Math.pow(2, parseInt(nSlider.value, 10));
    rewards = presets[preset](N);
    hover = -1; dragging = -1; pend = null;
    nValue.textContent = String(N);
    render();
  });
  Object.keys(presets).forEach(function (key) {
    var b = document.createElement('button'); b.textContent = presetLabels[key]; b.type = 'button';
    if (key === preset) b.classList.add('active');
    b.addEventListener('click', function () {
      preset = key; rewards = presets[key](N); hover = -1;
      pBox.querySelectorAll('button').forEach(function (x) { x.classList.toggle('active', x === b); });
      render();
    });
    pBox.appendChild(b);
  });

  var resetBtn = document.getElementById('ex-reset');
  if (resetBtn) resetBtn.addEventListener('click', function () {
    N = 8; preset = 'rare'; hover = -1; dragging = -1; pend = null;
    nSlider.value = '3';
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
