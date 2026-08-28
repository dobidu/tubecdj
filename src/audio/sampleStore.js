// Persistent storage for user sampler slots.
// localStorage can't hold audio, so the encoded files live in IndexedDB and
// are decoded again on every boot.

const DB = 'tubecdj';
const STORE = 'samples';
const VERSION = 1;

let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('IndexedDB indisponível'));
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'slot' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB negado'));
  });
  return dbPromise;
}

function tx(mode, run) {
  return open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = run(t.objectStore(STORE));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

/** @returns {Promise<Array<{slot:number,name:string,data:ArrayBuffer}>>} */
export async function allSamples() {
  try { return (await tx('readonly', (s) => s.getAll())) || []; }
  catch { return []; }
}

export async function putSample(slot, name, data) {
  return tx('readwrite', (s) => s.put({ slot, name, data }));
}

export async function deleteSample(slot) {
  return tx('readwrite', (s) => s.delete(slot));
}
