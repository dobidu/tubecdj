// URL/ID parsing, per-deck queue mutation, and title/thumb lookup.
// No Data API key: metadata comes from noembed.com (CORS-friendly oEmbed proxy).

import { MAX_QUEUE, state, setDeck, saveSession } from '../state.js';

const ID_RE = /^[A-Za-z0-9_-]{11}$/;

/** @returns {{kind:'video'|'playlist'|'none', videoId?:string, listId?:string}} */
export function parseInput(raw) {
  const s = (raw || '').trim();
  if (!s) return { kind: 'none' };
  if (ID_RE.test(s)) return { kind: 'video', videoId: s };

  let u = null;
  try { u = new URL(s.startsWith('http') ? s : 'https://' + s); } catch { return { kind: 'none' }; }
  const host = u.hostname.replace(/^www\./, '');
  const listId = u.searchParams.get('list');
  let videoId = u.searchParams.get('v');

  if (host === 'youtu.be') videoId = u.pathname.slice(1).split('/')[0];
  const m = u.pathname.match(/\/(shorts|embed|live)\/([A-Za-z0-9_-]{11})/);
  if (m) videoId = m[2];

  if (videoId && ID_RE.test(videoId)) return { kind: 'video', videoId, listId: listId || undefined };
  if (listId) return { kind: 'playlist', listId };
  return { kind: 'none' };
}

export const thumbUrl = (videoId) => `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;

const metaCache = new Map();

/** Title/author via noembed. Never throws — falls back to the bare id. */
export async function fetchMeta(videoId) {
  if (metaCache.has(videoId)) return metaCache.get(videoId);
  const fallback = { videoId, title: videoId, author: '' };
  try {
    const url = 'https://noembed.com/embed?url=' + encodeURIComponent('https://www.youtube.com/watch?v=' + videoId);
    const r = await fetch(url, { mode: 'cors' });
    if (!r.ok) throw new Error('noembed ' + r.status);
    const j = await r.json();
    const meta = { videoId, title: j.title || videoId, author: j.author_name || '' };
    metaCache.set(videoId, meta);
    return meta;
  } catch {
    // Deliberately not cached: a blocked or flaky request must not pin this
    // video to its raw id for the rest of the session.
    return fallback;
  }
}

/** Replace a placeholder title in every deck queue once the real one shows up. */
export function renameInQueues(videoId, title) {
  for (const id of ['A', 'B']) {
    const d = state.deck[id];
    let touched = false;
    const queue = d.queue.map((q) => {
      if (q.videoId !== videoId || q.title === title) return q;
      if (q.title && q.title !== videoId) return q;   // keep a real title
      touched = true;
      return { ...q, title };
    });
    if (touched) setDeck(id, { queue }, 'queue');
  }
}

export const newItem = (videoId, title = videoId) => ({ videoId, title, dur: 0, bpm: 0, key: '—' });

export function addToQueue(deckId, items, { select = false } = {}) {
  const d = state.deck[deckId];
  const seen = new Set(d.queue.map((q) => q.videoId));
  const fresh = items.filter((i) => i && i.videoId && !seen.has(i.videoId));
  const queue = [...d.queue, ...fresh].slice(0, MAX_QUEUE);
  const idx = select && fresh.length ? queue.findIndex((q) => q.videoId === fresh[0].videoId) : d.queueIndex;
  setDeck(deckId, { queue, queueIndex: idx }, 'queue');
  saveSession();
  return fresh.length;
}

export function moveInQueue(deckId, from, to) {
  const d = state.deck[deckId];
  if (from === to || from < 0 || to < 0 || from >= d.queue.length || to > d.queue.length) return;
  const queue = d.queue.slice();
  const [item] = queue.splice(from, 1);
  queue.splice(to > from ? to - 1 : to, 0, item);
  const current = d.queue[d.queueIndex];
  setDeck(deckId, { queue, queueIndex: current ? queue.indexOf(current) : -1 }, 'queue');
  saveSession();
}

export function shuffleQueue(deckId) {
  const d = state.deck[deckId];
  const queue = d.queue.slice();
  for (let i = queue.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [queue[i], queue[j]] = [queue[j], queue[i]];
  }
  const current = d.queue[d.queueIndex];
  setDeck(deckId, { queue, queueIndex: current ? queue.indexOf(current) : -1 }, 'queue');
  saveSession();
}

export function removeFromQueue(deckId, index) {
  const d = state.deck[deckId];
  const queue = d.queue.slice();
  queue.splice(index, 1);
  let qi = d.queueIndex;
  if (index < qi) qi -= 1; else if (index === qi) qi = Math.min(qi, queue.length - 1);
  setDeck(deckId, { queue, queueIndex: qi }, 'queue');
  saveSession();
}

export const nextIndex = (deckId) => {
  const d = state.deck[deckId];
  return d.queue.length ? (d.queueIndex + 1) % d.queue.length : -1;
};
