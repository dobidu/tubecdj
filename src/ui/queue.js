// Per-deck queue: inline URL entry in the header, click loads, drag reorders,
// SHUFFLE, right-click removes. Dropping a YouTube link enqueues it here.

import { h, fmt } from '../util.js';
import { state } from '../state.js';

export function createQueue({ deckId, color, app }) {
  const el = h(`
    <div class="queue" style="--c:${color}">
      <div class="queue-head">
        <span class="lbl">Fila · <span class="count">0</span></span>
        <span class="head-acts">
          <button type="button" class="act auto" aria-pressed="true"
                  title="Auto-avanço: toca a próxima da fila quando a faixa acaba">AUTO</button>
          <button type="button" class="act shuffle" title="Embaralhar a fila">SHUFFLE</button>
        </span>
      </div>
      <div class="queue-add">
        <span class="plus">+</span>
        <input class="url" spellcheck="false" autocomplete="off" inputmode="url"
               placeholder="cole URL ou ID"
               title="Enter enfileira neste deck (carrega direto se o deck estiver parado) · Shift+Enter carrega agora · Esc limpa" />
      </div>
      <div class="queue-list"></div>
    </div>`);
  const listEl = el.querySelector('.queue-list');
  const count = el.querySelector('.count');
  el.querySelector('.shuffle').addEventListener('click', () => app.shuffle(deckId));
  const autoEl = el.querySelector('.act.auto');
  autoEl.addEventListener('click', () => app.toggleAutoNext(deckId));

  const url = el.querySelector('input.url');
  url.setAttribute('aria-label', `Adicionar faixa à fila do deck ${deckId}`);
  url.addEventListener('focus', () => app.focusDeck(deckId));
  url.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { url.value = ''; url.blur(); return; }
    if (e.key !== 'Enter') return;
    const v = url.value.trim();
    if (!v) return;
    app.send(v, deckId, e.shiftKey ? 'now' : 'auto');
    url.value = '';
  });

  el.addEventListener('dragover', (e) => {
    if (e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    el.classList.add('drop');
  });
  el.addEventListener('dragleave', () => el.classList.remove('drop'));
  el.addEventListener('drop', (e) => {
    const text = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
    el.classList.remove('drop');
    if (!text || /^\d+$/.test(text)) return;      // plain index = queue reorder, handled per row
    e.preventDefault();
    app.send(text, deckId, 'queue');
  });

  let sig = null;
  let dragFrom = -1;

  function build(queue) {
    listEl.textContent = '';
    if (!queue.length) {
      listEl.appendChild(h(`<div class="queue-empty">Fila vazia. Cole uma URL no campo acima e aperte <b>Enter</b>, arraste um link do navegador para cá, ou solte um MP3/WAV no player.</div>`));
      return;
    }
    queue.forEach((item, i) => {
      const row = h(`
        <div class="qrow" draggable="true">
          <div class="n">${String(i + 1).padStart(2, '0')}</div>
          <div class="body">
            <div class="t"></div>
            <div class="s"></div>
          </div>
          <div class="d"></div>
        </div>`);
      row.querySelector('.t').textContent = item.title || item.videoId;
      row.querySelector('.t').title = item.title || item.videoId;
      row.querySelector('.s').textContent = `${item.bpm ? item.bpm.toFixed(1) + ' BPM' : '— BPM'} · ${item.key || '—'}`;
      row.querySelector('.d').textContent = item.dur ? fmt(item.dur) : '—';
      row.addEventListener('click', () => app.loadQueueItem(deckId, i));
      row.addEventListener('contextmenu', (e) => { e.preventDefault(); app.removeItem(deckId, i); });
      row.addEventListener('dragstart', (e) => {
        dragFrom = i;
        row.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(i));
      });
      row.addEventListener('dragend', () => { dragFrom = -1; row.classList.remove('dragging'); });
      row.addEventListener('dragover', (e) => { e.preventDefault(); row.classList.add('over'); });
      row.addEventListener('dragleave', () => row.classList.remove('over'));
      row.addEventListener('drop', (e) => {
        e.preventDefault();
        row.classList.remove('over');
        const from = dragFrom >= 0 ? dragFrom : parseInt(e.dataTransfer.getData('text/plain'), 10);
        if (!Number.isNaN(from)) app.moveItem(deckId, from, i);
      });
      listEl.appendChild(row);
    });
  }

  function update() {
    const d = state.deck[deckId];
    const next = d.queue.map((q) => `${q.videoId}:${q.title}:${q.bpm}:${q.dur}`).join('|');
    if (next !== sig) { sig = next; build(d.queue); }
    count.textContent = String(d.queue.length);
    autoEl.classList.toggle('on', d.autoNext);
    autoEl.setAttribute('aria-pressed', d.autoNext ? 'true' : 'false');
    [...listEl.children].forEach((row, i) => row.classList?.toggle('on', i === d.queueIndex));
  }
  update();
  return { el, update };
}
