// BPM and key for a YouTube track, without an API key and without a backend.
//
// The audio itself is unreachable, so the only route is to identify the
// recording and look up an existing analysis:
//
//   video id -> MusicBrainz URL relationship -> recording MBID
//            -> AcousticBrainz low-level features -> BPM + key
//
// Both services send Access-Control-Allow-Origin: *, so this runs entirely in
// the browser. Coverage is the catch: AcousticBrainz stopped accepting
// submissions in June 2022, so anything newer resolves to nothing, and the
// long tail of YouTube uploads is barely represented. Treat a hit as a bonus
// over tap tempo, never as the expected case.

import { camelot, keyName } from '../mix/harmony.js';

const MB = 'https://musicbrainz.org/ws/2';
const AB = 'https://acousticbrainz.org/api/v1';

// MusicBrainz asks for about one request per second, and throttles hard above
// it. Everything funnels through one queue so two decks can't race.
const MIN_GAP_MS = 1100;
let lastCall = 0;
let chain = Promise.resolve();

function paced(fn) {
  const run = async () => {
    const wait = Math.max(0, MIN_GAP_MS - (performance.now() - lastCall));
    if (wait) await new Promise((r) => setTimeout(r, wait));
    lastCall = performance.now();
    return fn();
  };
  chain = chain.then(run, run);
  return chain;
}

const NOTES = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };

async function getJson(url, signal, retries = 1) {
  const r = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  // 503 is how MusicBrainz says "too fast"; one unhurried retry usually lands
  if ((r.status === 503 || r.status === 429) && retries > 0) {
    await new Promise((res) => setTimeout(res, 1500));
    return getJson(url, signal, retries - 1);
  }
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
}

/** Recording MBIDs linked to this video, best first. */
async function recordingIds(videoId, signal) {
  const watch = `https://www.youtube.com/watch?v=${videoId}`;
  const url = `${MB}/url?resource=${encodeURIComponent(watch)}&inc=recording-rels&fmt=json`;
  const data = await paced(() => getJson(url, signal));
  const rels = Array.isArray(data.relations) ? data.relations : [];
  const ids = rels.map((r) => r.recording?.id).filter(Boolean);
  return [...new Set(ids)];
}

/** BPM + key for the first MBID that has an analysis. */
async function featuresFor(ids, signal) {
  if (!ids.length) return null;
  const url = `${AB}/low-level?recording_ids=${ids.slice(0, 25).join(';')}`
    + '&features=rhythm.bpm;tonal.key_key;tonal.key_scale';
  const data = await getJson(url, signal);
  for (const id of ids) {
    const entry = data?.[id]?.['0'];
    const bpm = entry?.rhythm?.bpm;
    if (typeof bpm !== 'number' || !Number.isFinite(bpm)) continue;
    const pc = NOTES[entry?.tonal?.key_key];
    const mode = entry?.tonal?.key_scale === 'minor' ? 'minor' : 'major';
    return {
      bpm: Math.round(bpm * 10) / 10,
      key: pc == null ? null : { camelot: camelot(pc, mode), name: keyName(pc, mode) },
    };
  }
  return null;
}

/**
 * @returns {Promise<{bpm:number, key:{camelot:string,name:string}|null}|null>}
 *          null when nothing is known — which is the common outcome.
 */
export async function lookupAnalysis(videoId, { signal } = {}) {
  if (!videoId) return null;
  try {
    const ids = await recordingIds(videoId, signal);
    if (!ids.length) return null;
    return await featuresFor(ids, signal);
  } catch {
    return null;   // offline, throttled, blocked — all mean "just use TAP"
  }
}
