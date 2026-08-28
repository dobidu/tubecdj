// Beat sync, pitch mapping and quantize.

import { state } from '../state.js';

/** pitch 0..1 -> percent within ±range */
export const pitchPercent = (d) => (d.pitch - 0.5) * 2 * d.pitchRange;

/**
 * Playback rate for a deck. SYNC (when both BPMs are known) overrides the
 * pitch fader by matching the master BPM; otherwise pitch + jog bend apply.
 */
export function deckRate(d, masterBpm = state.masterBpm) {
  let rate;
  if (d.sync && d.bpm > 0 && masterBpm > 0) rate = masterBpm / d.bpm;
  else rate = 1 + pitchPercent(d) / 100;
  return Math.max(0.25, Math.min(2, rate * (1 + d.bend)));
}

/** Effective (heard) BPM. */
export const effectiveBpm = (d, masterBpm) => (d.bpm > 0 ? d.bpm * deckRate(d, masterBpm) : 0);

/** Seconds per beat at the heard tempo. */
export function secPerBeat(d, masterBpm) {
  const bpm = effectiveBpm(d, masterBpm);
  return bpm > 0 ? 60 / bpm : 0;
}

/** Snap a time to the nearest beat when QUANT is on. beatOffset = first cue or 0. */
export function quantize(d, t, masterBpm = state.masterBpm) {
  if (!d.quantize) return t;
  const spb = secPerBeat(d, masterBpm);
  if (!spb) return t;
  const offset = d.cues[0] ?? 0;
  return offset + Math.round((t - offset) / spb) * spb;
}

/** Match this deck's BPM to the master and turn SYNC on. */
export function engageSync(d) {
  return { sync: !d.sync };
}
