// Wishlist: one record in `wishlists` ({ id:'local', productIds }).
import { tx, reqP } from '../db.js';

const ID = 'local';

// Monotonic version of the in-memory view. Every change event carries the version it produced;
// consumers ignore events older than the newest they have applied, so a slow initial read can
// never overwrite a newer toggle.
let version = 0;
export const currentVersion = () => version;

export async function list() {
  const rec = await tx(['wishlists'], 'readonly', (t) => reqP(t.objectStore('wishlists').get(ID)));
  return rec && Array.isArray(rec.productIds) ? [...rec.productIds] : [];
}

export async function has(productId) {
  return (await list()).includes(productId);
}

/** Persisted ids that still point at an active product (the set the wishlist page shows). */
export async function listActive() {
  return tx(['wishlists', 'products'], 'readonly', async (t) => {
    const rec = await reqP(t.objectStore('wishlists').get(ID));
    const out = [];
    for (const id of (rec && rec.productIds) || []) {
      const p = await reqP(t.objectStore('products').get(id));
      if (p && (!p.status || p.status === 'active')) out.push(id);
    }
    return out;
  });
}

/** Read ids together with the version that was current when the read started. */
export async function snapshot() {
  const v = version;
  return { ids: await list(), version: v };
}

/** Flip the state of a product. Resolves the new state (true = wished). */
export async function toggle(productId) {
  const { ids, active } = await tx(['wishlists'], 'readwrite', async (t) => {
    const rec = (await reqP(t.objectStore('wishlists').get(ID))) || { id: ID, productIds: [] };
    const set = new Set(rec.productIds);
    const on = !set.has(productId);
    if (on) set.add(productId);
    else set.delete(productId);
    rec.productIds = [...set];
    rec.updatedAt = new Date().toISOString();
    await reqP(t.objectStore('wishlists').put(rec));
    return { ids: rec.productIds, active: on };
  });
  version += 1;
  window.dispatchEvent(new CustomEvent('wishlist:changed', { detail: { ids, productId, active, version } }));
  return active;
}

/** Tell listeners the stored ids changed outside toggle() (e.g. a product was deleted in the admin). */
export function notifyExternalChange(ids) {
  version += 1;
  window.dispatchEvent(new CustomEvent('wishlist:changed', { detail: { ids, productId: null, active: null, version } }));
}

if (typeof window !== 'undefined' && !window.__elanWishlistBound) {
  window.__elanWishlistBound = true;
  window.addEventListener('wishlist:toggle', (e) => {
    const id = e.detail && e.detail.productId;
    if (id) toggle(id).catch((err) => console.warn('wishlist toggle failed', err));
  });
  // Seed UI state (hearts) once persisted ids are known.
  snapshot()
    .then(({ ids, version: v }) => window.dispatchEvent(new CustomEvent('wishlist:changed', { detail: { ids, productId: null, active: null, version: v } })))
    .catch(() => {});
}
