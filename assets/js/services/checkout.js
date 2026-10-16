// Transactional checkout. placeOrder runs ONE readwrite IndexedDB transaction that re-reads the
// cart, variants, products and coupon, rechecks stock and coupon eligibility, prices the order
// with the shared quote function and then writes the order, stock decrements, coupon usage,
// customer and cart together — or nothing at all. Everything that is not an IndexedDB request
// (ids, hashes, timestamps) is computed before the transaction opens.
import { tx, reqP } from '../db.js';
import { quote, validateCoupon, subtotalCents } from './pricing.js';
import { classifyLine, pricedLines } from './cart-rules.js';
import {
  validateCheckoutForm, cleanForm, makeOrderId, uuid, SHIPPING_LABELS, PAYMENT_LABELS,
} from './checkout-rules.js';
import { incrementUsage } from './coupons.js';
import { upsertCustomerFromCheckout, resolveCheckoutCustomer, setActiveCustomerId } from './customers.js';

const CART_ID = 'local';
const STORES = ['carts', 'variants', 'products', 'coupons', 'orders', 'customers', 'settings'];

export class CheckoutError extends Error {
  /** code: 'EMPTY' | 'PROBLEMS' | 'STOCK' | 'COUPON' | 'VALIDATION' | 'PRICE' */
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'CheckoutError';
    this.code = code;
    this.details = details;
  }
}

/** Merge rows with the same SKU (first position wins), summing quantities. */
export function aggregateLines(lines) {
  const map = new Map();
  for (const l of lines || []) {
    const hit = map.get(l.sku);
    if (hit) hit.qty += Number(l.qty) || 0;
    else map.set(l.sku, { sku: l.sku, qty: Number(l.qty) || 0 });
  }
  return [...map.values()];
}

/** Stable "sku:qty|sku:qty" signature of the purchasable lines (aggregated, sorted by SKU). */
export function lineSignature(lines) {
  return aggregateLines(lines).map((l) => `${l.sku}:${l.qty}`).sort().join('|');
}

/** Fulfilment states in which a payment simulation makes no sense. */
export const NO_PAYMENT_FULFILLMENT = ['cancelled', 'returned'];

async function findByRequestId(t, requestId) {
  // Demo-scale scan (orders store has no requestId index; avoids a schema migration).
  const all = await reqP(t.objectStore('orders').getAll());
  return all.find((o) => o.requestId === requestId) || null;
}

function snapshotLine(line, variant, product, vatRate) {
  const unitCents = product.priceCents;
  return {
    sku: variant.sku,
    productId: product.id,
    slug: product.slug,
    name: product.name,
    brand: product.brand || '',
    size: variant.size ?? null,
    color: variant.color ?? null,
    colorHex: variant.colorHex ?? null,
    // Order snapshots never embed data: URLs (they would bloat every order); such images render the ÉLAN fallback tile.
    image: (product.images && product.images[0] && !String(product.images[0]).startsWith('data:')) ? product.images[0] : null,
    qty: line.qty,
    unitCents,
    compareAtCents: product.compareAtCents || null,
    lineTotalCents: unitCents * line.qty,
    vatRate,
  };
}

/**
 * Place an order for the current cart.
 * @param {{form:object, shippingMethod:'courier'|'pickup', paymentMethod:'cod'|'iris', requestId:string,
 *          saveDetails?:boolean, expectedTotalCents?:number}} args
 * @returns {Promise<object>} the order (the existing one when requestId was already used)
 * @throws {CheckoutError}
 */
export async function placeOrder({
  form, shippingMethod, paymentMethod, requestId, saveDetails = false, expectedTotalCents, expectedSignature,
} = {}) {
  const data = {
    ...(form || {}),
    shippingMethod: shippingMethod ?? form?.shippingMethod,
    paymentMethod: paymentMethod ?? form?.paymentMethod,
  };
  const v = validateCheckoutForm(data);
  if (!v.ok) throw new CheckoutError('VALIDATION', 'Ελέγξτε τα στοιχεία της φόρμας.', { errors: v.errors });

  // Pre-computed outside the transaction.
  const reqId = requestId ? String(requestId) : uuid();
  const f = cleanForm(data);
  const ship = data.shippingMethod;
  const pay = data.paymentMethod;
  const now = new Date();
  const nowIso = now.toISOString();
  const idCandidates = Array.from({ length: 12 }, () => makeOrderId(now));

  const result = await tx(STORES, 'readwrite', async (t) => {
    const os = (name) => t.objectStore(name);

    const existing = await findByRequestId(t, reqId);
    if (existing) return { order: existing, replay: true };
    // Find the customer by current email (never by id alone): see resolveCheckoutCustomer.
    const target = await resolveCheckoutCustomer(t, f.email);

    const cart = await reqP(os('carts').get(CART_ID));
    if (!cart || !Array.isArray(cart.lines) || !cart.lines.length) {
      throw new CheckoutError('EMPTY', 'Το καλάθι σας είναι άδειο.');
    }
    const settingsRec = (await reqP(os('settings').get('store'))) || {};
    const { key, ...settings } = settingsRec;

    // Aggregate by SKU so duplicate rows can never be checked/decremented separately.
    const rows = [];
    for (const line of aggregateLines(cart.lines)) {
      const variant = (await reqP(os('variants').get(line.sku))) || null;
      const product = variant ? (await reqP(os('products').get(variant.productId))) || null : null;
      rows.push({ line, variant, product, ...classifyLine({ qty: line.qty, variant, product }) });
    }
    const problems = rows.filter((r) => r.problem === 'unknown' || r.problem === 'archived');
    if (problems.length) {
      throw new CheckoutError('PROBLEMS', 'Κάποια προϊόντα του καλαθιού δεν είναι πλέον διαθέσιμα.', {
        lines: problems.map((r) => ({ sku: r.line.sku, problem: r.problem, name: r.product?.name || null })),
      });
    }
    const short = rows.filter((r) => r.problem === 'out-of-stock' || r.problem === 'insufficient' || !(r.line.qty > 0));
    if (short.length) {
      throw new CheckoutError('STOCK', 'Το διαθέσιμο απόθεμα άλλαξε.', {
        lines: short.map((r) => ({ sku: r.line.sku, name: r.product.name, requested: r.line.qty, available: r.available })),
      });
    }

    const vatRate = settings.vatRate;
    const lines = rows.map((r) => snapshotLine(r.line, r.variant, r.product, vatRate));
    const priced = pricedLines(lines);

    let coupon = null;
    if (cart.couponCode) {
      coupon = (await reqP(os('coupons').get(cart.couponCode))) || null;
      const cv = coupon ? validateCoupon(coupon, subtotalCents(priced), now) : { ok: false, reason: 'not-found' };
      if (!cv.ok) {
        throw new CheckoutError('COUPON', 'Ο κωδικός κουπονιού δεν ισχύει πλέον.', { code: cart.couponCode, reason: cv.reason, coupon });
      }
    }

    const q = quote({ lines: priced, coupon, shipping: { method: ship }, payment: pay, settings, now });
    const signature = lineSignature(rows.map((r) => r.line));
    if ((expectedTotalCents != null && q.totalCents !== expectedTotalCents)
      || (expectedSignature != null && signature !== expectedSignature)) {
      throw new CheckoutError('PRICE', 'Το καλάθι ή το σύνολο της παραγγελίας άλλαξε.', {
        expectedTotalCents, totalCents: q.totalCents, expectedSignature, signature,
      });
    }

    let id = null;
    for (const c of idCandidates) {
      if ((await reqP(os('orders').count(c))) === 0) { id = c; break; }
    }
    if (!id) throw new Error('Could not allocate a unique order id');

    const pickupAddress = settings.contact?.address || '';
    const shipLabel = ship === 'pickup'
      ? `${SHIPPING_LABELS.pickup}${pickupAddress ? ` (${pickupAddress})` : ''}`
      : SHIPPING_LABELS.courier;
    const order = {
      id,
      requestId: reqId,
      customerId: target.id,
      createdAt: nowIso,
      customer: {
        firstName: f.firstName, lastName: f.lastName, email: f.email, phone: f.phone, company: f.company, vatNumber: f.vatNumber,
      },
      shippingAddress: ship === 'pickup'
        ? null
        : { address: f.address, city: f.city, postalCode: f.postalCode, region: f.region },
      shipping: { method: ship, label: shipLabel, costCents: q.shippingCents, ...(ship === 'pickup' ? { pickupAddress } : {}) },
      payment: { method: pay, label: PAYMENT_LABELS[pay], status: 'pending', simulated: true },
      fulfillmentStatus: 'pending',
      paymentStatus: 'pending',
      lines,
      couponCode: coupon ? coupon.code : null,
      totals: {
        subtotalCents: q.subtotalCents,
        discountCents: q.discountCents,
        shippingCents: q.shippingCents,
        codFeeCents: q.codFeeCents,
        totalCents: q.totalCents,
        vatIncludedCents: q.vatIncludedCents,
      },
      vatRate,
      notes: f.notes,
      internalNotes: [],
      history: [{ at: nowIso, type: 'created', detail: `Η παραγγελία καταχωρήθηκε · ${PAYMENT_LABELS[pay]} · ${shipLabel}` }],
      restocked: false,
      demo: true,
    };
    await reqP(os('orders').add(order)); // add (not put): a duplicate key aborts instead of overwriting

    for (const r of rows) {
      await reqP(os('variants').put({ ...r.variant, stock: r.variant.stock - r.line.qty }));
    }
    if (coupon) await incrementUsage(t, coupon.code);
    const info = {};
    await upsertCustomerFromCheckout(data, { t, now: nowIso, order: { totalCents: q.totalCents }, saveDetails, target, info });

    const purchased = new Set(rows.map((r) => r.line.sku));
    const nextCart = {
      ...cart,
      lines: cart.lines.filter((l) => !purchased.has(l.sku)),
      couponCode: null,
      updatedAt: nowIso,
    };
    await reqP(os('carts').put(nextCart));
    return { order, replay: false, addressSkipped: !!info.addressSkipped, remaining: nextCart.lines.reduce((n, l) => n + l.qty, 0) };
  });

  if (!result.replay) {
    setActiveCustomerId(result.order.customerId);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('cart:changed', { detail: { count: result.remaining } }));
    }
  }
  // Not persisted: lets the checkout page tell the customer their address could not be saved (list full).
  return result.addressSkipped ? { ...result.order, addressNotSaved: true } : result.order;
}

/**
 * Demo-only: mark an IRIS order as paid by simulation. Only IRIS orders whose paymentStatus is
 * 'pending' change; calling it again (or on any other order state) returns the order unchanged.
 */
export async function confirmIrisSimulation(orderId) {
  const at = new Date().toISOString();
  return tx(['orders'], 'readwrite', async (t) => {
    const store = t.objectStore('orders');
    const o = await reqP(store.get(String(orderId)));
    if (!o) throw Object.assign(new Error('Order not found'), { code: 'NOT_FOUND' });
    if (!o.payment || o.payment.method !== 'iris') throw Object.assign(new Error('Not an IRIS order'), { code: 'NOT_IRIS' });
    if (NO_PAYMENT_FULFILLMENT.includes(o.fulfillmentStatus)) {
      throw Object.assign(new Error('Order is cancelled or returned'), { code: 'NOT_ALLOWED' });
    }
    if (o.paymentStatus !== 'pending') return o;
    const next = {
      ...o,
      paymentStatus: 'simulated-paid',
      payment: { ...o.payment, status: 'simulated-paid', simulatedAt: at },
      history: [...(o.history || []), {
        at, type: 'payment-simulated', detail: 'Προσομοίωση πληρωμής IRIS (demo) — δεν πραγματοποιήθηκε πραγματική τραπεζική συναλλαγή.',
      }],
    };
    await reqP(store.put(next));
    return next;
  });
}
