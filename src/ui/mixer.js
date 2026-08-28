// Mixer column: EQ/filter knobs, VU + channel faders, crossfader, Beat FX,
// sampler pads, video blend. EQ/filter/FX are inert in YT mode and say so.

import { h } from '../util.js';
import { state, KNOBS, CURVES, BLENDS, FX_TYPES, FX_BEAT_LABELS, FX_TARGETS, SAMPLERS } from '../state.js';
import { createKnob } from './knob.js';
import { createFader, createCrossfader } from './fader.js';
import { drag, sliderKeys, sliderAria } from '../util.js';

const INERT_TIP = 'Indisponível no Modo YT — requer Local Audio Mode (solte um MP3/WAV no deck)';

function chipRow(labels, { color, get, set, cls = '' }) {
  const wrap = h('<div class="set"></div>');
  const chips = labels.map((label, i) => {
    const c = h(`<button type="button" class="chip ${cls}" style="--chip-c:${color}" aria-pressed="false">${label}</button>`);
    c.addEventListener('click', () => set(i));
    wrap.appendChild(c);
    return c;
  });
  const update = () => chips.forEach((c, i) => {
    const on = get() === i;
    c.classList.toggle('on', on);
    c.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  update();
  return { el: wrap, update, chips };
}

export function createMixer({ app }) {
  const el = h(`
    <div class="card mixer">
      <div class="knob-rows"></div>
      <div class="strips"></div>
      <div class="xf-block">
        <div class="xf-head">
          <span class="lbl">CROSSFADER</span>
          <div class="curve-slot"></div>
        </div>
        <div class="xf-slot"></div>
        <div class="xf-legend"><span>A</span><span class="xf-label">CENTER</span><span>B</span></div>
      </div>
      <div class="fx">
        <div class="fx-head">
          <span class="lbl">BEAT FX</span>
          <div class="target-slot"></div>
        </div>
        <div class="fx-types"></div>
        <div class="fx-body">
          <div class="knob-cell">
            <div class="fx-depth" tabindex="0" role="slider" aria-label="FX depth"
                 aria-valuemin="0" aria-valuemax="100"><div class="rot"><i></i></div></div>
            <div class="knob-cap">DEPTH</div>
          </div>
          <div class="fx-right">
            <div class="fx-beats"></div>
            <button type="button" class="fx-on" aria-pressed="false">FX ON</button>
          </div>
        </div>
      </div>
      <div class="samplers"></div>
      <div class="blend-row">
        <span class="lbl">VIDEO BLEND</span>
        <div class="blend-slot"></div>
      </div>
      <div class="mix-note"></div>
    </div>`);

  const colorOf = (id) => (id === 'A' ? 'var(--deck-a)' : 'var(--deck-b)');
  const knobLabel = (id, key) => `${key.toUpperCase()} do canal ${id}`;
  const knobRows = el.querySelector('.knob-rows');
  const strips = el.querySelector('.strips');
  const chParts = {};

  for (const id of ['A', 'B']) {
    const color = id === 'A' ? '#FF9E2C' : '#35D0E0';
    const ch = h(`<div class="ch" style="--c:${colorOf(id)}"><div class="ch-cap">CH ${id}</div><div class="knobs"></div></div>`);
    const grid = ch.querySelector('.knobs');
    const knobs = KNOBS.map(({ key, label }) => {
      const k = createKnob({
        label,
        title: knobLabel(id, key),
        color: key === 'filter' ? '#B14BFF' : color,
        get: () => state.ch[id][key],
        set: (v) => app.setKnob(id, key, v),
      });
      grid.appendChild(k.el);
      return { key, ...k };
    });
    knobRows.appendChild(ch);

    const strip = h(`<div class="strip" style="--c:${colorOf(id)}"><div class="meter"></div><div class="fader-slot"></div></div>`);
    const meter = strip.querySelector('.meter');
    const segs = [];
    for (let i = 0; i < 12; i++) { const s = h('<i></i>'); meter.appendChild(s); segs.push(s); }
    const fader = createFader({ get: () => state.ch[id].fader, set: (v) => app.setFader(id, v) });
    strip.querySelector('.fader-slot').replaceWith(fader.el);
    strips.appendChild(strip);

    chParts[id] = { knobs, segs, fader };
  }

  const curves = chipRow(CURVES, { color: 'var(--text-3)', cls: 'sm', get: () => state.curve, set: (i) => app.setCurve(i) });
  el.querySelector('.curve-slot').replaceWith(curves.el);

  const xfader = createCrossfader({ get: () => state.xfader, set: (v) => app.setXfader(v) });
  el.querySelector('.xf-slot').replaceWith(xfader.el);
  const xfLabel = el.querySelector('.xf-label');

  const targets = chipRow(FX_TARGETS, {
    color: 'var(--accent-fx)', cls: 'sm',
    get: () => FX_TARGETS.indexOf(state.fx.target),
    set: (i) => app.setFx({ target: FX_TARGETS[i] }),
  });
  el.querySelector('.target-slot').replaceWith(targets.el);

  const types = chipRow(FX_TYPES, {
    color: 'var(--accent-fx)',
    get: () => state.fx.type,
    set: (i) => app.setFx({ type: i }),
  });
  el.querySelector('.fx-types').replaceWith(Object.assign(types.el, { className: 'set fx-types' }));

  const beats = chipRow(FX_BEAT_LABELS, {
    color: 'var(--accent-fx)',
    get: () => state.fx.beats,
    set: (i) => app.setFx({ beats: i }),
  });
  el.querySelector('.fx-beats').replaceWith(Object.assign(beats.el, { className: 'set fx-beats' }));

  const depthKnob = el.querySelector('.fx-depth');
  const depthRot = depthKnob.querySelector('.rot');
  drag(depthKnob, { mode: 'rel', span: 160, get: () => state.fx.depth, set: (v) => app.setFx({ depth: v }) });
  depthKnob.addEventListener('dblclick', () => app.setFx({ depth: 0.5 }));
  sliderKeys(depthKnob, { get: () => state.fx.depth, set: (v) => app.setFx({ depth: v }) });

  const fxOn = el.querySelector('.fx-on');
  fxOn.addEventListener('click', () => app.toggleFx());

  const samplerWrap = el.querySelector('.samplers');
  const AUDIO_RE = /^audio\//;
  const samplerChips = SAMPLERS.map((label, i) => {
    const c = h(`<button type="button" class="chip" style="--chip-c:var(--ok)" aria-pressed="false">${label}</button>`);
    c.addEventListener('click', (e) => {
      if (e.shiftKey) app.clearSample(i); else app.sampler(i);
    });
    c.addEventListener('contextmenu', (e) => { e.preventDefault(); app.clearSample(i); });
    c.addEventListener('dragover', (e) => {
      if (!e.dataTransfer.types.includes('Files')) return;
      e.preventDefault();
      c.classList.add('drop');
    });
    c.addEventListener('dragleave', () => c.classList.remove('drop'));
    c.addEventListener('drop', (e) => {
      e.preventDefault();
      c.classList.remove('drop');
      const file = [...(e.dataTransfer.files || [])].find((f) => AUDIO_RE.test(f.type) || /\.(mp3|wav|m4a|flac|ogg)$/i.test(f.name));
      if (file) app.loadSample(i, file);
    });
    samplerWrap.appendChild(c);
    return c;
  });

  const blends = chipRow(BLENDS, {
    color: 'var(--text-3)', cls: 'sm',
    get: () => state.blend,
    set: (i) => app.setBlend(i),
  });
  el.querySelector('.blend-slot').replaceWith(blends.el);

  const note = el.querySelector('.mix-note');
  const fxBlock = el.querySelector('.fx');

  function update(levels = { A: 0, B: 0 }) {
    for (const id of ['A', 'B']) {
      const p = chParts[id];
      const local = state.deck[id].source === 'local';
      p.knobs.forEach((k) => {
        k.update();
        const inert = !local && k.key !== 'trim';
        k.el.classList.toggle('inert', inert);
        k.node.title = inert ? INERT_TIP : k.key.toUpperCase();
      });
      p.fader.update();
      const lvl = levels[id] || 0;
      p.segs.forEach((s, i) => {
        const on = (i / 12) < lvl;
        s.style.background = on ? (i > 9 ? 'var(--danger)' : i > 7 ? 'var(--warn)' : 'var(--ok)') : '#1A1D21';
      });
    }
    curves.update();
    const x = state.xfader;
    const lab = x < 0.48 ? 'A ' + Math.round((1 - x) * 100) + '%' : x > 0.52 ? 'B ' + Math.round(x * 100) + '%' : 'CENTER';
    xfader.update(lab);
    if (xfLabel.textContent !== lab) xfLabel.textContent = lab;

    targets.update(); types.update(); beats.update();
    depthRot.style.transform = `rotate(${-140 + state.fx.depth * 280}deg)`;
    sliderAria(depthKnob, state.fx.depth, Math.round(state.fx.depth * 100) + '%');
    fxOn.classList.toggle('on', state.fx.on);
    fxOn.setAttribute('aria-pressed', state.fx.on ? 'true' : 'false');

    const fxLive = state.fx.target === 'MST'
      ? (state.deck.A.source === 'local' || state.deck.B.source === 'local')
      : state.deck[state.fx.target].source === 'local';
    fxBlock.classList.toggle('inert', !fxLive);
    fxBlock.title = fxLive ? '' : INERT_TIP;

    samplerChips.forEach((c, i) => {
      const on = state.sampler === i;
      c.classList.toggle('on', on);
      c.setAttribute('aria-pressed', on ? 'true' : 'false');
      const custom = app.samplerIsCustom(i);
      const label = (app.samplerLabel(i) || SAMPLERS[i]).toUpperCase();
      if (c.textContent !== label) c.textContent = label;
      c.classList.toggle('custom', custom);
      c.title = custom
        ? 'Sample seu · clique toca · Shift+clique ou botão direito volta ao padrão'
        : 'Clique toca · arraste um arquivo de áudio para substituir';
    });
    blends.update();

    const localCount = ['A', 'B'].filter((id) => state.deck[id].source === 'local').length;
    const msg = localCount === 2
      ? 'Local Audio Mode nos dois decks: EQ, filtro e FX ativos.'
      : localCount === 1
        ? 'Um deck em Local Audio Mode. No outro, EQ/filtro/FX ficam inertes — <b>solte um MP3/WAV</b> no player.'
        : 'Modo YT: volume, pitch, cues e loops são reais. EQ, filtro e FX exigem <b>Local Audio Mode</b> — solte um MP3/WAV sobre um player. VU estimado a partir do ganho.';
    if (note.innerHTML !== msg) note.innerHTML = msg;
  }
  update();
  return { el, update };
}
