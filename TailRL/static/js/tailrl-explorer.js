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
  var C = { tailrl: '#C0392B', reinforce: '#46628F', ink: '#1f2937', muted: '#9ca3af', grid: '#e5e7eb' };

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
  // At N = 1024 the interesting advantages are around 1/1024, so widen the
  // precision rather than printing a row of zeros.
  function dec(v) { var a = Math.abs(v); return (a > 0 && a < 0.01) ? 4 : 3; }
  function fmt(v) { return (v >= 0 ? '+' : '') + v.toFixed(dec(v)); }

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
  var readout = document.getElementById('ex-readout');

  // ---- Panel A: the draggable reward strip ----
  var PA = { x0: 60, x1: 730, yRoll: 74 };
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
    text(svgR, PA.x0, 20, 'The rollout group: ' + n + ' rewards on [0, 1]', 'svg-title', 'start');

    // reward axis
    el('line', { x1: PA.x0, x2: PA.x1, y1: PA.yRoll, y2: PA.yRoll, stroke: C.ink, 'stroke-width': 1.2 }, svgR);
    [0, 0.2, 0.4, 0.6, 0.8, 1].forEach(function (v) {
      el('line', { x1: xOf(v), x2: xOf(v), y1: PA.yRoll - 4, y2: PA.yRoll + 4, stroke: C.ink, 'stroke-width': 1 }, svgR);
      text(svgR, xOf(v), PA.yRoll + 20, v.toFixed(1), 'svg-tick');
    });
    text(svgR, PA.x1, PA.yRoll + 38, 'reward r  (drag the rollouts)', 'svg-label', 'end');

    var focus = hover >= 0 ? hover : idx[n - 1];

    // drawn last, so the focused rollout always sits on top
    function focusDecor(parent, r) {
      el('circle', { cx: xOf(r), cy: PA.yRoll, r: sz.r * 1.4, fill: C.tailrl, stroke: C.tailrl, 'stroke-width': 2 }, parent);
      var t = text(parent, xOf(r), PA.yRoll - sz.r * 1.4 - 8, 'r = ' + r.toFixed(2), 'svg-tick');
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
      text(svgA, px + panelW / 2, 36, m.sub, 'svg-tick');
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

  function drawReadout() {
    var res = tailrl(rewards), n = rewards.length, rf = reinforce(rewards);
    var i = hover >= 0 ? hover : res.idx[n - 1];
    // Both updates are sum_i weight_i * score_i minus a group-wide baseline,
    // and the baseline promotes nobody, so the honest side-by-side is the
    // share of the group's total pre-baseline weight: r_i for REINFORCE,
    // omega_i for TailRL. That share is exactly what the two objectives
    // disagree about.
    function share(w, j) {
      var tot = w.reduce(function (s, v) { return s + v; }, 0);
      return tot > 0 ? (100 * w[j] / tot) : 100 / n;
    }
    var sR = share(rewards, i), sT = share(res.w, i);
    var ratio = sR > 1e-9 ? (sT / sR) : 0;
    readout.innerHTML =
      'rollout ' + (i + 1) + ': r = ' + rewards[i].toFixed(2) +
      ' &nbsp;|&nbsp; <span class="m-grpo">A<sub>REINFORCE</sub> = ' + fmt(rf[i]) + '</span>' +
      ' &nbsp; <span class="m-tailrl">A<sub>TailRL</sub> = ' + fmt(res.A[i]) + '</span><br>' +
      'share of the group\u2019s total weight: ' +
      '<span class="m-grpo">' + sR.toFixed(1) + '%</span> under REINFORCE (r / \u03a3r), ' +
      '<span class="m-tailrl">' + sT.toFixed(1) + '%</span> under TailRL (\u03c9 / \u03a3\u03c9)' +
      (ratio > 0 ? ' &nbsp;\u2192&nbsp; ' + ratio.toFixed(2) + '\u00d7 the influence' : '') +
      (preset === 'binary'
        ? '<br>binary rewards: A<sub>TailRL</sub> = (r \u2212 \u03bc\u0302) / (N \u03bc\u0302), the MaxRL advantage up to the 1/N averaging, so every success carries equal weight under both'
        : '');
  }

  function render() { drawRewards(); drawAdv(); drawReadout(); }

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
