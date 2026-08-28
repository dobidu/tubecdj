// Camelot wheel: notation, and which keys mix cleanly with which.

const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/**
 * Camelot code for a tonic pitch class + mode.
 * Moving a fifth up moves one step round the wheel, so the number is linear
 * in the circle of fifths: C major = 8B, A minor = 8A.
 */
export function camelot(pc, mode) {
  if (pc == null) return null;
  const n = mode === 'minor' ? ((4 + 7 * pc) % 12) + 1 : ((7 + 7 * pc) % 12) + 1;
  return n + (mode === 'minor' ? 'A' : 'B');
}

export const keyName = (pc, mode) => (pc == null ? null : NOTES[pc] + (mode === 'minor' ? 'm' : ''));

/** Split "8A" into { n: 8, letter: 'A' }; null if it isn't a Camelot code. */
export function parseCamelot(code) {
  const m = /^(\d{1,2})([AB])$/.exec(code || '');
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= 12 ? { n, letter: m[2] } : null;
}

const wrap = (n) => ((n - 1 + 12) % 12) + 1;

/**
 * Classic harmonic-mixing rules: same key, relative major/minor (same number),
 * or one step round the wheel in the same letter.
 * @returns {{ok:boolean, label:string}|null}
 */
export function relation(a, b) {
  const x = parseCamelot(a), y = parseCamelot(b);
  if (!x || !y) return null;
  if (x.n === y.n && x.letter === y.letter) return { ok: true, label: 'mesma key' };
  if (x.n === y.n) return { ok: true, label: 'relativa' };
  if (x.letter === y.letter && (y.n === wrap(x.n + 1) || y.n === wrap(x.n - 1))) {
    return { ok: true, label: y.n === wrap(x.n + 1) ? '+1 na roda' : '-1 na roda' };
  }
  const dist = Math.min(wrap(y.n - x.n + 1) - 1, wrap(x.n - y.n + 1) - 1);
  return { ok: false, label: x.letter === y.letter ? `${dist} passos` : 'sem relação' };
}

export const compatible = (a, b) => relation(a, b)?.ok === true;
