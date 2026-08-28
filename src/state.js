// Single store + observer. UI modules subscribe and patch their own nodes;
// nothing here touches the DOM.

const PREFIX = 'tubecdj:';

export const CURVES = ['SMOOTH', 'MID', 'SHARP'];
export const BLENDS = ['NORMAL', 'ADD', 'DIFF', 'LUMA'];
export const FX_TYPES = ['ECHO', 'REVERB', 'FLANGER', 'FILTER'];
export const FX_BEATS = [1 / 8, 1 / 4, 1 / 2, 1, 2];
export const FX_BEAT_LABELS = ['1/8', '1/4', '1/2', '1', '2'];
export const FX_TARGETS = ['A', 'B', 'MST'];
export const LOOP_LENGTHS = [0.25, 0.5, 1, 2, 4, 8, 16, 32];
export const KNOBS = [
  { key: 'trim', label: 'TRIM' },
  { key: 'hi', label: 'HI' },
  { key: 'mid', label: 'MID' },
  { key: 'low', label: 'LOW' },
  { key: 'filter', label: 'FILTER' },
];
export const SAMPLERS = ['AIR HORN', 'VINYL BRK', 'SIREN', 'CLAP'];
export const MAX_QUEUE = 50;

const deck = (id) => ({
  id,
  videoId: null,
  title: '—',
  source: 'yt',          // 'yt' | 'local'
  localName: null,
  queue: [],             // [{ videoId, title, dur, bpm, key }]
  queueIndex: -1,
  playing: false,
  buffering: false,
  pos: 0,
  dur: 0,
  bpm: 0,                // base BPM of the track (0 = unknown)
  bpmSource: '—',        // 'TAP' | 'AUTO' | '—'
  pitch: 0.5,            // 0..1, .5 = 0%
  pitchRange: 8,         // ±%
  key: null,             // Camelot code ('8A') — local audio only, null = unknown
  keyName: null,         // 'Am', 'F#' …
  autoNext: true,        // advance to the next queue item at the end of the track
  sync: false,
  keylock: true,         // YT mode: locked ON
  quantize: true,
  padMode: 'HOT CUE',
  cues: new Array(8).fill(null),   // seconds or null
  loop: { on: false, inSec: null, len: 4 },
  bend: 0,               // temporary rate offset from jog
  jogAngle: 0,
  peaks: null,           // Float32Array (local mode) or null
  waveKind: 'grid',      // 'grid' | 'audio'
  ready: false,
});

const channel = () => ({ trim: 0.62, hi: 0.5, mid: 0.5, low: 0.5, filter: 0.5, fader: 0.85 });

export const state = {
  screen: 'booth',
  focus: 'A',
  master: 0.82,
  masterBpm: 126,
  limiter: true,
  xfader: 0.5,
  curve: 0,
  blend: 0,
  fx: { type: 0, target: 'MST', beats: 3, depth: 0.45, on: false },
  sampler: -1,
  prefs: {
    videoFloor: 0.22,    // opacity a fully faded-out deck keeps
    pitchRange: 8,       // default ± for both decks
    sharpRamp: 20,       // ms ramp on the SHARP crossfader cut
  },
  deck: { A: deck('A'), B: deck('B') },
  ch: { A: channel(), B: channel() },
  history: [],  // recently loaded [{videoId,title,thumb,dur}]
};

const subs = new Set();
export const subscribe = (fn) => { subs.add(fn); return () => subs.delete(fn); };
export function emit(reason = '') { for (const fn of subs) fn(state, reason); }

export function setDeck(id, patch, reason = 'deck') {
  Object.assign(state.deck[id], typeof patch === 'function' ? patch(state.deck[id]) : patch);
  emit(reason);
}
export function setCh(id, key, value) {
  state.ch[id][key] = value;
  emit('ch');
}

/* ---------------- persistence (localStorage, tubecdj: prefix) ---------------- */

const read = (k, fb) => {
  try { const v = localStorage.getItem(PREFIX + k); return v == null ? fb : JSON.parse(v); }
  catch { return fb; }
};
const write = (k, v) => { try { localStorage.setItem(PREFIX + k, JSON.stringify(v)); } catch { /* quota */ } };
const clampNum = (v, lo, hi, fb) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : fb);

export const cuesFor = (videoId) => (videoId ? read('cues:' + videoId, null) : null);
export const saveCues = (videoId, cues) => { if (videoId) write('cues:' + videoId, cues); };
export const bpmFor = (videoId) => (videoId ? read('bpm:' + videoId, null) : null);
export const saveBpm = (videoId, bpm) => { if (videoId) write('bpm:' + videoId, bpm); };

/** Analysis of a local file, keyed by name+size so a re-drop is instant. */
export const trackKey = (file) => `local:${file.name}:${file.size}`;
export const analysisFor = (id) => (id ? read('an:' + id, null) : null);
export const saveAnalysis = (id, data) => { if (id) write('an:' + id, data); };

export function savePrefs() { write('prefs', state.prefs); }

export function saveSession() {
  write('mixer', {
    master: state.master, masterBpm: state.masterBpm, limiter: state.limiter,
    xfader: state.xfader, curve: state.curve, blend: state.blend,
    fx: state.fx, ch: state.ch,
  });
  for (const id of ['A', 'B']) {
    const d = state.deck[id];
    write('deck:' + id, {
      videoId: d.videoId, title: d.title, queue: d.queue, queueIndex: d.queueIndex,
      pos: d.pos, bpm: d.bpm, bpmSource: d.bpmSource, pitch: d.pitch, pitchRange: d.pitchRange,
      sync: d.sync, quantize: d.quantize, padMode: d.padMode, cues: d.cues, loop: d.loop,
      autoNext: d.autoNext,
    });
  }
  write('history', state.history.slice(0, 8));
  savePrefs();
}

export function restoreSession() {
  const p = read('prefs', null);
  if (p) {
    state.prefs.videoFloor = clampNum(p.videoFloor, 0, 0.6, state.prefs.videoFloor);
    state.prefs.pitchRange = p.pitchRange === 16 ? 16 : 8;
    state.prefs.sharpRamp = clampNum(p.sharpRamp, 0, 200, state.prefs.sharpRamp);
  }
  const m = read('mixer', null);
  if (m) {
    state.master = m.master ?? state.master;
    state.masterBpm = m.masterBpm ?? state.masterBpm;
    state.limiter = m.limiter ?? state.limiter;
    state.xfader = m.xfader ?? state.xfader;
    state.curve = m.curve ?? state.curve;
    state.blend = m.blend ?? state.blend;
    if (m.fx) Object.assign(state.fx, m.fx);
    if (m.ch) { Object.assign(state.ch.A, m.ch.A || {}); Object.assign(state.ch.B, m.ch.B || {}); }
  }
  for (const id of ['A', 'B']) {
    const s = read('deck:' + id, null);
    if (!s) continue;
    const d = state.deck[id];
    Object.assign(d, {
      videoId: s.videoId ?? null, title: s.title ?? '—',
      queue: Array.isArray(s.queue) ? s.queue.slice(0, MAX_QUEUE) : [],
      queueIndex: s.queueIndex ?? -1,
      pos: s.pos ?? 0, bpm: s.bpm ?? 0, bpmSource: s.bpmSource ?? '—',
      pitch: s.pitch ?? 0.5, pitchRange: s.pitchRange ?? state.prefs.pitchRange,
      sync: !!s.sync, quantize: s.quantize !== false, autoNext: s.autoNext !== false,
      padMode: s.padMode === 'BEAT LOOP' ? 'BEAT LOOP' : 'HOT CUE',
      cues: Array.isArray(s.cues) && s.cues.length === 8 ? s.cues : new Array(8).fill(null),
      loop: s.loop && typeof s.loop === 'object' ? { on: false, inSec: s.loop.inSec ?? null, len: s.loop.len ?? 4 } : { on: false, inSec: null, len: 4 },
    });
    const savedCues = cuesFor(d.videoId);
    if (savedCues) d.cues = savedCues;
  }
  state.history = read('history', []);
}
