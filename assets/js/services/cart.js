// Persistent cart. One record in the `carts` store:
// { id: 'local', lines: [{ sku, qty }], couponCode, updatedAt }.
// Lines reference SKUs only; names/prices are always read live from products/variants.
import { tx, reqP } from '../db.js';
import { getSettings } from './settings.js';
import { getCoupon } from './coupons.js';
import { quote, validateCoupon, subtotalCents } from './pricing.js';
import { clampQty, mergeLine, changeVariantLines, classifyLine, pricedLines } from './cart-rules.js';
import { LINE_QTY_MAX } from './limits.js';

const CART_ID = 'local';

const emptyCart = () => ({ id: CART_ID, lines: [], couponCode: null, updatedAt: new Date().toISOString() });
const countOf = (cart) => cart.lines.reduce((n, l) => n + l.qty, 0);
const isActive = (p) => !!p && (!p.status || p.status === 'active');

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

async function readRows(t, cart) {
  const out = [];
  for (const l of cart.lines) {
    const variant = (await reqP(t.objectStore('variants').get(l.sku))) || null;
    const product = variant ? (await reqP(t.objectStore('products').get(variant.productId))) || null : null;
    out.push({ line: l, variant, product });
  }
  return out;
}

function resolveLines(rows) {
  return rows.map(({ line, variant, product }) => {
    const { available, problem } = classifyLine({ qty: line.qty, variant, product });
    const base = {
      sku: line.sku,
      qty: line.qty,
      productId: product ? product.id : null,
      slug: product ? product.slug : null,
      name: product ? product.name : 'Μη διαθέσιμο προϊόν',
      brand: product ? product.brand : '',
      image: product && product.images ? product.images[0] || null : null,
      size: variant ? variant.size : null,
      color: variant ? variant.color : null,
      colorHex: variant ? variant.colorHex : null,
      unitCents: product ? product.priceCents : 0,
      compareAtCents: product ? product.compareAtCents || null : null,
      available,
    };
    return problem ? { ...base, problem } : base;
  });
}

/** Resolved lines with live product/variant data and problem classification. */
export async function getCart() {
  const { cart, rows } = await tx(['carts', 'variants', 'products'], 'readonly', async (t) => {
    const c = (await reqP(t.objectStore('carts').get(CART_ID))) || emptyCart();
    return { cart: c, rows: await readRows(t, c) };
  });
  return { lines: resolveLines(rows), couponCode: cart.couponCode || null };
}

/**
 * Add `qty` of a SKU, validated against current stock including what is already in the cart.
 * Resolves { ok:true, cart } or { ok:false, reason, available } where `available` is the
 * quantity still addable.
 */
export async function addLine(sku, qty = 1) {
  const want = Math.max(1, Math.floor(Number(qty) || 1));
  const result = await tx(['carts', 'variants', 'products'], 'readwrite', async (t) => {
    const variant = await reqP(t.objectStore('variants').get(sku));
    if (!variant) return { ok: false, reason: 'unknown-sku', available: 0 };
    const product = await reqP(t.objectStore('products').get(variant.productId));
    if (!isActive(product) || variant.archived) return { ok: false, reason: 'archived', available: 0 };
    const cart = (await reqP(t.objectStore('carts').get(CART_ID))) || emptyCart();
    const line = cart.lines.find((l) => l.sku === sku);
    const inCart = line ? line.qty : 0;
    const available = Math.max(0, Math.min(variant.stock || 0, LINE_QTY_MAX) - inCart);
    if ((variant.stock || 0) <= 0) return { ok: false, reason: 'out-of-stock', available: 0 };
    if (want > available) return { ok: false, reason: 'insufficient', available };
    cart.lines = mergeLine(cart.lines, sku, want);
    cart.updatedAt = new Date().toISOString();
    await reqP(t.objectStore('carts').put(cart));
    return { ok: true, cart };
  });
  if (result.ok) notify(result.cart);
  return result;
}

async function mutate(fn) {
  const cart = await tx(['carts'], 'readwrite', async (t) => {
    const rec = (await reqP(t.objectStore('carts').get(CART_ID))) || emptyCart();
    fn(rec);
    rec.updatedAt = new Date().toISOString();
    await reqP(t.objectStore('carts').put(rec));
    return rec;
  });
  notify(cart);
  return cart;
}

/** Set a line quantity, clamped to stock. qty <= 0 removes the line. */
export async function setQty(sku, qty) {
  const want = Math.floor(Number(qty));
  const result = await tx(['carts', 'variants'], 'readwrite', async (t) => {
    const cart = (await reqP(t.objectStore('carts').get(CART_ID))) || emptyCart();
    const line = cart.lines.find((l) => l.sku === sku);
    if (!line) return { ok: false, reason: 'not-in-cart', cart };
    if (!(want > 0)) {
      cart.lines = cart.lines.filter((l) => l.sku !== sku);
      cart.updatedAt = new Date().toISOString();
      await reqP(t.objectStore('carts').put(cart));
      return { ok: true, cart };
    }
    const variant = await reqP(t.objectStore('variants').get(sku));
    const stock = variant ? Math.max(0, variant.stock || 0) : 0;
    if (stock <= 0) return { ok: false, reason: 'out-of-stock', available: 0, cart };
    line.qty = clampQty(want, stock);
    cart.updatedAt = new Date().toISOString();
    await reqP(t.objectStore('carts').put(cart));
    if (want > stock) return { ok: false, reason: 'insufficient', available: stock, cart };
    return { ok: true, available: stock, cart };
  });
  notify(result.cart);
  const { cart, ...rest } = result;
  return rest;
}

/** Swap a line to another variant of the same product (atomic). */
export async function changeVariant(oldSku, newSku) {
  const result = await tx(['carts', 'variants'], 'readwrite', async (t) => {
    const cart = (await reqP(t.objectStore('carts').get(CART_ID))) || emptyCart();
    if (oldSku === newSku) return { ok: true, qty: 0, merged: false, clipped: false, cart };
    const [from, to] = await Promise.all([
      reqP(t.objectStore('variants').get(oldSku)),
      reqP(t.objectStore('variants').get(newSku)),
    ]);
    if (!to || to.archived) return { ok: false, reason: 'unknown-sku', cart };
    if (!from || from.productId !== to.productId) return { ok: false, reason: 'different-product', cart };
    const r = changeVariantLines(cart.lines, oldSku, newSku, to.stock || 0);
    if (!r.ok) return { ok: false, reason: r.reason, cart };
    cart.lines = r.lines;
    cart.updatedAt = new Date().toISOString();
    await reqP(t.objectStore('carts').put(cart));
    return { ok: true, qty: r.qty, merged: r.merged, clipped: r.clipped, cart };
  });
  notify(result.cart);
  const { cart, ...rest } = result;
  return rest;
}

export async function removeLine(sku) {
  return mutate((rec) => { rec.lines = rec.lines.filter((l) => l.sku !== sku); });
}

/** Remove the given SKUs (or every line when omitted; clearing everything also drops the coupon). */
export async function clearLines(skus) {
  return mutate((rec) => {
    if (!skus) {
      rec.lines = [];
      rec.couponCode = null;
    } else {
      const drop = new Set(skus);
      rec.lines = rec.lines.filter((l) => !drop.has(l.sku));
    }
  });
}

/** Validate a code against the current priced subtotal and store it, all in one transaction. */
export async function applyCoupon(code) {
  const typed = String(code ?? '').trim();
  if (!typed) return { ok: false, reason: 'empty' };
  const result = await tx(['carts', 'variants', 'products', 'coupons'], 'readwrite', async (t) => {
    const coupon = await reqP(t.objectStore('coupons').get(typed.toUpperCase()));
    if (!coupon) return { ok: false, reason: 'not-found' };
    const cart = (await reqP(t.objectStore('carts').get(CART_ID))) || emptyCart();
    const lines = resolveLines(await readRows(t, cart));
    const v = validateCoupon(coupon, subtotalCents(pricedLines(lines)));
    if (!v.ok) return { ok: false, reason: v.reason, coupon };
    cart.couponCode = coupon.code;
    cart.updatedAt = new Date().toISOString();
    await reqP(t.objectStore('carts').put(cart));
    return { ok: true, coupon, cart };
  });
  if (result.ok) {
    notify(result.cart);
    return { ok: true, coupon: result.coupon };
  }
  return result;
}

export async function removeCoupon() {
  return mutate((rec) => { rec.couponCode = null; });
}

/**
 * Quote for the current cart. A stored coupon that is no longer valid is kept but reported
 * through quote.couponError (and not discounted).
 */
export async function getQuoteForCart(shippingMethod = 'courier', payment = 'cod') {
  const [{ lines, couponCode }, settings] = await Promise.all([getCart(), getSettings()]);
  const coupon = couponCode ? await getCoupon(couponCode) : null;
  // Lines that cannot be bought (out-of-stock/archived/unknown) are excluded from every total.
  const q = quote({ lines: pricedLines(lines), coupon, shipping: { method: shippingMethod }, payment, settings });
  if (couponCode && !coupon) q.couponError = 'not-found';
  return { quote: q, lines, couponCode, coupon, settings, hasProblems: lines.some((l) => l.problem) };
}
