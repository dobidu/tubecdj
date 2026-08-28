// Musical key detection for Local Audio Mode.
//
// Chroma via Goertzel filters (one per semitone, C2–C6) — cheaper and sharper
// for this job than a full FFT, since only 49 bins are ever needed — then
// Krumhansl-Schmuckler profile correlation over all 24 rotations.

const KS_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KS_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

const MIDI_LO = 36;   // C2
const MIDI_HI = 84;   // C6
const SR = 11025;     // render rate for the offline pass
const WIN = 4096;
const HOP_SEC = 0.5;
const MAX_FRAMES = 300;

/** Mono, decimated render — key lives in the mid range, so 11 kHz is plenty. */
async function monoLowRate(buffer) {
  const off = new OfflineAudioContext(1, Math.max(1, Math.ceil(buffer.duration * SR)), SR);
  const src = off.createBufferSource();
  src.buffer = buffer;
  // drop rumble and cymbal wash — both only blur the chroma
  const hp = off.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 55; hp.Q.value = 0.7;
  const lp = off.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2200; lp.Q.value = 0.7;
  src.connect(hp).connect(lp).connect(off.destination);
  src.start();
  const out = await off.startRendering();
  return out.getChannelData(0);
}

/** Goertzel power of one frequency over a windowed frame. */
function goertzel(data, start, len, coeff, win) {
  let s1 = 0, s2 = 0;
  for (let i = 0; i < len; i++) {
    const s = data[start + i] * win[i] + coeff * s1 - s2;
    s2 = s1;
    s1 = s;
  }
  return Math.max(0, s1 * s1 + s2 * s2 - coeff * s1 * s2);
}

function pearson(a, b) {
  const n = a.length;
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let num = 0, da = 0, dbv = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma, y = b[i] - mb;
    num += x * y; da += x * x; dbv += y * y;
  }
  const den = Math.sqrt(da * dbv);
  return den > 1e-9 ? num / den : 0;
}

/**
 * Average chroma of a mono signal: 12 bins, one per pitch class.
 * Pure — no Web Audio — so it is testable on its own.
 * @returns {Float64Array|null}
 */
export function chromaFromSamples(data, sr) {
  if (!data || data.length < WIN * 4) return null;

  // Hann window, and one Goertzel coefficient per semitone
  const win = new Float32Array(WIN);
  for (let i = 0; i < WIN; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (WIN - 1));

  const notes = [];
  for (let m = MIDI_LO; m <= MIDI_HI; m++) {
    const f = 440 * Math.pow(2, (m - 69) / 12);
    notes.push({
      pc: m % 12,
      coeff: 2 * Math.cos((2 * Math.PI * f) / sr),
      // lower octaves carry the harmony; taper the top so hats don't vote
      weight: 1 / (1 + Math.max(0, m - 60) / 24),
    });
  }

  const hop = Math.max(WIN, Math.round(HOP_SEC * sr));
  const total = Math.floor((data.length - WIN) / hop);
  if (total < 4) return null;
  const stride = Math.max(1, Math.ceil(total / MAX_FRAMES));

  const chroma = new Float64Array(12);
  let frames = 0;
  for (let f = 0; f < total; f += stride) {
    const start = f * hop;
    const frame = new Float64Array(12);
    let peak = 0;
    for (const n of notes) {
      const mag = Math.sqrt(goertzel(data, start, WIN, n.coeff, win)) * n.weight;
      frame[n.pc] += mag;
      if (mag > peak) peak = mag;
    }
    if (peak < 1e-6) continue;                      // silence: no vote
    for (let i = 0; i < 12; i++) chroma[i] += frame[i] / peak;   // per-frame normalise
    frames++;
  }
  return frames >= 4 ? chroma : null;
}

/**
 * Krumhansl-Schmuckler: correlate the chroma against all 24 profiles.
 * @returns {{pc:number, mode:'major'|'minor', confidence:number}|null}
 */
export function keyFromChroma(chroma) {
  if (!chroma) return null;
  let best = null;
  for (let pc = 0; pc < 12; pc++) {
    const rotated = new Float64Array(12);
    for (let i = 0; i < 12; i++) rotated[i] = chroma[(i + pc) % 12];
    const major = pearson(rotated, KS_MAJOR);
    const minor = pearson(rotated, KS_MINOR);
    const [score, mode] = major >= minor ? [major, 'major'] : [minor, 'minor'];
    if (!best || score > best.score) best = { pc, mode, score };
  }
  if (!best || best.score < 0.35) return null;      // too flat to call
  return { pc: best.pc, mode: best.mode, confidence: Math.min(1, best.score) };
}

/**
 * @returns {Promise<{pc:number, mode:'major'|'minor', confidence:number}|null>}
 *          pc = pitch class of the tonic, C = 0.
 */
export async function detectKey(buffer) {
  return keyFromChroma(chromaFromSamples(await monoLowRate(buffer), SR));
}
