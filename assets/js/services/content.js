// Content service: one document per key in the `content` store (key path `key`).
// Seed defaults live in data/content.json (single source for seed + fallback).
import { get, put, tx, reqP } from '../db.js';
import { CONTENT_KEYS, NEWSLETTER_KEY, validateContent, resolveContent, addSubscriber, stripKey as strip, cloneJson as clone } from './content-rules.js';

export * from './content-rules.js';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// ---------------------------------------------------------------- IndexedDB-backed API
let defaultsPromise = null;
export function loadDefaults() {
  if (!defaultsPromise) {
    defaultsPromise = fetch(new URL('../../../data/content.json', import.meta.url))
      .then((r) => { if (!r.ok) throw new Error('Failed to load content.json'); return r.json(); })
      .catch((e) => { defaultsPromise = null; throw e; });
  }
  return defaultsPromise.then(clone);
}

/** Read one content document; falls back to the seeded default when missing or malformed. */
export async function getContent(key) {
  if (!CONTENT_KEYS.includes(key)) throw new Error(`Unknown content key: ${key}`);
  const stored = await get('content', key);
  if (stored && validateContent(key, strip(stored)).ok) return strip(stored);
  return resolveContent(key, undefined, await loadDefaults());
}

/** Validate and store one content document. Throws (err.errors) when invalid. */
export async function saveContent(key, value) {
  const doc = strip(isObj(value) ? value : null) ?? value;
  const r = validateContent(key, doc);
  if (!r.ok) throw Object.assign(new Error(`Μη έγκυρο περιεχόμενο (${key}): ${r.errors.join('; ')}`), { code: 'invalid', errors: r.errors });
  const clean = clone(doc);
  await put('content', { ...clean, key });
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('content:changed', { detail: { key } }));
  return clean;
}

/** Store a newsletter subscription locally (no email is ever sent). */
export async function subscribeNewsletter(email) {
  return tx(['settings'], 'readwrite', async (t) => {
    const store = t.objectStore('settings');
    const rec = await reqP(store.get(NEWSLETTER_KEY));
    const r = addSubscriber(rec?.list, email);
    if (r.status === 'added') await reqP(store.put({ key: NEWSLETTER_KEY, list: r.list }));
    return { status: r.status, email: r.email, error: r.error };
  });
}

export async function listSubscribers() {
  const rec = await get('settings', NEWSLETTER_KEY);
  return rec?.list || [];
}
