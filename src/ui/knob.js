// 42px rotary knob: vertical drag (160px = full travel), double click or
// Enter recentres, arrows step. Reads as a slider to assistive tech.

import { drag, h, sliderKeys, sliderAria } from '../util.js';

export function createKnob({ label, color, get, set, title }) {
  const el = h(`
    <div class="knob-cell">
      <div class="knob" tabindex="0" role="slider" aria-label="${label}"
           aria-valuemin="0" aria-valuemax="100" title="${title || label}"><div class="rot"><i></i></div></div>
      <div class="knob-cap">${label}</div>
    </div>`);
  const knob = el.querySelector('.knob');
  const rot = el.querySelector('.rot');
  const tick = el.querySelector('.rot i');

  drag(knob, { mode: 'rel', span: 160, get, set });
  knob.addEventListener('dblclick', () => set(0.5));
  sliderKeys(knob, { get, set });

  function update() {
    const v = get();
    rot.style.transform = `rotate(${-140 + v * 280}deg)`;
    tick.style.background = Math.abs(v - 0.5) < 0.03 ? 'var(--text-4)' : color;
    sliderAria(knob, v, Math.abs(v - 0.5) < 0.03 ? 'centro' : Math.round(v * 100) + '%');
  }
  update();
  return { el, update, node: knob };
}
