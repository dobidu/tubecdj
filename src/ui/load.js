// "Carregar mídia": bulk entry point for playlists and recent tracks.
// The fast path lives in the booth (URL field in each deck's queue header).
// There is no title search — that needs a server-side Data API key.

import { h, fmt } from '../util.js';
import { state } from '../state.js';
import { parseInput, fetchMeta, thumbUrl } from '../yt/queue.js';
import { createHSlider } from './fader.js';

export function createLoadScreen({ app }) {
  const el = h(`
    <div class="card load-card">
      <div>
        <div class="lbl">Carregar mídia</div>
        <div class="load-h1">Playlists e faixas recentes</div>
        <div class="load-sub">Para uma faixa só, nem venha aqui: cole a URL no campo da fila do deck, no booth — <span class="mono">Enter</span> enfileira, <span class="mono">Shift+Enter</span> carrega na hora. Esta tela serve para abrir uma playlist inteira (<span class="mono">?list=</span>, até 50 faixas) e para voltar em algo recente.</div>
      </div>

      <div style="display:flex;flex-direction:column;gap:10px">
        <div class="load-form">
          <div class="load-input">
            <div class="glass"></div>
            <input class="url" spellcheck="false" autocomplete="off" inputmode="url" enterkeyhint="go"
                   aria-label="URL de vídeo ou playlist do YouTube"
                   placeholder="https://youtube.com/playlist?list=… · watch?v=… · ID" />
          </div>
          <button type="button" class="load-btn a" title="Enfileira no deck A (carrega direto se o deck estiver parado)">→ FILA A</button>
          <button type="button" class="load-btn b" title="Enfileira no deck B (carrega direto se o deck estiver parado)">→ FILA B</button>
        </div>
        <div class="disabled-hint">Deck tocando nunca é interrompido: a faixa entra no fim da fila. Se o deck estiver vazio ou parado, ela carrega na hora. Título e thumbnail vêm do oEmbed público — nenhuma chave de API.</div>
      </div>

      <div>
        <div class="lbl" style="margin-bottom:10px">Prévia e recentes</div>
        <div class="results"></div>
      </div>

      <div class="prefs">
        <div class="lbl">Preferências</div>
        <div class="prefs-grid">
          <div class="pref">
            <div class="pref-head">
              <span class="pref-name">Piso do vídeo</span>
              <span class="readout floor-val">22%</span>
            </div>
            <div class="floor-slot"></div>
            <div class="pref-note">Opacidade que um deck mantém com o crossfader todo no outro lado. Em 0% ele apaga por completo.</div>
          </div>
          <div class="pref">
            <div class="pref-head"><span class="pref-name">Faixa do pitch</span></div>
            <div class="range-slot"></div>
            <div class="pref-note">Padrão dos dois decks. Segurando Shift ao arrastar o fader, a faixa larga vale só naquele arrasto.</div>
          </div>
          <div class="pref">
            <div class="pref-head"><span class="pref-name">Rampa do corte SHARP</span></div>
            <div class="ramp-slot"></div>
            <div class="pref-note">Suaviza o corte da curva SHARP para não estalar. Só vale em Local Audio Mode — no Modo YT o volume anda em degraus de 1%.</div>
          </div>
        </div>
      </div>

      <div class="load-foot">
        <div>No booth: <span class="mono">⌘V</span> cola no deck focado · arraste um link para a fila (enfileira) ou para o player (carrega) · solte um MP3/WAV para Local Audio Mode.</div>
        <div>Atalhos: <span class="mono">Q/P</span> play · <span class="mono">W/O</span> cue · <span class="mono">1-4</span> hot cues · <span class="mono">←/→</span> crossfader · <span class="mono">Tab</span> foco</div>
      </div>
    </div>`);

  const input = el.querySelector('input.url');
  const results = el.querySelector('.results');

  /* ---- preferences ---- */
  const floorVal = el.querySelector('.floor-val');
  const floor = createHSlider({
    label: 'Piso de opacidade do vídeo',
    get: () => state.prefs.videoFloor / 0.6,          // slider spans 0–60%
    set: (v) => app.setPref({ videoFloor: v * 0.6 }),
  });
  el.querySelector('.floor-slot').replaceWith(floor.el);

  const chipSet = (slot, options, get, set) => {
    const wrap = h('<div class="set"></div>');
    const chips = options.map(({ label, value }) => {
      const c = h(`<button type="button" class="chip sm" style="--chip-c:var(--text-3)" aria-pressed="false">${label}</button>`);
      c.addEventListener('click', () => set(value));
      wrap.appendChild(c);
      return { c, value };
    });
    el.querySelector(slot).replaceWith(wrap);
    return () => chips.forEach(({ c, value }) => {
      const on = get() === value;
      c.classList.toggle('on', on);
      c.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  };

  const updateRange = chipSet('.range-slot',
    [{ label: '±8%', value: 8 }, { label: '±16%', value: 16 }],
    () => state.prefs.pitchRange, (v) => app.setPref({ pitchRange: v }));
  const updateRamp = chipSet('.ramp-slot',
    [{ label: '0 ms', value: 0 }, { label: '10 ms', value: 10 }, { label: '20 ms', value: 20 }, { label: '50 ms', value: 50 }],
    () => state.prefs.sharpRamp, (v) => app.setPref({ sharpRamp: v }));

  function updatePrefs() {
    const pct = Math.round(state.prefs.videoFloor * 100) + '%';
    floor.update(pct);
    if (floorVal.textContent !== pct) floorVal.textContent = pct;
    updateRange();
    updateRamp();
  }
  let preview = null;
  let sig = null;

  const send = (deckId) => {
    const v = input.value.trim();
    if (!v) return;
    app.send(v, deckId, 'auto');
    input.value = '';
  };
  el.querySelector('.load-btn.a').addEventListener('click', () => send('A'));
  el.querySelector('.load-btn.b').addEventListener('click', () => send('B'));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') send(e.shiftKey ? 'B' : state.focus);
  });

  let debounce = null;
  input.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(async () => {
      const p = parseInput(input.value);
      if (p.kind === 'video') {
        const meta = await fetchMeta(p.videoId);
        preview = { videoId: p.videoId, title: meta.title, sub: meta.author || 'vídeo', badge: 'PRÉVIA' };
      } else if (p.kind === 'playlist') {
        preview = { videoId: null, title: 'Playlist ' + p.listId, sub: 'playlist do YouTube', badge: 'LISTA' };
      } else {
        preview = null;
      }
      render();
    }, 320);
  });

  function card(item) {
    const c = h(`
      <button type="button" class="res">
        <div class="thumb">${item.videoId ? `<img loading="lazy" src="${thumbUrl(item.videoId)}" alt="" />` : ''}
          <div class="dur">${item.badge || (item.dur ? fmt(item.dur) : '—')}</div>
        </div>
        <div class="meta"><div class="t"></div><div class="s"></div></div>
      </button>`);
    c.querySelector('.t').textContent = item.title;
    c.querySelector('.s').textContent = item.sub || '';
    c.title = 'Clique: envia ao deck focado · Shift+clique: outro deck';
    c.addEventListener('click', (e) => {
      const target = e.shiftKey ? (state.focus === 'A' ? 'B' : 'A') : state.focus;
      app.send(item.videoId || item.title.replace(/^Playlist /, ''), target, 'auto');
    });
    return c;
  }

  function render() {
    const items = [];
    if (preview) items.push(preview);
    for (const hitem of state.history) {
      if (preview && hitem.videoId === preview.videoId) continue;
      items.push({ videoId: hitem.videoId, title: hitem.title, sub: 'recente', dur: hitem.dur });
    }
    const next = items.map((i) => `${i.videoId}|${i.title}|${i.dur || ''}`).join('~');
    if (next === sig) return;
    sig = next;
    results.textContent = '';
    if (!items.length) {
      results.appendChild(h('<div class="res-empty">Nada carregado ainda. Cole uma URL acima.</div>'));
      return;
    }
    items.slice(0, 8).forEach((i) => results.appendChild(card(i)));
  }
  render();

  function update() { render(); updatePrefs(); }
  updatePrefs();
  function focusInput() { input.focus(); input.select(); }
  return { el, update, focusInput };
}
