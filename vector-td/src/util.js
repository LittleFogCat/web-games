/* Shared math, colour and drawing utilities. */
(function () {
  'use strict';

  const TAU = Math.PI * 2;

  function clamp(value, min, max) {
    return value < min ? min : value > max ? max : value;
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function invLerp(a, b, v) {
    return a === b ? 0 : (v - a) / (b - a);
  }

  function easeOutCubic(t) {
    const p = 1 - clamp(t, 0, 1);
    return 1 - p * p * p;
  }

  function easeInOutCubic(t) {
    const v = clamp(t, 0, 1);
    return v < 0.5 ? 4 * v * v * v : 1 - Math.pow(-2 * v + 2, 3) / 2;
  }

  function dist(ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function dist2(ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    return dx * dx + dy * dy;
  }

  function angleTo(ax, ay, bx, by) {
    return Math.atan2(by - ay, bx - ax);
  }

  function normalizeAngle(a) {
    while (a > Math.PI) a -= TAU;
    while (a < -Math.PI) a += TAU;
    return a;
  }

  function mutateAngle(current, target, rate) {
    const diff = normalizeAngle(target - current);
    return current + clamp(diff, -rate, rate);
  }

  function hexToRgba(hex, alpha) {
    let h = String(hex || '#ffffff').replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const n = parseInt(h, 16);
    if (Number.isNaN(n)) return 'rgba(255,255,255,' + alpha + ')';
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
  }

  function mixHex(a, b, t) {
    const pa = parseInt(String(a).replace('#', ''), 16);
    const pb = parseInt(String(b).replace('#', ''), 16);
    if (Number.isNaN(pa) || Number.isNaN(pb)) return a;
    const ar = (pa >> 16) & 255;
    const ag = (pa >> 8) & 255;
    const ab = pa & 255;
    const br = (pb >> 16) & 255;
    const bg = (pb >> 8) & 255;
    const bb = pb & 255;
    const toHex = function (v) {
      return Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0');
    };
    return '#' + toHex(lerp(ar, br, t)) + toHex(lerp(ag, bg, t)) + toHex(lerp(ab, bb, t));
  }

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hashString(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function polygon(ctx, cx, cy, radius, sides, rotation, squash) {
    const sq = squash || 1;
    ctx.beginPath();
    for (let i = 0; i < sides; i++) {
      const a = rotation + (i / sides) * TAU;
      const x = cx + Math.cos(a) * radius;
      const y = cy + Math.sin(a) * radius * sq;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  function starPath(ctx, cx, cy, outer, inner, points, rotation) {
    ctx.beginPath();
    const count = points * 2;
    for (let i = 0; i < count; i++) {
      const r = i % 2 === 0 ? outer : inner;
      const a = rotation + (i / count) * TAU;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  function roundedRectPath(ctx, x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
    ctx.lineTo(x + w, y + h - radius);
    ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    ctx.lineTo(x + radius, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }

  function formatTime(seconds) {
    const sec = Math.max(0, Math.round(seconds));
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m + ':' + String(s).padStart(2, '0');
  }

  function formatInt(n) {
    return Math.round(n).toLocaleString('en-US');
  }

  function weightedPick(list, rng) {
    let total = 0;
    for (let i = 0; i < list.length; i++) total += list[i].w;
    let roll = rng() * total;
    for (let i = 0; i < list.length; i++) {
      roll -= list[i].w;
      if (roll <= 0) return list[i];
    }
    return list[list.length - 1];
  }

  function shuffle(arr, rng) {
    const copy = arr.slice();
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = copy[i];
      copy[i] = copy[j];
      copy[j] = t;
    }
    return copy;
  }

  const UTIL = {
    TAU: TAU,
    clamp: clamp,
    lerp: lerp,
    invLerp: invLerp,
    easeOutCubic: easeOutCubic,
    easeInOutCubic: easeInOutCubic,
    dist: dist,
    dist2: dist2,
    angleTo: angleTo,
    normalizeAngle: normalizeAngle,
    mutateAngle: mutateAngle,
    hexToRgba: hexToRgba,
    mixHex: mixHex,
    mulberry32: mulberry32,
    hashString: hashString,
    polygon: polygon,
    starPath: starPath,
    roundedRectPath: roundedRectPath,
    formatTime: formatTime,
    formatInt: formatInt,
    weightedPick: weightedPick,
    shuffle: shuffle,
    uid: (function () {
      let n = 1;
      return function () {
        return 'e' + n++ + '_' + Math.random().toString(36).slice(2, 6);
      };
    })(),
  };

  window.GEOTD_UTIL = UTIL;
})();
