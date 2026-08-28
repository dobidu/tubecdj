// Vertical channel fader, pitch fader, horizontal master slider, crossfader.
// All four are drag-first but fully keyboard operable (arrows / Home / End).

import { drag, h, clamp, sliderKeys, sliderAria } from '../util.js';

export function createFader({ get, set, label = 'Channel fader' }) {
  const el = h(`
    <div class="fader" tabindex="0" role="slider" aria-label="${label}" aria-valuemin="0" aria-valuemax="100">
      <div class="track"><div class="fill"></div><div class="cap"><i></i></div></div>
    </div>`);
  const fill = el.querySelector('.fill');
  const cap = el.querySelector('.cap');
  drag(el.querySelector('.track'), { mode: 'trackY', get, set });
  sliderKeys(el, { get, set, centre: 1 });
  function update() {
    const v = get();
    fill.style.height = v * 100 + '%';
    cap.style.top = (1 - v) * 100 + '%';
    sliderAria(el, v, Math.round(v * 100) + '%');
  }
  update();
  return { el, update };
}

export function createPitchFader({ get, set, onShiftRange, label = 'Pitch' }) {
  const el = h(`
    <div class="pitch" tabindex="0" role="slider" aria-label="${label}" aria-valuemin="0" aria-valuemax="100">
      <div class="track"><div class="zero"></div><div class="cap"><i></i></div></div>
    </div>`);
  const cap = el.querySelector('.cap');
  drag(el.querySelector('.track'), {
    mode: 'trackY',
    get,
    set: (v, ev) => {
      onShiftRange?.(!!ev?.shiftKey);
      set(Math.abs(v - 0.5) < 0.012 ? 0.5 : v);   // snap to zero
    },
  });
  el.addEventListener('dblclick', () => set(0.5));
  sliderKeys(el, { get, set, step: 0.005, big: 0.05 });
  function update(text) {
    const v = get();
    cap.style.top = (1 - v) * 100 + '%';
    sliderAria(el, v, text);
  }
  update();
  return { el, update };
}

export function createHSlider({ get, set, label = 'Master' }) {
  const el = h(`
    <div class="hslider" tabindex="0" role="slider" aria-label="${label}" aria-valuemin="0" aria-valuemax="100">
      <div class="track"><div class="fill"></div><div class="cap"></div></div>
    </div>`);
  const fill = el.querySelector('.fill');
  const cap = el.querySelector('.cap');
  drag(el.querySelector('.track'), { mode: 'trackX', get, set });
  sliderKeys(el, { get, set, centre: 0.82 });
  function update(text) {
    const v = get();
    fill.style.width = v * 100 + '%';
    cap.style.left = v * 100 + '%';
    sliderAria(el, v, text);
  }
  update();
  return { el, update };
}

export function createCrossfader({ get, set, label = 'Crossfader' }) {
  const el = h(`
    <div class="xfader" tabindex="0" role="slider" aria-label="${label}" aria-valuemin="0" aria-valuemax="100">
      <div class="track"><div class="mark"></div><div class="cap"><i></i></div></div>
    </div>`);
  const cap = el.querySelector('.cap');
  const bar = el.querySelector('.cap i');
  drag(el.querySelector('.track'), {
    mode: 'trackX',
    get,
    set: (v) => set(Math.abs(v - 0.5) < 0.02 ? 0.5 : clamp(v)),   // centre snap
  });
  sliderKeys(el, { get, set, step: 0.05 });
  function update(text) {
    const v = get();
    cap.style.left = v * 100 + '%';
    bar.style.background = v < 0.45 ? 'var(--deck-a)' : v > 0.55 ? 'var(--deck-b)' : 'var(--text-3)';
    sliderAria(el, v, text);
  }
  update();
  return { el, update };
}
