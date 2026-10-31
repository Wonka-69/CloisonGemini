// Petite couche IndexedDB : plus de place que localStorage et adaptée aux fichiers binaires.
// Deux magasins :
//   - kv  : valeurs JSON (séances, réglages)
//   - raw : fichiers LOG*.BIN bruts de la raquette, indexés par empreinte SHA-1 du contenu

const DB_NAME = 'playtracker';
const DB_VERSION = 1;

let dbPromise = null;

export function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) {
      reject(new Error('IndexedDB indisponible'));
      return;
    }
    let req;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (e) {
      reject(e);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('raw')) db.createObjectStore('raw', { keyPath: 'hash' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('base de données bloquée par un autre onglet'));
  });
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

function run(storeName, mode, fn) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const result = fn(tx.objectStore(storeName));
    tx.oncomplete = () => resolve(result instanceof IDBRequest ? result.result : result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('transaction annulée'));
  }));
}

export const kvGet = (key) => run('kv', 'readonly', (s) => s.get(key));
export const kvSet = (key, value) => run('kv', 'readwrite', (s) => { s.put(value, key); });

export const rawGetAll = () => run('raw', 'readonly', (s) => s.getAll());
export const rawCount = () => run('raw', 'readonly', (s) => s.count());
export const rawHas = (hash) => run('raw', 'readonly', (s) => s.count(hash)).then((n) => n > 0);
/** entry: { hash, name, importedAt (ISO), bytes (ArrayBuffer) } */
export const rawPut = (entry) => run('raw', 'readwrite', (s) => { s.put(entry); });

export async function sha1Hex(bytes) {
  if (globalThis.crypto?.subtle) {
    const d = await crypto.subtle.digest('SHA-1', bytes);
    return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
  }
  // Repli (page hors HTTPS) : empreinte FNV-1a, suffisante pour dédoublonner.
  let a = 0x811c9dc5, b = 0x12345678;
  for (const x of new Uint8Array(bytes)) {
    a = Math.imul(a ^ x, 0x01000193) >>> 0;
    b = Math.imul(b ^ x, 0x5bd1e995) >>> 0;
  }
  return `fnv${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}`;
}

export function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function fromBase64(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}
