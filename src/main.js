// TubeCDJ bootstrap: builds the UI, owns the two players + audio graph,
// and runs the transport loop that keeps state, sound and pixels in step.

import {
  state, subscribe, emit, setDeck, setCh, saveSession, restoreSession,
  saveCues, cuesFor, saveBpm, bpmFor, LOOP_LENGTHS, FX_BEATS, MAX_QUEUE,
  trackKey, analysisFor, saveAnalysis, savePrefs,
} from './state.js';
import { h, clamp, toast, throttle } from './util.js';
import { DeckPlayer, PS } from './yt/player.js';
import { parseInput, fetchMeta, newItem, addToQueue, moveInQueue, shuffleQueue, removeFromQueue, nextIndex, renameInQueues } from './yt/queue.js';
import { MasterBus, ChannelStrip, LocalTrack, resumeAudio } from './audio/graph.js';
import { FXUnit } from './audio/fx.js';
import { Sampler } from './audio/sampler.js';
import { analyseFile } from './audio/analyser.js';
import { xfaderGains, deckGain } from './mix/crossfader.js';
import { deckRate, quantize, effectiveBpm } from './mix/sync.js';
import { createTopbar } from './ui/topbar.js';
import { createDeckCard, createDeckPanel } from './ui/deck.js';
import { createWaveRow } from './ui/waveform.js';
import { createMixer } from './ui/mixer.js';
import { createLoadScreen } from './ui/load.js';
import { applyVideo } from './video/blend.js';

const IDS = ['A', 'B'];
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const COLOR = { A: '#FF9E2C', B: '#35D0E0' };

const players = {};
const local = { A: null, B: null };
let audio = null;              // { master, ch, fx, sampler }
let sampler = null;

/* ------------------------------------------------------------------ audio */

function ensureAudio() {
  if (audio) return audio;
  const master = new MasterBus();
  const ch = { A: new ChannelStrip(master), B: new ChannelStrip(master) };
  const fx = new FXUnit(master.bus);
  ch.A.fxSend.connect(fx.input);
  ch.B.fxSend.connect(fx.input);
  sampler = new Sampler(master.bus);
  sampler.load().then(() => emit('sampler')).catch(() => toast('Sampler indisponível neste browser'));
  audio = { master, ch, fx };
  return audio;
}

/* ------------------------------------------------------- transport helpers */

const isLocal = (id) => state.deck[id].source === 'local' && !!local[id];

function tPlay(id) {
  if (isLocal(id)) { local[id].play(); players[id]?.play(); }
  else players[id]?.play();
  setDeck(id, { playing: true }, 'transport');
}
function tPause(id) {
  if (isLocal(id)) { local[id].pause(); players[id]?.pause(); }
  else players[id]?.pause();
  setDeck(id, { playing: false }, 'transport');
}
function tSeek(id, t) {
  const d = state.deck[id];
  const time = clamp(t, 0, Math.max(0, d.dur || t));
  if (isLocal(id)) { local[id].seek(time); players[id]?.seek(time); }
  else players[id]?.seek(time);
  setDeck(id, { pos: time }, 'transport');
}

/** Media-time seconds per beat (loops/cues live in media time, not heard time). */
const mediaSpb = (d) => (d.bpm > 0 ? 60 / d.bpm : 0);

function loopOut(d) {
  const spb = mediaSpb(d);
  return d.loop.inSec != null && spb ? d.loop.inSec + d.loop.len * spb : null;
}

function syncLocalLoop(id) {
  if (!isLocal(id)) return;
  const d = state.deck[id];
  const out = loopOut(d);
  if (d.loop.on && out != null) local[id].setLoop(d.loop.inSec, out);
  else local[id].setLoop(0, 0);
}

/* ------------------------------------------------------------ media loading */

async function loadVideo(id, videoId, { title, autoplay = false, startAt = 0 } = {}) {
  const p = players[id];
  const savedBpm = bpmFor(videoId);
  const savedCues = cuesFor(videoId);
  local[id]?.dispose();
  local[id] = null;
  setDeck(id, {
    videoId, title: title || videoId, source: 'yt', localName: null, peaks: null,
    waveKind: 'grid', pos: startAt, dur: 0, playing: autoplay,
    bpm: savedBpm || 0, bpmSource: savedBpm ? 'TAP' : '—',
    key: null, keyName: null,       // YouTube gives no PCM, so no key
    cues: savedCues || new Array(8).fill(null),
    loop: { on: false, inSec: null, len: state.deck[id].loop.len },
  }, 'load');
  p?.setMuted(false);
  p?.load(videoId, { start: startAt, autoplay });
  if (!title) {
    const meta = await fetchMeta(videoId);
    if (state.deck[id].videoId === videoId) setDeck(id, { title: meta.title }, 'load');
  }
  pushHistory(videoId, state.deck[id].title);
  saveSession();
}

/**
 * The player knows the real title once the video is cued, and that needs no
 * network call — so it beats oEmbed, which a content blocker can eat.
 * Only ever replaces a placeholder, never a title already on screen.
 */
function adoptPlayerTitle(id) {
  const p = players[id];
  const d = state.deck[id];
  if (!p?.ready || d.source === 'local' || !d.videoId) return;
  const title = (p.videoData()?.title || '').trim();
  if (!title || title === d.title) return;
  const placeholder = !d.title.trim() || d.title === '—' || d.title === d.videoId;
  if (!placeholder) return;
  setDeck(id, { title }, 'yt');
  renameInQueues(d.videoId, title);
  pushHistory(d.videoId, title);
  persist();
}

function pushHistory(videoId, title) {
  if (!videoId) return;
  state.history = [{ videoId, title, dur: 0 }, ...state.history.filter((i) => i.videoId !== videoId)].slice(0, 8);
  emit('history');
}

/**
 * Hidden player used only to expand playlists — reading a list must never
 * interrupt what a deck is playing.
 */
let scout = null;
async function playlistIds(listId) {
  if (!scout) {
    const box = h('<div style="position:fixed;left:-9999px;top:0;width:320px;height:180px;opacity:0;pointer-events:none"></div>');
    const mount = h('<div></div>');
    box.appendChild(mount);
    document.body.appendChild(box);
    scout = await new DeckPlayer(mount, {}).init();
    scout.setMuted(true);
    scout.setVolume(0);
  }
  scout.loadPlaylist(listId);
  return await new Promise((resolve) => {
    const t0 = performance.now();
    const poll = () => {
      const list = scout.playlistIds();
      if (list.length) return resolve(list);
      if (performance.now() - t0 > 6000) return resolve([]);
      setTimeout(poll, 200);
    };
    poll();
  });
}

/** Expand a playlist into a deck's queue. `mode`: 'auto' | 'queue' | 'now'. */
async function sendPlaylist(id, listId, mode) {
  toast('Lendo playlist…');
  const ids = await playlistIds(listId);
  if (!ids.length) { toast('Playlist vazia, privada ou indisponível'); return; }
  const slice = ids.slice(0, MAX_QUEUE);
  const firstNew = state.deck[id].queue.length;
  addToQueue(id, slice.map((v) => newItem(v)), { select: false });
  // titles in the background (staggered — noembed is a public endpoint)
  (async () => {
    for (const v of slice) {
      const meta = await fetchMeta(v);
      const d = state.deck[id];
      const idx = d.queue.findIndex((q) => q.videoId === v);
      if (idx >= 0 && meta.title !== v) {
        const queue = d.queue.slice();
        queue[idx] = { ...queue[idx], title: meta.title };
        setDeck(id, { queue }, 'queue');
      }
      await new Promise((r) => setTimeout(r, 70));
    }
  })();
  const idle = isDeckIdle(id);
  if (mode === 'now' || (mode === 'auto' && idle)) {
    const first = state.deck[id].queue.findIndex((q) => q.videoId === slice[0]);
    if (first >= 0) app.loadQueueItem(id, first);
    toast(`${slice.length} faixa(s) → deck ${id}, tocando a primeira`);
  } else {
    const added = state.deck[id].queue.length - firstNew;
    toast(`${added || slice.length} faixa(s) na fila do deck ${id}`);
  }
}

/** A deck is idle when it has nothing loaded or is not playing. */
const isDeckIdle = (id) => {
  const d = state.deck[id];
  return (!d.videoId && !isLocal(id)) || !d.playing;
};

/* ----------------------------------------------------------------- actions */

const tapTimes = [];

const app = {
  focusDeck(id) { if (state.focus !== id) { state.focus = id; emit('focus'); } },

  goScreen(screen) {
    state.screen = screen;
    document.getElementById('screen-booth').classList.toggle('hide', screen !== 'booth');
    document.getElementById('screen-load').classList.toggle('hide', screen !== 'load');
    emit('screen');
    if (screen === 'load') loadScreen.focusInput();
  },

  togglePlay(id) {
    resumeAudio();
    const d = state.deck[id];
    if (!d.videoId && !isLocal(id)) { toast('Deck ' + id + ' vazio'); return; }
    d.playing ? tPause(id) : tPlay(id);
  },

  cue(id) {
    const d = state.deck[id];
    const point = d.cues[0] ?? 0;
    tSeek(id, point);
    tPause(id);
  },

  seekFrac(id, frac) {
    const d = state.deck[id];
    if (!d.dur) return;
    tSeek(id, quantize(d, frac * d.dur));
  },

  seekTo(id, t) { tSeek(id, quantize(state.deck[id], t)); },
  nudge(id, delta) { tSeek(id, state.deck[id].pos + delta); },
  setBend(id, v) { setDeck(id, { bend: v }, 'bend'); },

  setPitch(id, v) {
    const patch = { pitch: v };
    if (state.deck[id].sync) patch.sync = false;   // touching pitch drops sync
    setDeck(id, patch, 'pitch');
    persist();
  },
  setPitchRange(id, range) {
    if (state.deck[id].pitchRange !== range) setDeck(id, { pitchRange: range }, 'pitch');
  },

  toggleSync(id) {
    const d = state.deck[id];
    if (!d.sync && d.source !== 'local') {
      toast('SYNC não funciona no Modo YT: o YouTube só muda a velocidade de 5% em 5%. Use Local Audio Mode.');
      return;
    }
    if (!d.sync && (!d.bpm || !state.masterBpm)) { toast('BPM desconhecido — use TAP ou solte um arquivo local'); return; }
    setDeck(id, { sync: !d.sync }, 'sync');
    persist();
  },
  toggleKeylock(id) {
    const d = state.deck[id];
    if (d.source !== 'local') { toast('Modo YT: key lock é sempre ON (o YouTube preserva o pitch)'); return; }
    setDeck(id, { keylock: !d.keylock }, 'keylock');
    if (!d.keylock) toast('Local Audio Mode não faz time-stretch: o pitch acompanha a velocidade');
  },
  toggleQuantize(id) { setDeck(id, { quantize: !state.deck[id].quantize }, 'quantize'); persist(); },
  togglePadMode(id) {
    setDeck(id, { padMode: state.deck[id].padMode === 'HOT CUE' ? 'BEAT LOOP' : 'HOT CUE' }, 'padmode');
    persist();
  },

  pad(id, i, shift) {
    const d = state.deck[id];
    if (d.padMode === 'HOT CUE') {
      const cues = d.cues.slice();
      if (shift) cues[i] = null;
      else if (cues[i] == null) cues[i] = quantize(d, d.pos);
      else { tSeek(id, cues[i]); return; }
      setDeck(id, { cues }, 'cues');
      saveCues(d.videoId, cues);
      persist();
    } else {
      const len = LOOP_LENGTHS[i];
      if (!d.bpm) { toast('Beat loop precisa de BPM — use TAP'); return; }
      setDeck(id, { loop: { on: true, inSec: quantize(d, d.pos), len } }, 'loop');
      syncLocalLoop(id);
      persist();
    }
  },

  toggleLoop(id) {
    const d = state.deck[id];
    if (!d.loop.on && !d.bpm) { toast('Loop precisa de BPM — use TAP'); return; }
    const loop = d.loop.on
      ? { ...d.loop, on: false }
      : { on: true, inSec: quantize(d, d.pos), len: d.loop.len };
    setDeck(id, { loop }, 'loop');
    syncLocalLoop(id);
    persist();
  },
  loopScale(id, mul) {
    const d = state.deck[id];
    const len = clamp(d.loop.len * mul, 0.25, 32);
    setDeck(id, { loop: { ...d.loop, len } }, 'loop');
    syncLocalLoop(id);
    persist();
  },

  loadQueueItem(id, index) {
    const d = state.deck[id];
    const item = d.queue[index];
    if (!item) return;
    setDeck(id, { queueIndex: index }, 'queue');
    loadVideo(id, item.videoId, { title: item.title, autoplay: d.playing });
  },
  shuffle(id) { shuffleQueue(id); },
  moveItem(id, from, to) { moveInQueue(id, from, to); },
  removeItem(id, i) { removeFromQueue(id, i); },

  setKnob(id, key, v) {
    setCh(id, key, v);
    persist();
  },
  setFader(id, v) { setCh(id, 'fader', v); persist(); },
  setXfader(v) { state.xfader = v; emit('xfader'); persist(); },
  setCurve(i) { state.curve = i; emit('curve'); persist(); },
  setMaster(v) { state.master = v; emit('master'); persist(); },
  toggleLimiter() { state.limiter = !state.limiter; emit('limiter'); persist(); },
  setBlend(i) { state.blend = i; emit('blend'); persist(); },

  setFx(patch) { Object.assign(state.fx, patch); emit('fx'); persist(); },
  toggleFx() {
    resumeAudio();
    ensureAudio();
    state.fx.on = !state.fx.on;
    emit('fx');
    persist();
  },

  /** Drop a file on a sampler pad to replace that slot. */
  async loadSample(i, file) {
    ensureAudio();
    await resumeAudio();
    if (!sampler) { toast('Sampler carregando…'); return; }
    try {
      const name = await sampler.loadFile(i, file);
      emit('sampler');
      toast(`Sampler ${i + 1}: ${name}`);
    } catch {
      toast('Não foi possível decodificar ' + file.name);
    }
  },

  async clearSample(i) {
    if (!sampler?.isCustom(i)) return;
    await sampler.clear(i);
    if (state.sampler === i) state.sampler = -1;
    emit('sampler');
    toast(`Sampler ${i + 1}: som padrão restaurado`);
  },

  samplerLabel: (i) => sampler?.labelFor(i) ?? null,
  samplerIsCustom: (i) => !!sampler?.isCustom(i),

  sampler(i) {
    resumeAudio();
    ensureAudio();
    if (!sampler?.buffers) { toast('Sampler carregando…'); return; }
    if (state.sampler === i) { sampler.stop(i); state.sampler = -1; }
    else { sampler.trigger(i); state.sampler = i; setTimeout(() => { if (state.sampler === i && !sampler.isRinging(i)) { state.sampler = -1; emit('sampler'); } }, 400); }
    emit('sampler');
  },

  tap() {
    const now = performance.now();
    if (tapTimes.length && now - tapTimes[tapTimes.length - 1] > 2200) tapTimes.length = 0;
    tapTimes.push(now);
    if (tapTimes.length > 5) tapTimes.shift();
    if (tapTimes.length < 2) { toast('Continue tocando no tempo…'); return; }
    const gaps = [];
    for (let i = 1; i < tapTimes.length; i++) gaps.push(tapTimes[i] - tapTimes[i - 1]);
    const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    const bpm = Math.round(clamp(60000 / avg, 60, 200) * 10) / 10;
    state.masterBpm = bpm;

    // Tapping is how a DJ *corrects* a tempo, so it always writes to the
    // focused deck — refusing to overwrite an existing value made a wrong
    // BPM impossible to fix.
    const id = state.focus;
    const d = state.deck[id];
    setDeck(id, { bpm, bpmSource: 'TAP' }, 'bpm');
    saveBpm(d.videoId, bpm);
    toast(`Deck ${id}: ${bpm.toFixed(1)} BPM · ${tapTimes.length} toques`);
    emit('bpm');
    persist();
  },

  /**
   * Send a URL/ID to a deck. Default never cuts a playing deck:
   *   'auto'  — enqueue, and load only if the deck is empty or stopped
   *   'queue' — enqueue only
   *   'now'   — load immediately
   */
  async send(text, deckId, mode = 'auto') {
    const p = parseInput(text);
    if (p.kind === 'none') { toast('URL ou ID não reconhecido'); return; }
    if (state.screen !== 'booth') app.goScreen('booth');
    app.focusDeck(deckId);
    if (p.kind === 'playlist') { await sendPlaylist(deckId, p.listId, mode); return; }

    const meta = await fetchMeta(p.videoId);
    addToQueue(deckId, [newItem(p.videoId, meta.title)]);
    const idx = state.deck[deckId].queue.findIndex((q) => q.videoId === p.videoId);
    const loadNow = mode === 'now' || (mode === 'auto' && isDeckIdle(deckId));
    if (loadNow && idx >= 0) {
      app.loadQueueItem(deckId, idx);
      toast(`Deck ${deckId}: ${meta.title}`);
    } else {
      toast(`Fila ${deckId} · ${state.deck[deckId].queue.length} faixa(s) · ${meta.title}`);
    }
    if (p.listId) sendPlaylist(deckId, p.listId, 'queue');
  },

  async dropFile(id, file) {
    ensureAudio();
    await resumeAudio();
    const cacheId = trackKey(file);
    const cached = analysisFor(cacheId);
    toast(cached ? `Carregando ${file.name}…` : `Analisando ${file.name}… (BPM e key)`);
    let result;
    try { result = await analyseFile(file, { skipAnalysis: !!cached }); }
    catch { toast('Não foi possível decodificar ' + file.name); return; }

    const { buffer, peaks } = result;
    const bpm = cached ? cached.bpm : result.bpm;
    const key = cached ? cached.key : result.key;
    if (!cached) saveAnalysis(cacheId, { bpm, key: key ? { camelot: key.camelot, name: key.name } : null });

    local[id]?.dispose();
    local[id] = new LocalTrack(buffer, audio.ch[id].input);
    players[id]?.setMuted(true);
    setDeck(id, {
      source: 'local', localName: file.name,
      title: file.name.replace(/\.[^.]+$/, ''),
      peaks, waveKind: 'audio',
      bpm: bpm || state.deck[id].bpm, bpmSource: bpm ? 'AUTO' : state.deck[id].bpmSource,
      key: key?.camelot ?? null, keyName: key?.name ?? null,
      dur: buffer.duration, pos: 0, playing: false,
      loop: { on: false, inSec: null, len: state.deck[id].loop.len },
    }, 'local');

    const parts = [bpm ? `${bpm} BPM` : 'BPM não detectado — use TAP'];
    if (key?.camelot) parts.push(`${key.camelot} (${key.name})`);
    toast(`${file.name}: ${parts.join(' · ')}`);
  },

  setPref(patch) {
    Object.assign(state.prefs, patch);
    if (patch.pitchRange) for (const id of IDS) setDeck(id, { pitchRange: patch.pitchRange }, 'pitch');
    emit('prefs');
    savePrefs();
  },

  toggleAutoNext(id) {
    setDeck(id, { autoNext: !state.deck[id].autoNext }, 'autonext');
    persist();
  },
};

/* --------------------------------------------------------------------- UI */

const topbar = createTopbar({ app });
document.getElementById('topbar').appendChild(topbar.el);

const booth = document.getElementById('screen-booth');
booth.className = 'screen';
const decksRow = h('<div class="decks"></div>');
const wavesBlock = h('<div class="card waves"></div>');
const panelsRow = h('<div class="panels"></div>');
booth.append(decksRow, wavesBlock, panelsRow);

const cards = {}, waveRows = {}, panels = {};
for (const id of IDS) {
  cards[id] = createDeckCard({ deckId: id, color: COLOR[id], app });
  decksRow.appendChild(cards[id].el);
  waveRows[id] = createWaveRow({ deckId: id, color: COLOR[id], app });
  wavesBlock.appendChild(waveRows[id].el);
  panels[id] = createDeckPanel({ deckId: id, color: COLOR[id], app });
}
const mixer = createMixer({ app });
panelsRow.append(panels.A.el, mixer.el, panels.B.el);

const loadScreen = createLoadScreen({ app });
document.getElementById('screen-load').appendChild(loadScreen.el);

/* ------------------------------------------------------------- transport */

const persist = throttle(saveSession, 900);
const setVol = { A: throttle((v) => players.A?.setVolume(v), 50), B: throttle((v) => players.B?.setVolume(v), 50) };

function applyMix() {
  const xg = xfaderGains(state.xfader, state.curve);
  for (const id of IDS) {
    const chs = state.ch[id];
    if (isLocal(id) && audio) {
      const strip = audio.ch[id];
      strip.setTrim(chs.trim);
      strip.setEq(chs.hi, chs.mid, chs.low);
      strip.setFilter(chs.filter);
      strip.setFader(chs.fader);
      // SHARP is a cut, not a fade — its ramp is a preference, in ms
      strip.setXf(xg[id], state.curve === 2 ? state.prefs.sharpRamp / 1000 : undefined);
      strip.setFxSend(fxSendFor(id));
      setVol[id](0);
    } else {
      setVol[id](deckGain(chs, xg[id], state.master));
    }
  }
  if (audio) {
    audio.master.setMaster(state.master);
    audio.master.setLimiter(state.limiter);
    const ref = state.fx.target === 'MST' ? state.deck[state.focus] : state.deck[state.fx.target];
    const bpm = effectiveBpm(ref, state.masterBpm) || state.masterBpm;
    audio.fx.setType(state.fx.type);
    audio.fx.setParams(FX_BEATS[state.fx.beats] * (60 / bpm), state.fx.depth);
    audio.fx.setWet(state.fx.on ? state.fx.depth : 0);
  }
}

function fxSendFor(id) {
  if (!state.fx.on) return 0;
  return state.fx.target === 'MST' || state.fx.target === id ? 1 : 0;
}

function levelFor(id) {
  const d = state.deck[id];
  if (isLocal(id) && audio) return audio.ch[id].level();
  if (!d.playing) return 0;
  const xg = xfaderGains(state.xfader, state.curve)[id];
  const g = deckGain(state.ch[id], xg, state.master);
  return clamp(g * (0.62 + 0.32 * Math.abs(Math.sin(d.pos * 2.3))));
}

let lastFrame = performance.now();

function tick() {
  const now = performance.now();
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;

  for (const id of IDS) {
    const d = state.deck[id];
    const p = players[id];
    const rate = deckRate(d, state.masterBpm);

    if (isLocal(id)) {
      const tr = local[id];
      d.pos = tr.pos;
      d.dur = tr.duration;
      tr.setRate(rate);
      d.rateApplied = rate;      // Web Audio honours any rate
      d.rateInert = false;
      p?.setRate(rate);
      if (d.playing && d.pos >= d.dur - 0.05) autoAdvance(id);
    } else if (p?.ready) {
      d.pos = p.time;
      const dur = p.duration;
      if (dur) d.dur = dur;
      p.setRate(rate);
      // YouTube quantizes the rate, so record what it really did
      d.rateApplied = p.snapRate(rate);
      d.rateInert = Math.abs(d.rateApplied - rate) > 0.002;
      const out = loopOut(d);
      if (d.loop.on && out != null && d.pos >= out) p.seek(d.loop.inSec);
    }
    if (d.playing && !reduceMotion.matches) d.jogAngle = (d.jogAngle + 200 * rate * dt) % 360;
  }

  applyMix();
  applyVideo({ A: cards.A.stage, B: cards.B.stage }, state, state.prefs.videoFloor);

  const levels = { A: levelFor('A'), B: levelFor('B') };
  for (const id of IDS) { cards[id].update(); waveRows[id].update(); panels[id].update(); }
  mixer.update(levels);
  topbar.update();

  requestAnimationFrame(tick);
}

function autoAdvance(id) {
  const d = state.deck[id];
  if (d.loop.on) return;
  if (!d.autoNext) { tPause(id); return; }

  // A scripted playVideo() counts as an automatic playback, and YouTube's
  // Required Minimum Functionality forbids more than one player auto-playing
  // at the same time. Loading the next track is fine; starting it is not,
  // while the other deck is running.
  const other = state.deck[id === 'A' ? 'B' : 'A'];
  const otherBusy = other.playing;
  const next = nextIndex(id);
  if (next < 0 || d.queue.length < 2) { tPause(id); return; }
  const wasPlaying = d.playing;
  app.loadQueueItem(id, next);
  if (wasPlaying && !otherBusy) setTimeout(() => tPlay(id), 400);
  else if (wasPlaying) toast(`Deck ${id}: próxima faixa carregada e em espera (o outro deck está tocando)`);
}

/* ------------------------------------------------------------- keyboard */

const KEY_ACTIONS = {
  q: () => app.togglePlay('A'),
  p: () => app.togglePlay('B'),
  w: () => app.cue('A'),
  o: () => app.cue('B'),
  l: () => app.toggleLoop(state.focus),
  f: () => app.toggleFx(),
};

window.addEventListener('keydown', (e) => {
  const tag = e.target?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || e.metaKey || e.ctrlKey) return;
  const k = e.key.toLowerCase();
  const f = state.focus;

  // a focused control owns Enter/Space — don't double-fire a shortcut on it
  if (tag === 'BUTTON' && (k === ' ' || k === 'enter')) return;

  // Tab only swaps deck focus while nothing focusable is focused, so real
  // keyboard navigation still works once the user tabs into the console
  if (k === 'tab') {
    if (document.activeElement && document.activeElement !== document.body) return;
    e.preventDefault();
    app.focusDeck(f === 'A' ? 'B' : 'A');
    return;
  }
  if (k >= '1' && k <= '4') { e.preventDefault(); app.pad(f, Number(k) - 1, e.shiftKey); return; }
  if (k === 'arrowleft' || k === 'arrowright') {
    e.preventDefault();
    app.setXfader(clamp(state.xfader + (k === 'arrowleft' ? -0.05 : 0.05)));
    return;
  }
  if (k === 'arrowup' || k === 'arrowdown') {
    e.preventDefault();
    app.setFader(f, clamp(state.ch[f].fader + (k === 'arrowup' ? 0.05 : -0.05)));
    return;
  }
  if (k === ' ') { e.preventDefault(); app.togglePlay(f); return; }
  const fn = KEY_ACTIONS[k];
  if (fn) { e.preventDefault(); fn(); }
});

// ⌘V / Ctrl+V anywhere in the booth sends the clipboard to the focused deck.
window.addEventListener('paste', (e) => {
  const tag = e.target?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  if (state.screen !== 'booth') return;
  const text = e.clipboardData?.getData('text')?.trim();
  if (!text) return;
  e.preventDefault();
  app.send(text, state.focus, 'auto');
});

// the page itself must never navigate to a dropped link
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

window.addEventListener('pointerdown', () => resumeAudio(), { once: true });
window.addEventListener('keydown', () => resumeAudio(), { once: true });
window.addEventListener('beforeunload', saveSession);

subscribe((_, reason) => {
  if (reason === 'load' || reason === 'local' || reason === 'queue') persist();
  loadScreen.update();
});

/* ------------------------------------------------------------------- boot */

restoreSession();
app.goScreen(state.screen === 'load' ? 'load' : 'booth');
requestAnimationFrame(tick);

(async () => {
  for (const id of IDS) {
    try {
      players[id] = await new DeckPlayer(cards[id].mount, {
        onStateChange: (code) => {
          const d = state.deck[id];
          if (isLocal(id)) return;                 // local track owns transport
          if (code === PS.PLAYING) setDeck(id, { playing: true, buffering: false }, 'yt');
          else if (code === PS.BUFFERING) setDeck(id, { buffering: true }, 'yt');
          else if (code === PS.PAUSED || code === PS.ENDED) setDeck(id, { playing: false, buffering: false }, 'yt');
          else if (code === PS.CUED) {
            setDeck(id, { buffering: false }, 'yt');
            // cueVideoById/loadVideoById reset the rate to 1
            players[id].setRate(deckRate(state.deck[id], state.masterBpm));
          }
          if (code === PS.CUED || code === PS.PLAYING || code === PS.BUFFERING) adoptPlayerTitle(id);
        },
        onEnded: () => autoAdvance(id),
        onAutoplayBlocked: () => {
          setDeck(id, { playing: false }, 'yt');
          toast(`Deck ${id}: o navegador bloqueou a reprodução automática — aperte PLAY`);
        },
        onError: (code) => toast(`Deck ${id}: vídeo indisponível (erro ${code})`),
      }).init();
    } catch (err) {
      toast('IFrame API indisponível: ' + err.message);
      return;
    }
  }
  // restore decks paused at their saved position
  for (const id of IDS) {
    const d = state.deck[id];
    if (d.videoId) {
      players[id].load(d.videoId, { start: d.pos, autoplay: false });
      players[id].setVolume(0);
    }
  }
})();
