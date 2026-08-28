// Jog wheel: centre = scratch (relative seek), outer ring = temporary pitch bend.

import { h } from '../util.js';
import { state } from '../state.js';

const SEC_PER_PX = 0.012;

export function createJog({ deckId, color, app }) {
  const el = h(`
    <div class="jog" title="Centro: scratch · Borda: bend">
      <div class="r1"></div>
      <div class="arm"><i></i></div>
      <div class="hub">
        <div class="k">DECK ${deckId}</div>
        <div class="bpm">—</div>
        <div class="key">—</div>
      </div>
    </div>`);
  const arm = el.querySelector('.arm');
  const bpmEl = el.querySelector('.hub .bpm');
  const keyEl = el.querySelector('.hub .key');

  let outer = false;

  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const dist = Math.hypot(e.clientX - cx, e.clientY - cy) / (r.width / 2);
    outer = dist > 0.72;
    let last = e.clientX;
    app.focusDeck(deckId);

    const move = (ev) => {
      const dx = ev.clientX - last;
      last = ev.clientX;
      if (outer) app.setBend(deckId, Math.max(-0.16, Math.min(0.16, (ev.clientX - (r.left + r.width / 2)) / r.width * 0.24)));
      else app.nudge(deckId, dx * SEC_PER_PX);
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      if (outer) app.setBend(deckId, 0);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  });

  function update({ bpmLabel, keyLabel }) {
    const d = state.deck[deckId];
    arm.style.transform = `rotate(${d.jogAngle}deg)`;
    if (bpmEl.textContent !== bpmLabel) bpmEl.textContent = bpmLabel;
    if (keyEl.textContent !== keyLabel) keyEl.textContent = keyLabel;
  }
  return { el, update };
}
