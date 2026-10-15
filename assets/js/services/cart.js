// Minimal persistent cart (Task 7). Task 8 extends this module (coupons, quote, line editing).
// One record in the `carts` store: { id: 'local', lines: [{ sku, qty }], couponCode, updatedAt }.
import { tx, reqP } from '../db.js';

const CART_ID = 'local';

const emptyCart = () => ({ id: CART_ID, lines: [], couponCode: null, updatedAt: new Date().toISOString() });
const countOf = (cart) => cart.lines.reduce((n, l) => n + l.qty, 0);

function notify(cart) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('cart:changed', { detail: { count: countOf(cart) } }));
  }
}

export async function getCartRecord() {
  const rec = await tx(['carts'], 'readonly', (t) => reqP(t.objectStore('carts').get(CART_ID)));
  return rec || emptyCart();
}

export async function cartCount() {
  return countOf(await getCartRecord());
}

/**
 * Add `qty` of a SKU, validated against current stock including what is already in the cart.
 * Resolves { ok:true, cart } or { ok:false, reason, available } where `available` is the
 * quantity still addable.
 */
export async function addLine(sku, qty = 1) {
  const want = Math.max(1, Math.floor(Number(qty) || 1));
  const result = await tx(['carts', 'variants'], 'readwrite', async (t) => {
    const variant = await reqP(t.objectStore('variants').get(sku));
    if (!variant) return { ok: false, reason: 'unknown-sku', available: 0 };
    const cart = (await reqP(t.objectStore('carts').get(CART_ID))) || emptyCart();
    const line = cart.lines.find((l) => l.sku === sku);
    const inCart = line ? line.qty : 0;
    const available = Math.max(0, (variant.stock || 0) - inCart);
    if ((variant.stock || 0) <= 0) return { ok: false, reason: 'out-of-stock', available: 0 };
    if (want > available) return { ok: false, reason: 'insufficient', available };
    if (line) line.qty += want;
    else cart.lines.push({ sku, qty: want });
    cart.updatedAt = new Date().toISOString();
    await reqP(t.objectStore('carts').put(cart));
    return { ok: true, cart };
  });
  if (result.ok) notify(result.cart);
  return result;
}

export async function removeLine(sku) {
  const cart = await tx(['carts'], 'readwrite', async (t) => {
    const rec = (await reqP(t.objectStore('carts').get(CART_ID))) || emptyCart();
    rec.lines = rec.lines.filter((l) => l.sku !== sku);
    rec.updatedAt = new Date().toISOString();
    await reqP(t.objectStore('carts').put(rec));
    return rec;
  });
  notify(cart);
  return cart;
}
