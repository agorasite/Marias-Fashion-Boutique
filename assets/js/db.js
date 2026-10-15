import { DB_NAME, SCHEMA_VERSION, STORE_DEFS } from './schema.js';

export { DB_NAME, SCHEMA_VERSION };

const errorListeners = [];
let dbPromise = null;
let lastError = null;

export function onDbError(cb) {
  errorListeners.push(cb);
  if (lastError) cb(lastError);
}

function emitError(err) {
  lastError = err;
  errorListeners.forEach((cb) => { try { cb(err); } catch (e) { /* ignore */ } });
}

// Ordered migrations: index i upgrades version i -> i+1.
const MIGRATIONS = [
  (db) => {
    for (const [name, def] of Object.entries(STORE_DEFS)) {
      const store = db.createObjectStore(name, { keyPath: def.keyPath });
      for (const i of def.indexes) store.createIndex(i.name, i.keyPath, i.options);
    }
  },
];

export function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    let req;
    try {
      if (typeof indexedDB === 'undefined' || !indexedDB) throw new Error('IndexedDB unavailable');
      req = indexedDB.open(DB_NAME, SCHEMA_VERSION);
    } catch (e) {
      const err = Object.assign(new Error('IndexedDB unavailable'), { code: 'unavailable', cause: e });
      emitError(err);
      reject(err);
      return;
    }
    req.onupgradeneeded = (ev) => {
      const db = req.result;
      for (let v = ev.oldVersion; v < SCHEMA_VERSION; v++) MIGRATIONS[v](db, req.transaction);
    };
    req.onblocked = () => emitError(Object.assign(new Error('IndexedDB blocked'), { code: 'blocked' }));
    req.onerror = () => {
      const err = Object.assign(new Error('IndexedDB open failed'), { code: 'unavailable', cause: req.error });
      emitError(err);
      reject(err);
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { db.close(); dbPromise = null; };
      resolve(db);
    };
  });
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

export const reqP = (r) => new Promise((res, rej) => {
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});

// fn may only await requests created on t (otherwise the transaction auto-commits).
export async function tx(stores, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    let result;
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Transaction aborted'));
    Promise.resolve()
      .then(() => fn(t))
      .then((r) => { result = r; })
      .catch((e) => { try { t.abort(); } catch (x) { /* already done */ } reject(e); });
  });
}

export const getAll = (store) => tx([store], 'readonly', (t) => reqP(t.objectStore(store).getAll()));
export const get = (store, key) => tx([store], 'readonly', (t) => reqP(t.objectStore(store).get(key)));
export const put = (store, val) => tx([store], 'readwrite', (t) => reqP(t.objectStore(store).put(val)));
export const del = (store, key) => tx([store], 'readwrite', (t) => reqP(t.objectStore(store).delete(key)));

export { ensureSeeded, resetToSeed } from './seed.js';
