// Offline analysis for Local Audio Mode: decode, waveform peaks, BPM.

import { audioCtx } from './graph.js';
import { detectKey } from './key.js';
import { camelot, keyName } from '../mix/harmony.js';

export async function decodeFile(file) {
  const arr = await file.arrayBuffer();
  return await audioCtx().decodeAudioData(arr);
}

/** RMS peaks, 0..1, `count` buckets. */
export function computePeaks(buffer, count = 2000) {
  const chs = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) chs.push(buffer.getChannelData(c));
  const n = buffer.length;
  const per = Math.max(1, Math.floor(n / count));
  const out = new Float32Array(count);
  let max = 1e-6;
  for (let i = 0; i < count; i++) {
    const start = i * per;
    const end = Math.min(n, start + per);
    let sum = 0, cnt = 0;
    for (let j = start; j < end; j += 2) {
      let s = 0;
      for (let c = 0; c < chs.length; c++) s += chs[c][j];
      s /= chs.length;
      sum += s * s; cnt++;
    }
    const rms = cnt ? Math.sqrt(sum / cnt) : 0;
    out[i] = rms;
    if (rms > max) max = rms;
  }
  for (let i = 0; i < count; i++) out[i] = Math.min(1, out[i] / max);
  return out;
}

/** Low band (60–200 Hz) render used for onset detection. */
async function lowBand(buffer) {
  const sr = 8000; // decimated: plenty for a 200 Hz ceiling
  const off = new OfflineAudioContext(1, Math.ceil(buffer.duration * sr), sr);
  const src = off.createBufferSource();
  src.buffer = buffer;
  const hp = off.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 60; hp.Q.value = 0.7;
  const lp = off.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 200; lp.Q.value = 0.7;
  src.connect(hp).connect(lp).connect(off.destination);
  src.start();
  const rendered = await off.startRendering();
  return { data: rendered.getChannelData(0), sampleRate: sr };
}

/**
 * BPM by autocorrelation of the onset-energy envelope, 70–180 BPM.
 * @returns {Promise<{bpm:number, confidence:number}>}
 */
export async function detectBpm(buffer) {
  const { data, sampleRate } = await lowBand(buffer);
  const fps = 200;                       // envelope frames per second
  const hop = Math.max(1, Math.floor(sampleRate / fps));
  const frames = Math.floor(data.length / hop);
  if (frames < fps * 4) return { bpm: 0, confidence: 0 };

  const env = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let j = i * hop; j < (i + 1) * hop; j++) sum += data[j] * data[j];
    env[i] = Math.sqrt(sum / hop);
  }
  // onset strength = positive deviation from a ~0.4 s moving average
  const win = Math.round(fps * 0.4);
  const onset = new Float32Array(frames);
  let run = 0;
  for (let i = 0; i < frames; i++) {
    run += env[i];
    if (i >= win) run -= env[i - win];
    const avg = run / Math.min(i + 1, win);
    onset[i] = Math.max(0, env[i] - avg);
  }
  let mean = 0;
  for (let i = 0; i < frames; i++) mean += onset[i];
  mean /= frames;
  for (let i = 0; i < frames; i++) onset[i] -= mean;

  const lagMin = Math.floor((60 / 180) * fps);
  const lagMax = Math.ceil((60 / 70) * fps);
  let best = 0, bestScore = 0;
  for (let lag = lagMin; lag <= lagMax; lag++) {
    let acc = 0;
    for (let i = 0; i + lag < frames; i++) acc += onset[i] * onset[i + lag];
    // reinforce the beat period with its harmonics, so half/double time loses
    for (const mult of [2, 3, 4]) {
      const l2 = lag * mult;
      if (l2 >= frames) break;
      let a2 = 0;
      for (let i = 0; i + l2 < frames; i++) a2 += onset[i] * onset[i + l2];
      acc += a2 * (0.5 / mult);
    }
    const bpm = (60 * fps) / lag;
    const centered = 1 - Math.abs(bpm - 125) / 220;   // gentle pull toward club tempi
    const score = acc * centered;
    if (score > bestScore) { bestScore = score; best = bpm; }
  }
  if (!best) return { bpm: 0, confidence: 0 };
  let bpm = best;
  while (bpm < 70) bpm *= 2;
  while (bpm > 180) bpm /= 2;
  return { bpm: Math.round(bpm * 10) / 10, confidence: Math.min(1, bestScore / (frames * 0.02)) };
}

/**
 * Full pass used when a file is dropped on a deck.
 * `skipAnalysis` skips BPM/key when the caller already has them cached —
 * decoding and peaks still have to happen, they are the audio itself.
 */
export async function analyseFile(file, { skipAnalysis = false } = {}) {
  const buffer = await decodeFile(file);
  const peaks = computePeaks(buffer);
  if (skipAnalysis) return { buffer, peaks, bpm: 0, key: null };
  const [{ bpm }, key] = await Promise.all([detectBpm(buffer), detectKey(buffer)]);
  return {
    buffer,
    peaks,
    bpm,
    key: key ? { ...key, camelot: camelot(key.pc, key.mode), name: keyName(key.pc, key.mode) } : null,
  };
}
