// Canvas waveforms: scrolling detail view (playhead fixed at centre) + overview.
// Local Audio Mode draws real RMS peaks; YT mode draws a deterministic
// BPM grid derived from the videoId (labelled GRID ONLY).

import { h, rng, hash, fmt, drag } from '../util.js';
import { state } from '../state.js';
import { secPerBeat, gridAnchor } from '../mix/sync.js';

const WINDOW_SEC = 10;
const gridCache = new Map();

/** Deterministic pseudo-waveform: beat grid + seeded envelope. */
export function syntheticPeaks(videoId, dur, bpm, count = 1200) {
  const key = `${videoId}|${Math.round(dur)}|${bpm}`;
  if (gridCache.has(key)) return gridCache.get(key);
  const r = rng(hash(videoId || 'empty') + Math.round(bpm * 10));
  const out = new Float32Array(count);
  const spb = bpm > 0 ? 60 / bpm : 0.5;
  const beats = Math.max(1, (dur || count) / spb);
  for (let i = 0; i < count; i++) {
    const beat = (i / count) * beats;
    const inBeat = beat % 1;
    const bar = Math.floor(beat) % 4;
    const phrase = Math.floor(beat) % 8;
    const kick = Math.exp(-inBeat * 6) * (bar === 0 ? 1 : 0.72) * (phrase === 0 ? 1 : 0.92);
    const body = 0.34 + 0.42 * Math.abs(Math.sin((i / count) * Math.PI * 3.2));
    out[i] = Math.max(0.06, Math.min(1, (0.35 + 0.65 * kick) * body * (0.75 + r() * 0.4)));
  }
  gridCache.set(key, out);
  return out;
}

function peaksFor(d) {
  if (d.source === 'local' && d.peaks) return d.peaks;
  return syntheticPeaks(d.videoId || 'empty', d.dur || 300, d.bpm || 124);
}

function hexMix(hex, factor) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * factor);
  const g = Math.round(((n >> 8) & 255) * factor);
  const b = Math.round((n & 255) * factor);
  return `rgb(${r},${g},${b})`;
}

function fitCanvas(cv) {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(cv.clientWidth * dpr));
  const hh = Math.max(1, Math.round(cv.clientHeight * dpr));
  if (cv.width !== w || cv.height !== hh) { cv.width = w; cv.height = hh; }
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w: cv.clientWidth, h: cv.clientHeight };
}

const hasMedia = (d) => !!d.videoId || d.source === 'local';

/** Empty deck: a bare baseline, never a waveform that isn't there. */
function drawEmpty(cv) {
  const { ctx, w, h: hgt } = fitCanvas(cv);
  ctx.clearRect(0, 0, w, hgt);
  ctx.fillStyle = '#1B1E23';
  ctx.fillRect(0, Math.round(hgt / 2), w, 1);
}

function drawBig(cv, d, color) {
  const { ctx, w, h: hgt } = fitCanvas(cv);
  ctx.clearRect(0, 0, w, hgt);
  const dur = d.dur || 0;
  const peaks = peaksFor(d);
  const past = hexMix(color, 0.42);
  const spb = secPerBeat(d, state.masterBpm);
  const t0 = d.pos - WINDOW_SEC / 2;
  const mid = hgt / 2;

  // beat grid
  if (spb > 0) {
    const offset = gridAnchor(d);
    const first = Math.ceil((t0 - offset) / spb);
    for (let b = first; ; b++) {
      const t = offset + b * spb;
      if (t > t0 + WINDOW_SEC) break;
      const x = ((t - t0) / WINDOW_SEC) * w;
      ctx.fillStyle = b % 4 === 0 ? '#2B2F35' : '#1B1E23';
      ctx.fillRect(Math.round(x), 0, 1, hgt);
    }
  }

  // loop region
  if (d.loop.on && d.loop.inSec != null && spb > 0) {
    const inX = ((d.loop.inSec - t0) / WINDOW_SEC) * w;
    const outX = ((d.loop.inSec + d.loop.len * spb - t0) / WINDOW_SEC) * w;
    ctx.fillStyle = 'rgba(255,214,10,.09)';
    ctx.fillRect(inX, 0, outX - inX, hgt);
    ctx.fillStyle = '#FFD60A';
    ctx.fillRect(Math.round(inX), 0, 1, hgt);
    ctx.fillRect(Math.round(outX), 0, 1, hgt);
  }

  // waveform bars
  if (dur > 0) {
    for (let x = 0; x < w; x += 2) {
      const t = t0 + (x / w) * WINDOW_SEC;
      if (t < 0 || t > dur) continue;
      const i = Math.min(peaks.length - 1, Math.floor((t / dur) * peaks.length));
      const amp = peaks[i] * (hgt / 2 - 2);
      ctx.fillStyle = t <= d.pos ? past : color;
      ctx.fillRect(x, mid - amp, 2 - 0.4, amp * 2);
    }
  }

  // the downbeat, when it was set by hand
  if (d.gridOffset != null && d.gridOffset >= t0 && d.gridOffset <= t0 + WINDOW_SEC) {
    const x = ((d.gridOffset - t0) / WINDOW_SEC) * w;
    ctx.fillStyle = '#38E08B';
    ctx.fillRect(Math.round(x) - 1, 0, 2, hgt);
    ctx.fillRect(Math.round(x) - 1, 0, 7, 4);
  }

  // hot cues
  d.cues.forEach((t, i) => {
    if (t == null || t < t0 || t > t0 + WINDOW_SEC) return;
    const x = ((t - t0) / WINDOW_SEC) * w;
    ctx.fillStyle = '#FF6B5E';
    ctx.fillRect(Math.round(x), 0, 1, hgt);
    ctx.fillRect(Math.round(x), 0, 9, 9);
    ctx.fillStyle = '#0B0D0F';
    ctx.font = '700 8px JetBrains Mono, monospace';
    ctx.fillText(String(i + 1), Math.round(x) + 2, 7);
  });

  // playhead
  ctx.fillStyle = '#fff';
  ctx.shadowColor = '#fff';
  ctx.shadowBlur = 8;
  ctx.fillRect(Math.round(w / 2) - 1, 0, 2, hgt);
  ctx.shadowBlur = 0;
}

function drawMini(cv, d, color) {
  const { ctx, w, h: hgt } = fitCanvas(cv);
  ctx.clearRect(0, 0, w, hgt);
  const peaks = peaksFor(d);
  const dur = d.dur || 0;
  const mid = hgt / 2;
  const playedX = dur > 0 ? (d.pos / dur) * w : 0;
  for (let x = 0; x < w; x++) {
    const i = Math.min(peaks.length - 1, Math.floor((x / w) * peaks.length));
    const amp = peaks[i] * (mid - 1);
    ctx.fillStyle = x < playedX ? '#3A4048' : color;
    ctx.fillRect(x, mid - amp, 1, amp * 2);
  }
  d.cues.forEach((t) => {
    if (t == null || !dur) return;
    ctx.fillStyle = '#FF6B5E';
    ctx.fillRect(Math.round((t / dur) * w), 0, 1, hgt);
  });
  ctx.fillStyle = '#fff';
  ctx.fillRect(Math.round(playedX), 0, 2, hgt);
}

export function createWaveRow({ deckId, color, app }) {
  const el = h(`
    <div class="wave-row" style="--c:${color}">
      <div class="wave-time l">0:00</div>
      <div class="wave-big"><canvas></canvas><div class="wave-tag">GRID ONLY</div></div>
      <div class="wave-time r">-0:00</div>
      <div class="wave-mini"><canvas></canvas></div>
    </div>`);
  const big = el.querySelector('.wave-big');
  const mini = el.querySelector('.wave-mini');
  const bigCv = big.querySelector('canvas');
  const miniCv = mini.querySelector('canvas');
  const tEl = el.querySelector('.wave-time.l');
  const rEl = el.querySelector('.wave-time.r');
  const tag = el.querySelector('.wave-tag');

  // detail view: drag = relative scrub; overview: drag = absolute seek
  drag(big, {
    mode: 'raw',
    onStart: () => app.focusDeck(deckId),
    onMove: (ev, { ddx }) => {
      const w = big.clientWidth || 1;
      app.nudge(deckId, -(ddx / w) * WINDOW_SEC);
    },
  });
  drag(mini, {
    mode: 'trackX',
    get: () => 0,
    set: (v) => app.seekFrac(deckId, v),
    onStart: () => app.focusDeck(deckId),
  });

  function update() {
    const d = state.deck[deckId];
    const media = hasMedia(d);
    if (media) { drawBig(bigCv, d, color); drawMini(miniCv, d, color); }
    else { drawEmpty(bigCv); drawEmpty(miniCv); }
    const a = media ? fmt(d.pos) : '—:—';
    const b = media ? '-' + fmt(Math.max(0, d.dur - d.pos)) : '';
    if (tEl.textContent !== a) tEl.textContent = a;
    if (rEl.textContent !== b) rEl.textContent = b;
    const label = !media ? '' : d.source === 'local' ? 'AUDIO' : 'GRID ONLY';
    if (tag.textContent !== label) tag.textContent = label;
  }
  return { el, update };
}
