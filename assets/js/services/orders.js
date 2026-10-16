// Orders: read access. Orders are written only by services/checkout.js (and status changes in later tasks).
import { tx, reqP, get } from '../db.js';

const byNewest = (a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0);

export async function getOrder(id) {
  if (!id) return null;
  return (await get('orders', String(id))) || null;
}

/**
 * All orders, newest first. Optional filter:
 * { customerId, paymentStatus, fulfillmentStatus, paymentMethod, q (id/name/email substring) }.
 */
export async function listOrders(filter = {}) {
  const all = await tx(['orders'], 'readonly', (t) => reqP(t.objectStore('orders').getAll()));
  const q = String(filter.q || '').trim().toLowerCase();
  return all.filter((o) => (!filter.customerId || o.customerId === filter.customerId)
    && (!filter.paymentStatus || o.paymentStatus === filter.paymentStatus)
    && (!filter.fulfillmentStatus || o.fulfillmentStatus === filter.fulfillmentStatus)
    && (!filter.paymentMethod || (o.payment && o.payment.method === filter.paymentMethod))
    && (!q || [o.id, o.customer?.email, `${o.customer?.firstName} ${o.customer?.lastName}`]
      .some((s) => String(s || '').toLowerCase().includes(q))))
    .sort(byNewest);
}

export async function listOrdersForCustomer(customerId) {
  if (!customerId) return [];
  const list = await tx(['orders'], 'readonly', (t) => reqP(t.objectStore('orders').index('customerId').getAll(customerId)));
  return list.sort(byNewest);
}
