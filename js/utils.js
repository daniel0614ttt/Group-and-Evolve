/* Group and Evolve — shared utilities. Classic script, no build step. */
(function (root) {
  'use strict';
  const Evo = (root.Evo = root.Evo || {});

  const TAU = Math.PI * 2;

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const invLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));
  const mod = (n, m) => ((n % m) + m) % m;
  const damp = (current, target, smoothing, dt) =>
    lerp(current, target, 1 - Math.exp(-smoothing * dt));

  /** Small, fast, seedable PRNG (Mulberry32). */
  class RNG {
    constructor(seed = 0x9e3779b9) {
      this.state = seed >>> 0;
      this._spare = null;
    }

    next() {
      let t = (this.state += 0x6d2b79f5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    range(min, max) {
      return min + this.next() * (max - min);
    }

    int(min, max) {
      return Math.floor(this.range(min, max + 1));
    }

    chance(probability) {
      return this.next() < probability;
    }

    pick(items) {
      return items[Math.floor(this.next() * items.length)];
    }

    sign() {
      return this.next() < 0.5 ? -1 : 1;
    }

    /** Standard normal via Box-Muller (polar form, cached). */
    gauss() {
      if (this._spare !== null) {
        const value = this._spare;
        this._spare = null;
        return value;
      }
      let u = 0;
      let v = 0;
      let s = 0;
      do {
        u = this.next() * 2 - 1;
        v = this.next() * 2 - 1;
        s = u * u + v * v;
      } while (s >= 1 || s === 0);
      const mul = Math.sqrt((-2 * Math.log(s)) / s);
      this._spare = v * mul;
      return u * mul;
    }
  }

  function formatTick(value) {
    if (value < 1000) return String(Math.floor(value));
    if (value < 1000000) {
      const k = value / 1000;
      return `${k < 10 ? k.toFixed(1) : Math.round(k)}k`;
    }
    return `${(value / 1000000).toFixed(1)}m`;
  }

  function formatSigned(value, digits = 2) {
    return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}`;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  Evo.Utils = {
    TAU,
    clamp,
    lerp,
    invLerp,
    mod,
    damp,
    RNG,
    formatTick,
    formatSigned,
    escapeHtml,
  };
})(typeof window !== 'undefined' ? window : globalThis);
