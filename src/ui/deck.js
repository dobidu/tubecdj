// Deck strip card (player + queue) and deck control panel (jog, transport, pads).

import { h, fmt } from '../util.js';
import { state } from '../state.js';
import { createQueue } from './queue.js';
import { createJog } from './jog.js';
import { createPads } from './pads.js';
import { createPitchFader } from './fader.js';
import { pitchPercent, effectiveBpm } from '../mix/sync.js';
import { relation } from '../mix/harmony.js';
import { thumbUrl } from '../yt/queue.js';
import { blendName } from '../video/blend.js';

const AUDIO_RE = /^audio\//;

export function createDeckCard({ deckId, color, app }) {
  const el = h(`
    <div class="card deck-card" style="--c:${color}">
      <div class="deck-main">
        <div class="deck-head">
          <div class="deck-tag">${deckId}</div>
          <div class="dot" title="Estado do deck"></div>
          <div class="deck-title">—</div>
          <div class="badge key hide"></div>
          <div class="badge time mono">0:00 / 0:00</div>
          <div class="badge blend">BLEND · NORMAL</div>
          <div class="badge src">YT</div>
          <div class="badge res">1080p</div>
        </div>
        <div class="deck-video">
          <div class="stage"><div class="yt-mount"></div></div>
          <button type="button" class="facade hide">
            <span class="cap"></span>
            <span class="go"><i></i></span>
            <span class="hint">tocar</span>
          </button>
          <div class="empty">
            <div class="k">DECK ${deckId} · SEM MÍDIA</div>
            <div class="v">Cole uma URL em “Carregar mídia” ou solte um MP3/WAV aqui</div>
          </div>
        </div>
      </div>
    </div>`);

  const queue = createQueue({ deckId, color, app });
  el.appendChild(queue.el);

  const video = el.querySelector('.deck-video');
  const stage = el.querySelector('.stage');
  const mount = el.querySelector('.yt-mount');
  const empty = el.querySelector('.empty');
  const facade = el.querySelector('.facade');
  const facadeCap = facade.querySelector('.cap');
  const titleEl = el.querySelector('.deck-title');
  const srcEl = el.querySelector('.badge.src');
  const keyEl = el.querySelector('.badge.key');
  const dot = el.querySelector('.dot');
  const timeEl = el.querySelector('.badge.time');
  const blendEl = el.querySelector('.badge.blend');

  video.addEventListener('dragover', (e) => {
    e.preventDefault();
    video.classList.add('drop');
  });
  video.addEventListener('dragleave', () => video.classList.remove('drop'));
  video.addEventListener('drop', (e) => {
    e.preventDefault();
    video.classList.remove('drop');
    const file = [...(e.dataTransfer.files || [])].find((f) => AUDIO_RE.test(f.type) || /\.(mp3|wav|m4a|flac|ogg)$/i.test(f.name));
    if (file) { app.dropFile(deckId, file); return; }
    const text = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
    if (text) app.send(text, deckId, 'now');   // dropped on the player = play it here
  });
  video.addEventListener('click', () => app.focusDeck(deckId));
  facade.addEventListener('click', () => { app.focusDeck(deckId); app.togglePlay(deckId); });

  function update() {
    const d = state.deck[deckId];
    if (titleEl.textContent !== d.title) { titleEl.textContent = d.title; titleEl.title = d.title; }
    const other = state.deck[deckId === 'A' ? 'B' : 'A'];
    keyEl.classList.toggle('hide', !d.key);
    if (d.key) {
      const rel = relation(d.key, other.key);
      const label = d.keyName ? `${d.key} · ${d.keyName}` : d.key;
      if (keyEl.textContent !== label) keyEl.textContent = label;
      keyEl.classList.toggle('harmonic', !!rel?.ok);
      keyEl.title = rel
        ? `${rel.ok ? 'Mistura harmônica com' : 'Fora da roda em relação a'} ${other.key} (${rel.label})`
        : 'Key detectada no áudio local';
    }
    const src = d.source === 'local' ? 'LOCAL AUDIO' : 'YT';
    if (srcEl.textContent !== src) srcEl.textContent = src;
    srcEl.style.color = d.source === 'local' ? color : '';
    dot.classList.toggle('live', d.playing && !d.buffering);
    dot.classList.toggle('buffering', !!d.buffering);
    const t = `${fmt(d.pos)} / ${fmt(d.dur)}`;
    if (timeEl.textContent !== t) timeEl.textContent = t;
    const b = 'BLEND · ' + blendName(state.blend);
    if (blendEl.textContent !== b) blendEl.textContent = b;
    empty.classList.toggle('hide', !!d.videoId || d.source === 'local');

    // Until the first play there is no iframe at all, so our own cover is not
    // an overlay on a player — it is the page. This is the only compliant way
    // to avoid the branded cued state, and it saves loading the 1.6 MB player.
    const cued = !!d.videoId && d.source !== 'local' && !app.hasPlayer(deckId);
    facade.classList.toggle('hide', !cued);
    if (cued) {
      const url = thumbUrl(d.videoId);
      if (facadeCap.dataset.src !== url) {
        facadeCap.style.backgroundImage = `url("${url}")`;
        facadeCap.dataset.src = url;
      }
      facade.title = `Tocar ${d.title}`;
    }

    queue.update();
  }
  update();
  return { el, update, mount, stage };
}

export function createDeckPanel({ deckId, color, app }) {
  const mirror = deckId === 'B' ? ' mirror' : '';
  const el = h(`
    <div class="card deck-panel${mirror}" style="--c:${color}">
      <div class="side">
        <button type="button" class="btn-v sync" style="--b-c:${color}" aria-pressed="false">SYNC</button>
        <button type="button" class="btn-v keylock" style="--b-c:var(--accent-loop)" aria-pressed="true">KEY<br />LOCK</button>
        <button type="button" class="btn-v quant" style="--b-c:var(--text-3)" aria-pressed="true">QUANT</button>
        <div class="pitch-wrap">
          <div class="pitch-slot"></div>
          <div class="pitch-val">+0.00%</div>
          <div class="lbl-s pitch-range">PITCH ±8%</div>
        </div>
      </div>
      <div class="center">
        <div class="jog-slot"></div>
        <div class="transport">
          <button type="button" class="cue-btn" title="Volta ao cue e pausa">CUE</button>
          <button type="button" class="play-btn" aria-pressed="false">PLAY</button>
        </div>
        <div class="looprow">
          <button type="button" class="mode" title="Alterna a função dos pads">MODE · HOT CUE</button>
          <button type="button" class="step half" title="Metade do loop" aria-label="Metade do loop">÷2</button>
          <div class="len" aria-live="off">4 BT</div>
          <button type="button" class="step double" title="Dobra o loop" aria-label="Dobra o loop">×2</button>
          <button type="button" class="loop" aria-pressed="false">LOOP</button>
        </div>
        <div class="pads-slot"></div>
      </div>
    </div>`);

  const jog = createJog({ deckId, color, app });
  el.querySelector('.jog-slot').replaceWith(jog.el);
  const pads = createPads({ deckId, app });
  el.querySelector('.pads-slot').replaceWith(pads.el);
  const pitch = createPitchFader({
    label: `Pitch do deck ${deckId}`,
    get: () => state.deck[deckId].pitch,
    set: (v) => app.setPitch(deckId, v),
    onShiftRange: (shift) => app.setPitchRange(deckId, shift ? 16 : 8),
  });
  el.querySelector('.pitch-slot').replaceWith(pitch.el);

  const syncEl = el.querySelector('.sync');
  const keyEl = el.querySelector('.keylock');
  const quantEl = el.querySelector('.quant');
  const pitchWrap = el.querySelector('.pitch-wrap');
  const pitchVal = el.querySelector('.pitch-val');
  const pitchRange = el.querySelector('.pitch-range');
  const playEl = el.querySelector('.play-btn');
  const cueEl = el.querySelector('.cue-btn');
  const modeEl = el.querySelector('.mode');
  const lenEl = el.querySelector('.len');
  const loopEl = el.querySelector('.loop');

  syncEl.addEventListener('click', () => app.toggleSync(deckId));
  keyEl.addEventListener('click', () => app.toggleKeylock(deckId));
  quantEl.addEventListener('click', () => app.toggleQuantize(deckId));
  playEl.addEventListener('click', () => app.togglePlay(deckId));
  cueEl.addEventListener('click', () => app.cue(deckId));
  modeEl.addEventListener('click', () => app.togglePadMode(deckId));
  loopEl.addEventListener('click', () => app.toggleLoop(deckId));
  el.querySelector('.half').addEventListener('click', () => app.loopScale(deckId, 0.5));
  el.querySelector('.double').addEventListener('click', () => app.loopScale(deckId, 2));
  el.addEventListener('pointerdown', () => app.focusDeck(deckId));

  function update() {
    const d = state.deck[deckId];
    el.classList.toggle('focus', state.focus === deckId);
    syncEl.classList.toggle('on', d.sync);
    syncEl.setAttribute('aria-pressed', d.sync ? 'true' : 'false');
    const syncDead = d.source !== 'local';
    syncEl.classList.toggle('inert', syncDead);
    syncEl.title = syncDead
      ? 'Indisponível no Modo YT: casar BPM exige velocidade contínua, e o YouTube só anda de 5% em 5%. Use Local Audio Mode.'
      : d.bpm > 0 ? 'Casar BPM com o master' : 'BPM desconhecido — use TAP';
    keyEl.classList.toggle('on', d.keylock);
    keyEl.setAttribute('aria-pressed', d.keylock ? 'true' : 'false');
    keyEl.classList.toggle('locked', d.source !== 'local');
    keyEl.title = d.source === 'local'
      ? 'Key lock (Local Audio Mode ainda não faz time-stretch: o pitch acompanha a velocidade)'
      : 'Travado em ON: o YouTube já preserva o pitch ao mudar a velocidade';
    quantEl.classList.toggle('on', d.quantize);
    quantEl.setAttribute('aria-pressed', d.quantize ? 'true' : 'false');

    // YouTube rounds any unsupported rate toward 1, so a DJ-sized pitch move
    // has no effect at all there. Say so instead of showing a percentage the
    // player silently ignores.
    const ytRate = d.source !== 'local';
    const pct = pitchPercent(d);
    const label = (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%';
    const shown = ytRate ? `${d.rateApplied.toFixed(2)}×` : label;
    if (pitchVal.textContent !== shown) pitchVal.textContent = shown;
    const rl = ytRate ? 'YT · PASSO 5%' : `PITCH ±${d.pitchRange}%`;
    if (pitchRange.textContent !== rl) pitchRange.textContent = rl;
    pitchWrap.classList.toggle('inert', ytRate);
    pitchWrap.title = ytRate
      ? `Modo YT: o player quantiza a velocidade em degraus de 5% (…0.95, 1.00, 1.05…). Pedido ${label} → aplicado ${d.rateApplied.toFixed(2)}×. Pitch fino, e portanto beatmatching, só em Local Audio Mode.`
      : 'Pitch (Shift arrasta na faixa larga)';
    pitch.update(shown);

    playEl.classList.toggle('on', d.playing);
    playEl.setAttribute('aria-pressed', d.playing ? 'true' : 'false');
    const pl = d.playing ? 'PAUSE' : 'PLAY';
    if (playEl.textContent !== pl) playEl.textContent = pl;

    const ml = 'MODE · ' + d.padMode;
    if (modeEl.textContent !== ml) modeEl.textContent = ml;
    const ll = d.loop.len < 1 ? '1/' + Math.round(1 / d.loop.len) : d.loop.len + ' BT';
    if (lenEl.textContent !== ll) lenEl.textContent = ll;
    loopEl.classList.toggle('on', d.loop.on);
    const looseSeek = d.source !== 'local';
    loopEl.title = looseSeek
      ? 'Loop por seek: no Modo YT o ponto de volta encosta no keyframe (~2 s), então o loop não fecha na batida. Preciso só em Local Audio Mode.'
      : 'Loop na batida';
    quantEl.title = looseSeek
      ? 'Quantize tem pouco efeito no Modo YT: o seek já erra ~2 s. Preciso só em Local Audio Mode.'
      : 'Arredonda cues, loops e seek para a batida mais próxima';
    loopEl.setAttribute('aria-pressed', d.loop.on ? 'true' : 'false');

    const bpm = effectiveBpm(d, state.masterBpm);
    jog.update({
      bpmLabel: bpm > 0 ? bpm.toFixed(1) : '—',
      // the key when we actually know it, otherwise where the BPM came from
      keyLabel: d.key || (d.bpmSource === '—' ? '—' : d.bpmSource === 'DB' ? 'DB' : d.bpmSource),
    });
    pads.update();
  }
  update();
  return { el, update };
}
