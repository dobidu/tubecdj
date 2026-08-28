// 4x2 performance pads: HOT CUE (set / jump / shift-delete) or BEAT LOOP (1/4…32).

import { h } from '../util.js';
import { state, LOOP_LENGTHS } from '../state.js';

const LOOP_LABELS = ['1/4', '1/2', '1', '2', '4', '8', '16', '32'];

export function createPads({ deckId, app }) {
  const el = h('<div class="pads"></div>');
  const pads = [];
  for (let i = 0; i < 8; i++) {
    const pad = h('<button type="button" class="pad"></button>');
    pad.addEventListener('click', (e) => app.pad(deckId, i, e.shiftKey));
    el.appendChild(pad);
    pads.push(pad);
  }

  function update() {
    const d = state.deck[deckId];
    const hot = d.padMode === 'HOT CUE';
    for (let i = 0; i < 8; i++) {
      const label = hot ? 'CUE ' + (i + 1) : LOOP_LABELS[i];
      if (pads[i].textContent !== label) pads[i].textContent = label;
      const on = hot ? d.cues[i] != null : (d.loop.on && d.loop.len === LOOP_LENGTHS[i]);
      pads[i].classList.toggle('on', !!on);
      pads[i].setAttribute('aria-pressed', on ? 'true' : 'false');
      // seekTo lands on the nearest keyframe — the docs say up to ~2 s early —
      // so a cue on a YouTube deck is a region, not a point.
      const sloppy = d.source !== 'local' ? ' · precisão ~2 s no Modo YT (o seek encosta no keyframe)' : '';
      pads[i].title = (hot
        ? (d.cues[i] != null ? 'Jump (Shift+clique apaga)' : 'Definir hot cue')
        : 'Beat loop ' + label) + sloppy;
    }
  }
  update();
  return { el, update };
}
