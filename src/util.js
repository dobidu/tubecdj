// Small DOM / math helpers shared by the UI modules.

export const clamp = (v, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v);

/** Seconds -> m:ss (negative-safe). */
export function fmt(sec) {
  const s = Math.max(0, Math.round(sec || 0));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

/** Build an element from an HTML string (single root). */
export function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export const qs = (root, sel) => root.querySelector(sel);
export const qsa = (root, sel) => [...root.querySelectorAll(sel)];

/**
 * Continuous pointer drag with capture. Modes:
 *   'rel'    — relative: `span` px of travel covers 0..1 (knobs, pitch)
 *   'trackY' — absolute within the element rect, bottom = 0
 *   'trackX' — absolute within the element rect, left = 0
 *   'raw'    — hands the caller the raw event + deltas (jog)
 */
export function drag(el, opts) {
  const { mode = 'rel', get, set, span = 160, onStart, onEnd, onMove } = opts;
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    const x0 = e.clientX, y0 = e.clientY;
    let lastX = x0, lastY = y0;
    const v0 = get ? get() : 0;
    const rect = () => el.getBoundingClientRect();
    onStart?.(e);

    const apply = (ev) => {
      if (mode === 'rel') {
        set(clamp(v0 - (ev.clientY - y0) / span), ev);
      } else if (mode === 'trackY') {
        const r = rect();
        set(clamp(1 - (ev.clientY - r.top) / r.height), ev);
      } else if (mode === 'trackX') {
        const r = rect();
        set(clamp((ev.clientX - r.left) / r.width), ev);
      } else {
        const d = { dx: ev.clientX - x0, dy: ev.clientY - y0, ddx: ev.clientX - lastX, ddy: ev.clientY - lastY };
        lastX = ev.clientX; lastY = ev.clientY;
        onMove?.(ev, d);
      }
    };
    if (mode !== 'rel' && mode !== 'raw') apply(e);

    const move = (ev) => apply(ev);
    const up = (ev) => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      onEnd?.(ev);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  });
}

let toastTimer = null;
export function toast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

/** Deterministic PRNG (Lehmer) — used for synthetic waveforms. */
export function rng(seed) {
  let s = (Math.abs(seed | 0) % 2147483646) + 1;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/** Stable 31-bit hash of a string (videoId -> waveform seed). */
export function hash(str) {
  let hv = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hv ^= str.charCodeAt(i);
    hv = Math.imul(hv, 16777619);
  }
  return hv >>> 1;
}

export function throttle(fn, ms) {
  let last = 0, pending = null;
  return (...args) => {
    const now = performance.now();
    if (now - last >= ms) { last = now; fn(...args); return; }
    if (pending) return;
    pending = setTimeout(() => { pending = null; last = performance.now(); fn(...args); }, ms - (now - last));
  };
}

/**
 * Keyboard control for a drag-based slider (knob, fader, crossfader).
 * Arrows step, PageUp/Down jump, Home/End go to the ends, Enter/Space recentres.
 */
export function sliderKeys(el, { get, set, step = 0.02, big = 0.1, centre = 0.5 }) {
  el.addEventListener('keydown', (e) => {
    let v = get();
    switch (e.key) {
      case 'ArrowUp': case 'ArrowRight': v += step; break;
      case 'ArrowDown': case 'ArrowLeft': v -= step; break;
      case 'PageUp': v += big; break;
      case 'PageDown': v -= big; break;
      case 'Home': v = 0; break;
      case 'End': v = 1; break;
      case 'Enter': case ' ': v = centre; break;
      default: return;
    }
    e.preventDefault();
    e.stopPropagation();   // keep the global shortcut handler out of it
    set(clamp(v));
  });
}

/** Mirror a slider's value into ARIA so screen readers can follow it. */
export function sliderAria(el, value, text) {
  el.setAttribute('aria-valuenow', String(Math.round(value * 100)));
  if (text != null) el.setAttribute('aria-valuetext', text);
}
