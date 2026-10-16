// Admin product management: persistence on top of the pure rules in product-admin-rules.js.
// Public surface (import everything from here): validateProductInput, saveProduct, archiveProduct,
// unarchiveProduct, setProductFlag, deleteProduct, loadAdminCatalog, plus all rule helpers.
//
// Decisions:
// - A variant removed in the editor is deleted only if no order line references its SKU. Otherwise it
//   is kept as { stock: 0, archived: true }: history stays resolvable, and the storefront ignores
//   archived variants everywhere (availability, filters, PDP, cart classification => problem 'archived').
// - A product is hard-deleted only when no order contains it; otherwise the UI offers archiving.
// - Orders are only ever READ here. They are immutable snapshots.
import { tx, reqP } from '../db.js';
import { validateProductInput } from './product-admin-rules.js';

export * from './product-admin-rules.js';

const emit = (name, detail = {}) => {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(name, { detail }));
};

const newId = () => `p-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const orderLines = (orders) => orders.flatMap((o) => (Array.isArray(o.lines) ? o.lines : []));

/** Everything the admin list/editor needs in one read. */
export async function loadAdminCatalog() {
  return tx(['products', 'variants', 'categories'], 'readonly', async (t) => {
    const [products, variants, categories] = await Promise.all([
      reqP(t.objectStore('products').getAll()), reqP(t.objectStore('variants').getAll()), reqP(t.objectStore('categories').getAll()),
    ]);
    return { products, variants, categories: categories.sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0)) };
  });
}

/** One product with ALL its variants (archived ones flagged) or null. */
export async function getAdminProduct(id) {
  return tx(['products', 'variants'], 'readonly', async (t) => {
    const p = await reqP(t.objectStore('products').get(id));
    if (!p) return null;
    const variants = await reqP(t.objectStore('variants').index('productId').getAll(id));
    return { ...p, variants };
  });
}

/**
 * Create or update (when input.id exists) a product and its variants in ONE readwrite transaction.
 * Throws an Error with code 'invalid' and `errors` when validation fails (the same rules as the form).
 */
export async function saveProduct(input) {
  const saved = await tx(['products', 'variants', 'orders', 'categories'], 'readwrite', async (t) => {
    const products = t.objectStore('products');
    const variantStore = t.objectStore('variants');
    const [allProducts, allVariants, orders, categories] = await Promise.all([
      reqP(products.getAll()), reqP(variantStore.getAll()), reqP(t.objectStore('orders').getAll()), reqP(t.objectStore('categories').getAll()),
    ]);
    const lines = orderLines(orders);
    const editingId = input.id && allProducts.some((p) => p.id === input.id) ? input.id : null;
    // SKUs of OTHER products, whether they still exist or only survive in order history.
    const existingSkus = [
      ...allVariants.map((v) => ({ sku: v.sku, productId: v.productId })),
      ...lines.map((l) => ({ sku: l.sku, productId: l.productId })),
    ];
    const res = validateProductInput(input, { existingProducts: allProducts, existingSkus, categories, editingId });
    if (!res.ok) throw Object.assign(new Error('Invalid product'), { code: 'invalid', errors: res.errors });

    const prev = editingId ? allProducts.find((p) => p.id === editingId) : null;
    const id = editingId || newId();
    const { variants: formVariants, ...fields } = res.value;
    const product = {
      popularity: 0,
      ...(prev || {}),
      ...fields,
      id,
      createdAt: prev ? prev.createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    if (fields.compareAtCents === undefined) delete product.compareAtCents;
    await reqP(products.put(product));

    const keep = new Set(formVariants.map((v) => v.sku));
    const referenced = new Set(lines.map((l) => l.sku));
    for (const old of allVariants.filter((v) => v.productId === id && !keep.has(v.sku))) {
      if (referenced.has(old.sku)) await reqP(variantStore.put({ ...old, stock: 0, archived: true }));
      else await reqP(variantStore.delete(old.sku));
    }
    for (const v of formVariants) {
      const { archived, ...clean } = v; // saving a row (re)activates it
      await reqP(variantStore.put({ ...clean, productId: id }));
    }
    return product;
  });
  emit('catalog:changed', { id: saved.id, action: 'save' });
  return saved;
}

async function patchProduct(id, patch, action) {
  const p = await tx(['products'], 'readwrite', async (t) => {
    const store = t.objectStore('products');
    const rec = await reqP(store.get(id));
    if (!rec) throw Object.assign(new Error('Product not found'), { code: 'not-found' });
    const next = { ...rec, ...patch(rec), updatedAt: new Date().toISOString() };
    await reqP(store.put(next));
    return next;
  });
  emit('catalog:changed', { id, action });
  return p;
}
export const archiveProduct = (id) => patchProduct(id, () => ({ status: 'archived' }), 'archive');
export const unarchiveProduct = (id) => patchProduct(id, () => ({ status: 'active' }), 'unarchive');
/** Toggle a flag (featured / new / bestSeller) without touching anything else. */
export const setProductFlag = (id, flag, on) => patchProduct(id, (rec) => ({ flags: { ...(rec.flags || {}), [flag]: !!on } }), 'flag');

/** Does any stored order contain this product? (read-only; lets the UI explain the options first) */
export async function productHasOrders(id) {
  return tx(['orders', 'variants'], 'readonly', async (t) => {
    const skus = new Set((await reqP(t.objectStore('variants').index('productId').getAll(id))).map((v) => v.sku));
    return orderLines(await reqP(t.objectStore('orders').getAll())).some((l) => l.productId === id || skus.has(l.sku));
  });
}

/**
 * Hard delete, only when no order contains the product. Removes its variants, reviews and wishlist
 * entries and the cart lines that point at its SKUs, all in one transaction.
 * @returns {Promise<{deleted:boolean, reason?:'has-orders'|'not-found'}>}
 */
export async function deleteProduct(id) {
  const result = await tx(['products', 'variants', 'orders', 'reviews', 'wishlists', 'carts'], 'readwrite', async (t) => {
    const products = t.objectStore('products');
    if (!(await reqP(products.get(id)))) return { deleted: false, reason: 'not-found' };
    const orders = await reqP(t.objectStore('orders').getAll());
    const vs = await reqP(t.objectStore('variants').index('productId').getAll(id));
    const skus = new Set(vs.map((v) => v.sku));
    if (orderLines(orders).some((l) => l.productId === id || skus.has(l.sku))) return { deleted: false, reason: 'has-orders' };

    for (const v of vs) await reqP(t.objectStore('variants').delete(v.sku));
    const reviews = t.objectStore('reviews');
    for (const r of await reqP(reviews.getAll())) if (r.productId === id) await reqP(reviews.delete(r.id));
    const wl = t.objectStore('wishlists');
    let wishIds = null;
    for (const rec of await reqP(wl.getAll())) {
      if (Array.isArray(rec.productIds) && rec.productIds.includes(id)) {
        rec.productIds = rec.productIds.filter((x) => x !== id);
        await reqP(wl.put(rec));
        wishIds = rec.productIds;
      }
    }
    const carts = t.objectStore('carts');
    let cartCount = null;
    for (const c of await reqP(carts.getAll())) {
      if (Array.isArray(c.lines) && c.lines.some((l) => skus.has(l.sku))) {
        c.lines = c.lines.filter((l) => !skus.has(l.sku));
        c.updatedAt = new Date().toISOString();
        await reqP(carts.put(c));
        cartCount = c.lines.reduce((n, l) => n + l.qty, 0);
      }
    }
    await reqP(products.delete(id));
    return { deleted: true, wishIds, cartCount };
  });
  if (!result.deleted) return { deleted: false, reason: result.reason };
  if (result.cartCount !== null) emit('cart:changed', { count: result.cartCount });
  if (result.wishIds) (await import('./wishlist.js')).notifyExternalChange(result.wishIds);
  emit('catalog:changed', { id, action: 'delete' });
  return { deleted: true };
}
