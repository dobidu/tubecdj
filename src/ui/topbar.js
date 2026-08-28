// Topbar: logo, screen tabs, master BPM + TAP, master level, limiter.

import { h } from '../util.js';
import { state } from '../state.js';
import { createHSlider } from './fader.js';

const db = (v) => (v <= 0.001 ? '-∞ dB' : (20 * Math.log10(v)).toFixed(1) + ' dB');

export function createTopbar({ app }) {
  const el = h(`
    <div class="hdr-inner" style="display:flex;align-items:center;gap:16px;width:100%">
      <div class="logo">
        <div class="logo-mark"><i></i></div>
        <div class="logo-tx">Tube<span>CDJ</span></div>
        <div class="badge">FLX2 LAYOUT</div>
      </div>
      <div class="tabs" role="tablist">
        <button type="button" class="tab booth" role="tab" aria-selected="true">Booth</button>
        <button type="button" class="tab load" role="tab" aria-selected="false">Carregar mídia</button>
      </div>
      <div class="spacer"></div>
      <div class="hdr-right">
        <div class="mbpm">
          <span class="cap">Master BPM</span>
          <span class="val">126.0</span>
        </div>
        <button type="button" class="tap" title="Toque no tempo (4+ toques)">TAP</button>
        <div style="display:flex;align-items:center;gap:9px">
          <span class="cap lbl">Master</span>
          <div class="master-slot"></div>
          <span class="readout">-1.7 dB</span>
        </div>
        <button type="button" class="chip limiter" style="--chip-c:var(--ok);padding:7px 12px" aria-pressed="true">LIMITER</button>
      </div>
    </div>`);

  const tabBooth = el.querySelector('.tab.booth');
  const tabLoad = el.querySelector('.tab.load');
  const bpmEl = el.querySelector('.mbpm .val');
  const readout = el.querySelector('.readout');
  const limiter = el.querySelector('.limiter');

  tabBooth.addEventListener('click', () => app.goScreen('booth'));
  tabLoad.addEventListener('click', () => app.goScreen('load'));
  el.querySelector('.tap').addEventListener('click', () => app.tap());
  limiter.addEventListener('click', () => app.toggleLimiter());

  const master = createHSlider({ label: 'Master', get: () => state.master, set: (v) => app.setMaster(v) });
  el.querySelector('.master-slot').replaceWith(master.el);

  function update() {
    const onBooth = state.screen === 'booth';
    tabBooth.classList.toggle('on', onBooth);
    tabLoad.classList.toggle('on', !onBooth);
    tabBooth.setAttribute('aria-selected', String(onBooth));
    tabLoad.setAttribute('aria-selected', String(!onBooth));
    const b = state.masterBpm.toFixed(1);
    if (bpmEl.textContent !== b) bpmEl.textContent = b;
    const d = db(state.master);
    master.update(d);
    if (readout.textContent !== d) readout.textContent = d;
    limiter.classList.toggle('on', state.limiter);
    limiter.setAttribute('aria-pressed', state.limiter ? 'true' : 'false');
  }
  update();
  return { el, update };
}
