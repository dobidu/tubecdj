// Crossfader curves and per-deck gain composition.

export const CURVE_NAMES = ['SMOOTH', 'MID', 'SHARP'];

/** @param {number} t 0..1 side amount @param {0|1|2} curve */
export function curveGain(t, curve) {
  if (curve === 0) return Math.sqrt(t);           // constant power
  if (curve === 1) return t;                      // linear
  return t < 0.1 ? 0 : 1;                         // sharp (cut) — ramped by setTargetAtTime
}

/** Crossfader gains for both decks. */
export function xfaderGains(x, curve) {
  return { A: curveGain(1 - x, curve), B: curveGain(x, curve) };
}

/** trim 0..1 -> 0..1.4 linear-ish gain, unity at .71 */
export const trimGain = (t) => t * 1.4;

/**
 * Final linear gain for one deck, YT mode (everything collapses into setVolume).
 * EQ has no makeup here — it does not exist in YT mode.
 */
export function deckGain({ trim, fader }, xfGain, master) {
  return Math.max(0, Math.min(1, trimGain(trim) * fader * xfGain * master));
}
