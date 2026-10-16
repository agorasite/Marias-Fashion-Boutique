// Orders: read access plus the admin order-management mutations (Task 14). Orders are created only by
// services/checkout.js. The state machine, restock planning, CSV and list filtering are pure functions
// in order-rules.js (see the decision block at its top); this module wraps them in IndexedDB
// transactions so every mutation re-reads the order inside the same readwrite transaction it writes in.
//
// Every successful mutation appends a history entry {at, type, detail, by:'admin-demo'}, returns the
// updated order and dispatches window 'orders:changed' {id}. A repeated identical request is a no-op
// (same order returned, no history entry, no event).
import { tx, reqP, get } from '../db.js';
import {
  OrderError, filterOrders, applyFulfillment, applyPayment, applyNote, applyTerminalTransition, restockSkus,
} from './order-rules.js';

export {
  OrderError, ORDER_STATUSES, PAYMENT_STATUSES, canTransitionFulfillment, canTransitionPayment, planRestock,
  nextFulfillmentSteps, ordersToCsv, filterOrders, paginate, csvFileName, ORDERS_PAGE_SIZE, NOTE_MAX,
} from './order-rules.js';

const byNewest = (a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0);

export async function getOrder(id) {
  if (!id) return null;
  return (await get('orders', String(id))) || null;
}

/**
 * All orders matching `filter`, newest first by default. Filter (all optional):
 * { customerId, paymentStatus, fulfillmentStatus, paymentMethod, q (reference / name / email / phone),
 *   from, to (YYYY-MM-DD local days, inclusive), sort: 'newest'|'oldest'|'total-desc'|'total-asc' }.
 */
export async function listOrders(filter = {}) {
  const all = await tx(['orders'], 'readonly', (t) => reqP(t.objectStore('orders').getAll()));
  return filterOrders(all, filter);
}

export async function listOrdersForCustomer(customerId) {
  if (!customerId) return [];
  const list = await tx(['orders'], 'readonly', (t) => reqP(t.objectStore('orders').index('customerId').getAll(customerId)));
  return list.sort(byNewest);
}

const notFound = () => new OrderError('NOT_FOUND', 'Η παραγγελία δεν βρέθηκε.');

function emitChanged(id) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('orders:changed', { detail: { id } }));
}

/** Read-modify-write of one order in one readwrite transaction. `apply(order, at)` → {changed, order}. */
async function mutate(id, apply) {
  const at = new Date().toISOString();
  const r = await tx(['orders'], 'readwrite', async (t) => {
    const store = t.objectStore('orders');
    const o = await reqP(store.get(String(id)));
    if (!o) throw notFound();
    const res = apply(o, at);
    if (res.changed) await reqP(store.put(res.order));
    return res;
  });
  if (r.changed) emitChanged(r.order.id);
  return r.order;
}

/** Forward fulfillment change along pending→confirmed→processing→shipped→delivered (never backward). */
export const updateFulfillment = (id, status) => mutate(id, (o, at) => applyFulfillment(o, status, at));

/** pending→simulated-paid, simulated-paid→refunded (simulations only; no real money moves). */
export const updatePayment = (id, status) => mutate(id, (o, at) => applyPayment(o, status, at));

/** Internal note (trimmed, 1–1000 chars). Throws OrderError VALIDATION. */
export const addNote = (id, text) => mutate(id, (o, at) => applyNote(o, text, at));

/**
 * Cancel/return in ONE readwrite transaction over orders + variants: the order is re-read inside the
 * transaction, so a repeated or concurrent call sees the terminal state and returns the order
 * unchanged — stock is restored at most once (also guarded by order.restocked).
 */
async function terminal(id, target) {
  const at = new Date().toISOString();
  const r = await tx(['orders', 'variants'], 'readwrite', async (t) => {
    const orders = t.objectStore('orders');
    const variants = t.objectStore('variants');
    const o = await reqP(orders.get(String(id)));
    if (!o) throw notFound();
    const map = new Map();
    // Only read stock when a restock can happen (the pure function decides; reading is harmless).
    if (o.fulfillmentStatus !== target && o.sample !== true && o.restocked !== true) {
      for (const sku of restockSkus(o)) {
        const v = await reqP(variants.get(sku));
        if (v) map.set(sku, v);
      }
    }
    const res = applyTerminalTransition(o, target, map, at);
    if (!res.changed) return res;
    for (const v of res.variantPuts) await reqP(variants.put(v));
    await reqP(orders.put(res.order));
    return res;
  });
  if (r.changed) {
    emitChanged(r.order.id);
    if (r.variantPuts.length && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('catalog:changed', { detail: { action: 'restock', skus: r.variantPuts.map((v) => v.sku) } }));
    }
  }
  return r.order;
}

/** pending | confirmed | processing | shipped → cancelled, with a one-time restock (see order-rules.js). */
export const cancelOrder = (id) => terminal(id, 'cancelled');

/** delivered → returned, with a one-time restock (see order-rules.js). */
export const returnOrder = (id) => terminal(id, 'returned');
