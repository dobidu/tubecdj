// Four one-shots. Synthesized by default (no assets to ship); any slot can be
// replaced by dropping a file on the pad, which then persists in IndexedDB.

import { audioCtx } from './graph.js';
import { allSamples, putSample, deleteSample } from './sampleStore.js';

const NAMES = ['AIR HORN', 'VINYL BRK', 'SIREN', 'CLAP'];
let cache = null;

async function render(seconds, build) {
  const sr = audioCtx().sampleRate;
  const off = new OfflineAudioContext(1, Math.ceil(sr * seconds), sr);
  build(off);
  return await off.startRendering();
}

function noiseBuffer(off, seconds) {
  const buf = off.createBuffer(1, Math.ceil(off.sampleRate * seconds), off.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

async function buildAll() {
  const airHorn = await render(1.4, (off) => {
    const g = off.createGain();
    g.gain.setValueAtTime(0, 0);
    g.gain.linearRampToValueAtTime(0.85, 0.03);
    g.gain.setValueAtTime(0.85, 1.0);
    g.gain.linearRampToValueAtTime(0, 1.35);
    g.connect(off.destination);
    [1, 1.5, 2.01, 3.02].forEach((mult, i) => {
      const o = off.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(180 * mult, 0);
      o.frequency.linearRampToValueAtTime(240 * mult, 0.12);
      const og = off.createGain();
      og.gain.value = 0.32 / (i + 1);
      o.connect(og).connect(g);
      o.start(0); o.stop(1.4);
    });
  });

  const vinylBrk = await render(1.0, (off) => {
    const src = off.createBufferSource();
    src.buffer = noiseBuffer(off, 1.0);
    const bp = off.createBiquadFilter();
    bp.type = 'bandpass'; bp.Q.value = 1.4;
    bp.frequency.setValueAtTime(2200, 0);
    bp.frequency.exponentialRampToValueAtTime(90, 0.85);
    const g = off.createGain();
    g.gain.setValueAtTime(0.9, 0);
    g.gain.exponentialRampToValueAtTime(0.001, 0.95);
    src.playbackRate.setValueAtTime(1.4, 0);
    src.playbackRate.linearRampToValueAtTime(0.15, 0.9);
    src.connect(bp).connect(g).connect(off.destination);
    src.start(0);
  });

  const siren = await render(2.0, (off) => {
    const o = off.createOscillator();
    o.type = 'sine';
    const lfo = off.createOscillator();
    lfo.frequency.value = 1.6;
    const lg = off.createGain();
    lg.gain.value = 420;
    o.frequency.value = 900;
    lfo.connect(lg).connect(o.frequency);
    const g = off.createGain();
    g.gain.setValueAtTime(0, 0);
    g.gain.linearRampToValueAtTime(0.6, 0.08);
    g.gain.setValueAtTime(0.6, 1.7);
    g.gain.linearRampToValueAtTime(0, 1.98);
    o.connect(g).connect(off.destination);
    o.start(0); o.stop(2.0); lfo.start(0); lfo.stop(2.0);
  });

  const clap = await render(0.45, (off) => {
    const out = off.createGain();
    out.gain.value = 0.9;
    const hp = off.createBiquadFilter();
    hp.type = 'bandpass'; hp.frequency.value = 1500; hp.Q.value = 0.9;
    hp.connect(out).connect(off.destination);
    [0, 0.012, 0.024, 0.04].forEach((t, i) => {
      const src = off.createBufferSource();
      src.buffer = noiseBuffer(off, 0.2);
      const g = off.createGain();
      const peak = i === 3 ? 0.9 : 0.55;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(peak, t + 0.002);
      g.gain.exponentialRampToValueAtTime(0.001, t + (i === 3 ? 0.22 : 0.05));
      src.connect(g).connect(hp);
      src.start(t);
    });
  });

  return [airHorn, vinylBrk, siren, clap];
}

export class Sampler {
  constructor(destination) {
    this.dest = destination;
    this.buffers = null;        // synthesized defaults
    this.custom = [null, null, null, null];   // { name, buffer } per slot
    this.voices = new Map();
  }

  async load() {
    if (!cache) cache = await buildAll();
    this.buffers = cache;
    await this.restore();
    return NAMES;
  }

  /** Decode whatever the user stored in earlier sessions. */
  async restore() {
    for (const row of await allSamples()) {
      if (typeof row.slot !== 'number' || row.slot < 0 || row.slot > 3) continue;
      try {
        // decodeAudioData detaches the buffer, so hand it a copy
        const buffer = await audioCtx().decodeAudioData(row.data.slice(0));
        this.custom[row.slot] = { name: row.name, buffer };
      } catch { await deleteSample(row.slot); }
    }
  }

  /** Load a user file into a slot and persist it. @returns {Promise<string>} label */
  async loadFile(slot, file) {
    const data = await file.arrayBuffer();
    const buffer = await audioCtx().decodeAudioData(data.slice(0));
    const name = file.name.replace(/\.[^.]+$/, '');
    this.custom[slot] = { name, buffer };
    await putSample(slot, name, data);
    return name;
  }

  /** Drop a user sample; the synthesized default comes back. */
  async clear(slot) {
    this.custom[slot] = null;
    this.stop(slot);
    await deleteSample(slot);
  }

  bufferFor(i) { return this.custom[i]?.buffer || this.buffers?.[i] || null; }
  labelFor(i) { return this.custom[i]?.name || NAMES[i]; }
  isCustom(i) { return !!this.custom[i]; }
  /** Retriggers; returns false if the pad was already ringing (caller toggles off). */
  trigger(i) {
    const buffer = this.bufferFor(i);
    if (!buffer) return false;
    this.stop(i);
    const c = audioCtx();
    const src = c.createBufferSource();
    src.buffer = buffer;
    const g = c.createGain();
    g.gain.value = 0.9;
    src.connect(g).connect(this.dest);
    src.onended = () => { if (this.voices.get(i) === src) this.voices.delete(i); };
    src.start();
    this.voices.set(i, src);
    return true;
  }
  stop(i) {
    const v = this.voices.get(i);
    if (!v) return;
    try { v.stop(); } catch { /* done */ }
    this.voices.delete(i);
  }
  isRinging(i) { return this.voices.has(i); }
}
