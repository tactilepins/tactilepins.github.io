/* Tactile Pins — interactive mini 2.5D pin-art toy & screenshot lightbox.
   Zero external dependencies, zero network requests, 100% client-side. */
(() => {
  'use strict';

  const reducedMotion = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------------- Screenshot Lightbox ---------------- */
  const dialog = document.getElementById('shot-lightbox');
  if (dialog && typeof dialog.showModal === 'function') {
    const lbImg = dialog.querySelector('img');
    const lbCap = dialog.querySelector('[data-lightbox-caption]');
    const lbClose = dialog.querySelector('[data-lightbox-close]');

    document.querySelectorAll('.shot-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const img = btn.querySelector('img');
        const cap = btn.querySelector('.shot-cap')?.textContent || img?.alt || '';
        if (!img) return;
        lbImg.src = img.src;
        lbImg.alt = img.alt;
        lbCap.textContent = cap;
        dialog.showModal();
      });
    });

    lbClose?.addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) dialog.close();
    });
  }

  /* ---------------- Interactive Mini Pinboard ---------------- */
  const canvas = document.getElementById('pin-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const COLS = 44;
  const ROWS = 32;
  const COUNT = COLS * ROWS;

  const heights = new Float32Array(COUNT);
  const targets = new Float32Array(COUNT);
  const vels = new Float32Array(COUNT);
  const fric = new Float32Array(COUNT);
  const paints = new Array(COUNT).fill(null);

  for (let i = 0; i < COUNT; i++) {
    const hash = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
    fric[i] = 0.72 + (hash - Math.floor(hash)) * 0.56;
  }

  // Deterministic stars for the starry backdrop
  const STARS = Array.from({ length: 42 }, (_, i) => {
    const a = Math.sin(i * 91.7 + 13.3) * 43758.5453;
    const b = Math.sin(i * 47.1 + 59.9) * 23421.631;
    return {
      x: a - Math.floor(a),
      y: b - Math.floor(b),
      r: 0.9 + (i % 3) * 0.55,
      o: 0.35 + (i % 5) * 0.13,
    };
  });

  const CONFETTI_PALETTE = [
    [239, 71, 111],
    [255, 209, 102],
    [42, 189, 152],
    [61, 139, 255],
    [155, 93, 229],
    [247, 127, 0],
    [94, 214, 110],
  ];

  const FINISHES = {
    silver:   { name: 'Silver',    metallic: true,  rgb: () => [206, 212, 222] },
    gold:     { name: 'Gold',      metallic: true,  rgb: () => [234, 198, 108] },
    rosegold: { name: 'Rose gold', metallic: true,  rgb: () => [234, 166, 154] },
    copper:   { name: 'Copper',    metallic: true,  rgb: () => [210, 128, 80]  },
    graphite: { name: 'Graphite',  metallic: true,  rgb: () => [118, 124, 138] },
    plastic:  { name: 'Plastic',   metallic: false, rgb: () => [68, 148, 255]  },
    rainbow:  {
      name: 'Rainbow',
      metallic: false,
      rgb: (c, r) => hslToRgb(((c / COLS) * 305 + (r / ROWS) * 65) % 360, 0.84, 0.60),
    },
    confetti: {
      name: 'Confetti',
      metallic: false,
      rgb: (c, r) => {
        const k = Math.abs((c * 73856093) ^ (r * 19349663)) % CONFETTI_PALETTE.length;
        return CONFETTI_PALETTE[k];
      },
    },
  };

  const BACKDROPS = {
    studio: 'Studio',
    aurora: 'Aurora',
    starry: 'Starry night',
    ocean:  'Under the sea',
    sunset: 'Sunset',
  };

  const PAINT_COLORS = {
    red:     [238, 76, 66],
    orange:  [250, 146, 44],
    yellow:  [255, 212, 59],
    green:   [56, 204, 118],
    blue:    [58, 148, 255],
    purple:  [164, 96, 245],
    pink:    [245, 98, 174],
    rainbow: 'rainbow',
  };

  const state = {
    tool: 'press',
    brush: 'wide',
    finish: 'gold',
    backdrop: 'studio',
    paintKey: 'rainbow',
    tilt: 0.52,
    sound: false,
    mode: 'idle',
    pointerDown: false,
    pointerX: 0,
    pointerY: 0,
    rainbowPhase: 0,
  };

  const layout = { w: 600, h: 450, dpr: 1, pitch: 10, r: 4.4, ox: 30, oy: 30 };
  let rafId = 0;

  /* ---------------- Subtle Synthesized Pin Click Audio ---------------- */
  let audioCtx = null;
  let lastClickTime = 0;

  function playPinClick(strength = 0.5) {
    if (!state.sound) return;
    const now = performance.now();
    if (now - lastClickTime < 34) return;
    lastClickTime = now;
    try {
      if (!audioCtx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        audioCtx = new AC();
      }
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const t = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'triangle';
      const baseFreq = 1350 + Math.random() * 900;
      osc.frequency.setValueAtTime(baseFreq, t);
      osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.42, t + 0.022);
      const vol = Math.min(0.055, 0.018 + strength * 0.032);
      gain.gain.setValueAtTime(vol, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.026);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(t);
      osc.stop(t + 0.028);
    } catch (_) {
      // Ignore audio errors gracefully
    }
  }

  /* ---------------- Color Helpers ---------------- */
  function hslToRgb(h, s, l) {
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    let r = 0, g = 0, b = 0;
    if (h < 60)       { r = c; g = x; b = 0; }
    else if (h < 120) { r = x; g = c; b = 0; }
    else if (h < 180) { r = 0; g = c; b = x; }
    else if (h < 240) { r = 0; g = x; b = c; }
    else if (h < 300) { r = x; g = 0; b = c; }
    else              { r = c; g = 0; b = x; }
    return [
      Math.round((r + m) * 255),
      Math.round((g + m) * 255),
      Math.round((b + m) * 255),
    ];
  }

  function rgbStr(rgb, scale) {
    const r = Math.min(255, Math.max(0, Math.round(rgb[0] * scale)));
    const g = Math.min(255, Math.max(0, Math.round(rgb[1] * scale)));
    const b = Math.min(255, Math.max(0, Math.round(rgb[2] * scale)));
    return `rgb(${r},${g},${b})`;
  }

  /* ---------------- 3D Stamp Heightfield Generators ---------------- */
  function distSeg(px, py, ax, ay, bx, by) {
    const vx = bx - ax, vy = by - ay;
    const wx = px - ax, wy = py - ay;
    const len2 = vx * vx + vy * vy || 1e-6;
    const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / len2));
    return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
  }

  function dome(d, radius, peak = 1.0) {
    if (d >= radius) return 0;
    const q = d / radius;
    return peak * Math.sqrt(Math.max(0, 1 - q * q));
  }

  function smoothMax(a, b, k = 0.08) {
    const h = Math.max(k - Math.abs(a - b), 0) / k;
    return Math.max(a, b) + h * h * k * 0.25;
  }

  const STAMPS = {
    hand(u, v) {
      const x = u * 1.08;
      const y = v * 0.96 + 0.06;
      const palm = dome(Math.hypot((x - 0.02) / 1.05, (y - 0.24) / 0.95), 0.36, 0.96);
      const wrist = dome(distSeg(x, y, -0.06, 0.44, 0.08, 0.68), 0.22, 0.72);
      const fThumb  = dome(distSeg(x, y, -0.25, 0.26, -0.56, 0.02), 0.115, 0.88);
      const fIndex  = dome(distSeg(x, y, -0.20, -0.02, -0.27, -0.58), 0.095, 0.90);
      const fMiddle = dome(distSeg(x, y, -0.02, -0.06, -0.02, -0.68), 0.098, 0.94);
      const fRing   = dome(distSeg(x, y, 0.16, -0.02, 0.21, -0.59), 0.092, 0.88);
      const fPinky  = dome(distSeg(x, y, 0.30, 0.08, 0.42, -0.38), 0.084, 0.82);

      let h = smoothMax(palm, wrist, 0.12);
      h = smoothMax(h, fThumb, 0.08);
      h = smoothMax(h, fIndex, 0.06);
      h = smoothMax(h, fMiddle, 0.06);
      h = smoothMax(h, fRing, 0.06);
      h = smoothMax(h, fPinky, 0.06);
      return { h: Math.min(1, h), paint: null };
    },

    star(u, v) {
      const x = u * 1.15;
      const y = v * 0.92 + 0.04;
      const ang = Math.atan2(y, x) + Math.PI / 2;
      const rad = Math.hypot(x, y);
      const sector = (2 * Math.PI) / 5;
      const a = Math.abs((((ang % sector) + sector) % sector) - sector / 2);
      const outer = 0.78;
      const inner = 0.34;
      const t = a / (sector / 2);
      const edgeR = (outer * inner) / (inner * (1 - t) + outer * t + 0.0001);
      if (rad > edgeR) return { h: 0, paint: null };
      const q = rad / edgeR;
      return { h: Math.min(1, Math.pow(1 - q, 0.55) * 0.96 + 0.08 * (1 - q)), paint: null };
    },

    heart(u, v) {
      const x = u * 1.25;
      const y = -v * 1.05 + 0.10;
      const a = x * x + y * y - 0.52;
      const val = a * a * a - x * x * y * y * y * 0.85;
      if (val > 0) return { h: 0, paint: null };
      const depth = Math.min(1, Math.pow(Math.min(1, -val * 6.5), 0.36));
      return { h: 0.22 + depth * 0.78, paint: null };
    },

    smiley(u, v) {
      const x = u * 1.15;
      const y = v * 0.92;
      let h = dome(Math.hypot(x, y), 0.76, 0.96);
      if (h <= 0) return { h: 0, paint: null };
      let paint = null;
      if (Math.hypot(x + 0.25, y + 0.16) < 0.11 || Math.hypot(x - 0.25, y + 0.16) < 0.11) {
        h *= 0.48;
        paint = [29, 53, 87];
      }
      if (Math.hypot(x + 0.42, y - 0.04) < 0.12 || Math.hypot(x - 0.42, y - 0.04) < 0.12) {
        paint = [238, 108, 108];
      }
      const smileR = Math.hypot(x, y - 0.04);
      if (y > 0.12 && Math.abs(smileR - 0.36) < 0.075 && Math.abs(x) < 0.36) {
        h *= 0.52;
        paint = [29, 53, 87];
      }
      return { h, paint };
    },

    bear(u, v) {
      const x = u * 1.18;
      const y = v * 0.95 + 0.05;
      const head = dome(Math.hypot(x / 1.04, (y - 0.04) / 0.92), 0.56, 0.86);
      const earL = dome(Math.hypot(x + 0.46, y + 0.40), 0.24, 0.74);
      const earR = dome(Math.hypot(x - 0.46, y + 0.40), 0.24, 0.74);
      const snout = dome(Math.hypot(x / 1.18, (y - 0.18) / 0.88), 0.24, 1.0);
      let h = smoothMax(head, earL, 0.06);
      h = smoothMax(h, earR, 0.06);
      h = Math.max(h, snout);
      let paint = null;
      if (Math.hypot(x + 0.20, y + 0.05) < 0.075 || Math.hypot(x - 0.20, y + 0.05) < 0.075) {
        h = Math.max(0.35, h - 0.22);
        paint = [35, 38, 46];
      }
      if (Math.hypot(x / 1.25, y - 0.12) < 0.085) {
        h = 1.0;
        paint = [46, 36, 32];
      }
      return { h: Math.min(1, h), paint };
    },

    skyline(u, v, col, row) {
      // City towers with lit yellow windows and a glowing full moon (echoes shot-city.jpg!)
      let h = 0;
      let paint = null;

      // Full moon in upper right
      const moon = dome(Math.hypot((u - 0.58) * 1.25, (v + 0.52) * 0.95), 0.22, 0.92);
      if (moon > 0) {
        return { h: moon, paint: [255, 224, 92] };
      }

      // Five sculpted towers of varied depths and spires
      const towers = [
        { x0: -0.82, x1: -0.52, top:  0.04, depth: 0.70, spire: -0.67, spireTop: -0.10 },
        { x0: -0.48, x1: -0.14, top: -0.34, depth: 0.88, spire: -0.31, spireTop: -0.58 },
        { x0: -0.10, x1:  0.24, top: -0.50, depth: 0.98, spire:  0.07, spireTop: -0.78 },
        { x0:  0.28, x1:  0.54, top: -0.14, depth: 0.78, spire:  0.41, spireTop: -0.30 },
        { x0:  0.58, x1:  0.84, top:  0.14, depth: 0.64, spire:  0.71, spireTop:  0.00 },
      ];

      if (v <= 0.76) {
        for (const t of towers) {
          if (u >= t.x0 && u <= t.x1 && v >= t.top) {
            const cx = (t.x0 + t.x1) * 0.5;
            const halfW = (t.x1 - t.x0) * 0.5;
            const crown = Math.sqrt(Math.max(0.25, 1 - Math.pow((u - cx) / halfW, 2) * 0.55));
            const th = t.depth * crown;
            if (th > h) {
              h = th;
              // Warm lit windows on a neat grid
              const inWinX = (col % 2 === 0) && u > t.x0 + 0.05 && u < t.x1 - 0.05;
              const inWinY = (row % 3 === 1) && v > t.top + 0.12 && v < 0.66;
              const hash = Math.abs(Math.sin(col * 17.3 + row * 31.7));
              if (inWinX && inWinY && hash > 0.36) {
                paint = hash > 0.82 ? [255, 178, 64] : [255, 224, 92];
              }
            }
          } else if (v >= t.spireTop && v < t.top) {
            const frac = (v - t.spireTop) / (t.top - t.spireTop);
            const halfW = 0.025 + frac * ((t.x1 - t.x0) * 0.36);
            if (Math.abs(u - t.spire) <= halfW) {
              h = Math.max(h, t.depth * 0.82);
            }
          }
        }
      }
      return { h: Math.min(1, h), paint };
    },
  };

  function applyStamp(name) {
    const fn = STAMPS[name];
    if (!fn) return;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const idx = r * COLS + c;
        const u = ((c + (r % 2 ? 0.5 : 0)) / (COLS - 0.5)) * 2 - 1;
        const v = (r / (ROWS - 1)) * 2 - 1;
        const res = fn(u, v, c, r);
        targets[idx] = res.h;
        paints[idx] = res.paint || null;
        if (reducedMotion) {
          heights[idx] = res.h;
          vels[idx] = 0;
        }
      }
    }
    if (reducedMotion) {
      state.mode = 'idle';
      render();
    } else {
      state.mode = 'animate';
      playPinClick(0.9);
      ensureLoop();
    }
    const label = name.charAt(0).toUpperCase() + name.slice(1);
    updateStatus(`Stamp: ${label}`);
  }

  function triggerDrop() {
    for (let i = 0; i < COUNT; i++) {
      targets[i] = 0;
      paints[i] = null;
      vels[i] = heights[i] > 0.02 ? -(0.008 + Math.random() * 0.025) : 0;
      if (reducedMotion) heights[i] = 0;
    }
    if (reducedMotion) {
      state.mode = 'idle';
      render();
    } else {
      state.mode = 'drop';
      playPinClick(1.0);
      ensureLoop();
    }
    updateStatus('Gravity reset — every pin slid home');
  }

  /* ---------------- Geometry & Resize ---------------- */
  function resize() {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    layout.w = rect.width;
    layout.h = rect.height;
    layout.dpr = dpr;

    const padX = Math.max(24, rect.width * 0.075);
    const padY = Math.max(22, rect.height * 0.085);
    const pitchX = (rect.width - padX * 2) / (COLS - 0.5);
    const pitchY = (rect.height - padY * 2) / ((ROWS - 1) * 0.8660254);
    layout.pitch = Math.min(pitchX, pitchY);
    layout.r = layout.pitch * 0.445;

    const gridW = (COLS - 0.5) * layout.pitch;
    const gridH = (ROWS - 1) * layout.pitch * 0.8660254;
    layout.ox = (rect.width - gridW) * 0.46;
    layout.oy = (rect.height - gridH) * 0.55;
    render();
  }

  /* ---------------- Pointer Pressing / Painting / Flattening ---------------- */
  function applyBrushAt(px, py, isHold) {
    const maxExtrude = layout.pitch * 3.1;
    const sx = state.tilt * maxExtrude * 0.78;
    const sy = -state.tilt * maxExtrude * 0.52;
    const adjX = px - sx * 0.38;
    const adjY = py - sy * 0.38;

    const radius = layout.pitch * (state.brush === 'wide' ? 4.2 : 1.95);
    const r2 = radius * radius;
    let moved = 0;

    if (state.tool === 'paint' && state.paintKey === 'rainbow') {
      state.rainbowPhase = (state.rainbowPhase + (isHold ? 3 : 8)) % 360;
    }

    for (let r = 0; r < ROWS; r++) {
      const by = layout.oy + r * layout.pitch * 0.8660254;
      const dy = by - adjY;
      if (dy * dy > r2) continue;
      const rowOff = r % 2 ? 0.5 : 0;
      for (let c = 0; c < COLS; c++) {
        const bx = layout.ox + (c + rowOff) * layout.pitch;
        const dx = bx - adjX;
        const d2 = dx * dx + dy * dy;
        if (d2 >= r2) continue;

        const idx = r * COLS + c;
        const norm = Math.sqrt(d2) / radius;
        const falloff = Math.cos(norm * Math.PI * 0.5);
        const strength = falloff * falloff;

        if (state.tool === 'press') {
          const step = (isHold ? 0.065 : 0.24) * strength;
          const next = Math.min(1, heights[idx] + step);
          if (next > heights[idx] + 0.004) {
            heights[idx] = next;
            targets[idx] = next;
            moved++;
          }
        } else if (state.tool === 'erase') {
          const step = (isHold ? 0.09 : 0.32) * strength;
          const next = Math.max(0, heights[idx] - step);
          if (next < heights[idx] - 0.004 || paints[idx]) {
            heights[idx] = next;
            targets[idx] = next;
            if (norm < 0.75) paints[idx] = null;
            moved++;
          }
        } else if (state.tool === 'paint') {
          const colSpec = PAINT_COLORS[state.paintKey];
          const rgb = colSpec === 'rainbow'
            ? hslToRgb((state.rainbowPhase + c * 7 + r * 5) % 360, 0.88, 0.58)
            : colSpec;
          if (norm < 0.85) {
            paints[idx] = rgb;
            const minRise = 0.55 * falloff;
            if (heights[idx] < minRise) {
              heights[idx] = minRise;
              targets[idx] = minRise;
            }
            moved++;
          }
        }
      }
    }

    if (moved > 0) {
      playPinClick(Math.min(1, moved / 28));
      render();
    }
  }

  function pointerToCanvas(e) {
    const rect = canvas.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }

  canvas.addEventListener('mousedown', (e) => e.preventDefault());

  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    window.getSelection?.()?.removeAllRanges?.();
    document.body.classList.add('is-sculpting');
    canvas.setPointerCapture(e.pointerId);
    state.pointerDown = true;
    state.mode = 'idle';
    const [x, y] = pointerToCanvas(e);
    state.pointerX = x;
    state.pointerY = y;
    applyBrushAt(x, y, false);
    ensureLoop();
  });

  document.addEventListener('selectstart', (e) => {
    if (state.pointerDown) e.preventDefault();
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!state.pointerDown) return;
    const [x, y] = pointerToCanvas(e);
    const dist = Math.hypot(x - state.pointerX, y - state.pointerY);
    const steps = Math.max(1, Math.min(10, Math.ceil(dist / (layout.pitch * 0.9))));
    for (let s = 1; s <= steps; s++) {
      const ix = state.pointerX + ((x - state.pointerX) * s) / steps;
      const iy = state.pointerY + ((y - state.pointerY) * s) / steps;
      applyBrushAt(ix, iy, false);
    }
    state.pointerX = x;
    state.pointerY = y;
  });

  function stopPointer() {
    state.pointerDown = false;
    document.body.classList.remove('is-sculpting');
  }
  canvas.addEventListener('pointerup', stopPointer);
  canvas.addEventListener('pointercancel', stopPointer);
  window.addEventListener('blur', stopPointer);

  /* ---------------- Animation Loop (0% CPU When Idle) ---------------- */
  function ensureLoop() {
    if (!rafId) rafId = requestAnimationFrame(tick);
  }

  function tick() {
    rafId = 0;
    let keepGoing = false;

    if (state.pointerDown) {
      applyBrushAt(state.pointerX, state.pointerY, true);
      keepGoing = true;
    }

    if (state.mode === 'animate') {
      let maxDiff = 0;
      for (let i = 0; i < COUNT; i++) {
        const diff = targets[i] - heights[i];
        if (Math.abs(diff) > 0.0025) {
          heights[i] += diff * (0.14 + 0.06 * fric[i]);
          if (Math.abs(diff) > maxDiff) maxDiff = Math.abs(diff);
        } else {
          heights[i] = targets[i];
        }
      }
      render();
      if (maxDiff > 0.003) keepGoing = true;
      else state.mode = 'idle';
    } else if (state.mode === 'drop') {
      let active = 0;
      for (let i = 0; i < COUNT; i++) {
        if (heights[i] > 0 || vels[i] !== 0) {
          vels[i] -= 0.0046 * fric[i];
          heights[i] += vels[i];
          if (heights[i] <= 0) {
            heights[i] = 0;
            if (Math.abs(vels[i]) > 0.04) {
              vels[i] = -vels[i] * 0.22;
              if (Math.random() < 0.06) playPinClick(0.35);
            } else {
              vels[i] = 0;
            }
          }
          if (heights[i] > 0 || vels[i] !== 0) active++;
        }
      }
      render();
      if (active > 0) keepGoing = true;
      else state.mode = 'idle';
    }

    if (keepGoing) rafId = requestAnimationFrame(tick);
  }

  /* ---------------- Backdrop Scenes (inspired by the app's Style scenes) ---------------- */
  function drawBackdrop(w, h) {
    const key = state.backdrop;
    if (key === 'aurora') {
      const g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, '#132436');
      g.addColorStop(0.5, '#1e3950');
      g.addColorStop(1, '#1a4a46');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);

      const glow1 = ctx.createRadialGradient(w * 0.18, h * 0.3, 10, w * 0.2, h * 0.35, w * 0.65);
      glow1.addColorStop(0, 'rgba(130, 96, 215, 0.42)');
      glow1.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = glow1;
      ctx.fillRect(0, 0, w, h);

      const glow2 = ctx.createRadialGradient(w * 0.82, h * 0.78, 10, w * 0.8, h * 0.72, w * 0.65);
      glow2.addColorStop(0, 'rgba(54, 216, 152, 0.42)');
      glow2.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = glow2;
      ctx.fillRect(0, 0, w, h);
    } else if (key === 'starry') {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#1a1533');
      g.addColorStop(0.55, '#2b204d');
      g.addColorStop(1, '#1c1736');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      for (const s of STARS) {
        ctx.fillStyle = `rgba(255, 248, 232, ${s.o})`;
        ctx.beginPath();
        ctx.arc(s.x * w, s.y * h, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (key === 'ocean') {
      const g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, '#0c5266');
      g.addColorStop(0.55, '#0b3c52');
      g.addColorStop(1, '#082638');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      const caust = ctx.createRadialGradient(w * 0.5, h * 0.1, 10, w * 0.5, h * 0.25, w * 0.7);
      caust.addColorStop(0, 'rgba(120, 235, 245, 0.34)');
      caust.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = caust;
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(180, 242, 250, 0.35)';
      ctx.lineWidth = 1.4;
      for (let i = 0; i < 9; i++) {
        const bx = (0.06 + ((i * 0.115) % 0.9)) * w;
        const by = (0.12 + ((i * 0.23) % 0.78)) * h;
        ctx.beginPath();
        ctx.arc(bx, by, 4 + (i % 3) * 3, 0, Math.PI * 2);
        ctx.stroke();
      }
    } else if (key === 'sunset') {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#362149');
      g.addColorStop(0.5, '#9d4a66');
      g.addColorStop(0.84, '#e69f56');
      g.addColorStop(1, '#4c264a');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    } else {
      // Studio dark gradient
      const g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, '#181d29');
      g.addColorStop(1, '#0c0f17');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      const spot = ctx.createRadialGradient(w * 0.34, h * 0.24, 10, w * 0.45, h * 0.45, w * 0.85);
      spot.addColorStop(0, 'rgba(140, 185, 225, 0.11)');
      spot.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = spot;
      ctx.fillRect(0, 0, w, h);
    }
  }

  /* ---------------- High-DPI 2.5D Pin Rendering ---------------- */
  function render() {
    const { w, h, dpr, pitch, r } = layout;
    ctx.save();
    ctx.scale(dpr, dpr);

    drawBackdrop(w, h);

    // Pinboard housing plate
    const plateX = layout.ox - pitch * 0.8;
    const plateY = layout.oy - pitch * 0.8;
    const plateW = (COLS - 0.5) * pitch + pitch * 1.6;
    const plateH = (ROWS - 1) * pitch * 0.8660254 + pitch * 1.6;
    ctx.fillStyle = '#090c12';
    ctx.fillRect(plateX, plateY, plateW, plateH);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 1;
    ctx.strokeRect(plateX + 0.5, plateY + 0.5, plateW - 1, plateH - 1);

    const finishDef = FINISHES[state.finish] || FINISHES.gold;
    const maxExtrude = pitch * 3.1;
    const sx = state.tilt * maxExtrude * 0.78;
    const sy = -state.tilt * maxExtrude * 0.52;
    const drawShafts = state.tilt > 0.025;

    ctx.lineCap = 'round';

    // Painter's order for pins protruding UP (-y) and RIGHT (+x)
    for (let row = 0; row < ROWS; row++) {
      const by = layout.oy + row * pitch * 0.8660254;
      const rowOff = row % 2 ? 0.5 : 0;
      for (let col = COLS - 1; col >= 0; col--) {
        const idx = row * COLS + col;
        const ph = heights[idx];
        const bx = layout.ox + (col + rowOff) * pitch;
        const tx = bx + sx * ph;
        const ty = by + sy * ph;

        const painted = paints[idx];
        const baseRgb = painted || finishDef.rgb(col, row);
        const isMetallic = painted ? false : finishDef.metallic;
        const lit = 0.40 + 0.60 * ph;
        const hr = r * (1 + 0.08 * ph);

        if (drawShafts && ph > 0.03) {
          ctx.strokeStyle = rgbStr(baseRgb, lit * 0.54);
          ctx.lineWidth = hr * 1.72;
          ctx.beginPath();
          ctx.moveTo(bx, by);
          ctx.lineTo(tx, ty);
          ctx.stroke();

          if (isMetallic && ph > 0.14) {
            ctx.strokeStyle = `rgba(255, 255, 255, ${0.14 + 0.18 * ph})`;
            ctx.lineWidth = Math.max(1, hr * 0.36);
            ctx.beginPath();
            ctx.moveTo(bx - hr * 0.35, by - hr * 0.32);
            ctx.lineTo(tx - hr * 0.35, ty - hr * 0.32);
            ctx.stroke();
          }
        }

        ctx.fillStyle = rgbStr(baseRgb, lit * 0.72);
        ctx.beginPath();
        ctx.arc(tx, ty, hr, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = rgbStr(baseRgb, lit * 1.08);
        ctx.beginPath();
        ctx.arc(tx - hr * 0.14, ty - hr * 0.16, hr * 0.78, 0, Math.PI * 2);
        ctx.fill();

        const specAlpha = (isMetallic ? 0.58 : 0.44) * (0.30 + 0.70 * ph);
        ctx.fillStyle = `rgba(255, 255, 255, ${specAlpha.toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(tx - hr * 0.30, ty - hr * 0.32, hr * (isMetallic ? 0.34 : 0.27), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Clear acrylic box front pane & corner connectors
    const glassOffX = sx * 0.92;
    const glassOffY = sy * 0.92;
    const gx = plateX + glassOffX;
    const gy = plateY + glassOffY;

    if (drawShafts) {
      ctx.strokeStyle = 'rgba(215, 238, 255, 0.18)';
      ctx.lineWidth = 1.2;
      const corners = [
        [plateX, plateY],
        [plateX + plateW, plateY],
        [plateX, plateY + plateH],
        [plateX + plateW, plateY + plateH],
      ];
      for (const [cx, cy] of corners) {
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + glassOffX, cy + glassOffY);
        ctx.stroke();
      }
    }

    const glass = ctx.createLinearGradient(gx, gy, gx + plateW * 0.75, gy + plateH * 0.65);
    glass.addColorStop(0, 'rgba(255, 255, 255, 0.08)');
    glass.addColorStop(0.28, 'rgba(255, 255, 255, 0.02)');
    glass.addColorStop(0.48, 'rgba(255, 255, 255, 0)');
    glass.addColorStop(1, 'rgba(130, 215, 210, 0.03)');
    ctx.fillStyle = glass;
    ctx.fillRect(gx, gy, plateW, plateH);

    ctx.strokeStyle = 'rgba(215, 238, 255, 0.28)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(gx + 0.5, gy + 0.5, plateW - 1, plateH - 1);

    ctx.restore();
  }

  /* ---------------- Wire Up Controls ---------------- */
  const statusEl = document.getElementById('pin-status');
  function updateStatus(msg) {
    if (statusEl) statusEl.textContent = msg;
  }

  const paintRow = document.getElementById('paint-palette');
  const toolButtons = document.querySelectorAll('[data-pin-tool]');
  function setTool(tool) {
    state.tool = tool;
    toolButtons.forEach((b) => {
      const active = b.dataset.pinTool === tool;
      b.classList.toggle('is-active', active);
      b.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    if (paintRow) paintRow.classList.toggle('is-open', tool === 'paint');
    const labels = {
      press: 'Press & hold to push pins deeper',
      paint: 'Paint pins with bright colours',
      erase: 'Drag to push pins back flat',
    };
    updateStatus(labels[tool] || '');
  }
  toolButtons.forEach((b) => b.addEventListener('click', () => setTool(b.dataset.pinTool)));

  const brushButtons = document.querySelectorAll('[data-pin-brush]');
  brushButtons.forEach((b) => {
    b.addEventListener('click', () => {
      state.brush = b.dataset.pinBrush;
      brushButtons.forEach((x) => {
        const active = x.dataset.pinBrush === state.brush;
        x.classList.toggle('is-active', active);
        x.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
    });
  });

  const paintSwatches = document.querySelectorAll('[data-paint-color]');
  paintSwatches.forEach((b) => {
    b.addEventListener('click', () => {
      state.paintKey = b.dataset.paintColor;
      paintSwatches.forEach((x) => x.classList.toggle('is-active', x === b));
      setTool('paint');
    });
  });

  const finishSwatches = document.querySelectorAll('[data-pin-finish]');
  function setFinish(key, scrollToToy = false) {
    if (!FINISHES[key]) return;
    state.finish = key;
    finishSwatches.forEach((x) => {
      const active = x.dataset.pinFinish === key;
      x.classList.toggle('is-active', active);
      if (x.hasAttribute('aria-pressed')) x.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    render();
    updateStatus(`Finish: ${FINISHES[key].name}`);
    if (scrollToToy) {
      document.getElementById('play')?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth' });
    }
  }
  finishSwatches.forEach((b) => {
    b.addEventListener('click', () => {
      setFinish(b.dataset.pinFinish, b.dataset.jumpToy === 'true');
    });
  });

  const backdropSwatches = document.querySelectorAll('[data-pin-backdrop]');
  backdropSwatches.forEach((b) => {
    b.addEventListener('click', () => {
      const key = b.dataset.pinBackdrop;
      if (!BACKDROPS[key]) return;
      state.backdrop = key;
      backdropSwatches.forEach((x) => {
        const active = x.dataset.pinBackdrop === key;
        x.classList.toggle('is-active', active);
        x.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
      render();
      updateStatus(`Backdrop: ${BACKDROPS[key]}`);
    });
  });

  document.querySelectorAll('[data-pin-stamp]').forEach((b) => {
    b.addEventListener('click', () => applyStamp(b.dataset.pinStamp));
  });

  const tiltInput = document.getElementById('pin-tilt');
  const tiltReadout = document.getElementById('tilt-readout');
  if (tiltInput) {
    const syncTilt = () => {
      const deg = Number(tiltInput.value) || 0;
      state.tilt = deg / 45;
      if (tiltReadout) tiltReadout.textContent = `${deg}°`;
      render();
    };
    tiltInput.addEventListener('input', syncTilt);
    syncTilt();
  }

  document.getElementById('pin-reset')?.addEventListener('click', triggerDrop);

  const soundBtn = document.getElementById('pin-sound');
  if (soundBtn) {
    soundBtn.addEventListener('click', () => {
      state.sound = !state.sound;
      soundBtn.classList.toggle('is-active', state.sound);
      soundBtn.setAttribute('aria-pressed', state.sound ? 'true' : 'false');
      soundBtn.textContent = state.sound ? 'Sound: On' : 'Sound: Off';
      if (state.sound) playPinClick(0.8);
    });
  }

  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(() => resize()).observe(canvas);
  }
  window.addEventListener('resize', resize);
  resize();

  // Start with the classic 3D handprint
  applyStamp('hand');
})();
