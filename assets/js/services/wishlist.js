// Wishlist: one record in `wishlists` ({ id:'local', productIds }).
import { tx, reqP } from '../db.js';

const ID = 'local';

export async function list() {
  const rec = await tx(['wishlists'], 'readonly', (t) => reqP(t.objectStore('wishlists').get(ID)));
  return rec && Array.isArray(rec.productIds) ? [...rec.productIds] : [];
}

export async function has(productId) {
  return (await list()).includes(productId);
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
  window.dispatchEvent(new CustomEvent('wishlist:changed', { detail: { ids, productId, active } }));
  return active;
}

if (typeof window !== 'undefined' && !window.__elanWishlistBound) {
  window.__elanWishlistBound = true;
  window.addEventListener('wishlist:toggle', (e) => {
    const id = e.detail && e.detail.productId;
    if (id) toggle(id).catch((err) => console.warn('wishlist toggle failed', err));
  });
  // Seed UI state (hearts) once persisted ids are known.
  list()
    .then((ids) => window.dispatchEvent(new CustomEvent('wishlist:changed', { detail: { ids, productId: null, active: null } })))
    .catch(() => {});
}
